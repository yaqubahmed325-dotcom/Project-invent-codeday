import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { extractText, getDocumentProxy } from "unpdf";

const RUBRIC_KEYS = [
  "organization",
  "clarity",
  "content_quality",
  "professionalism",
  "overall_impression",
];

const COMPLIANCE_KEYS = [
  "team_name",
  "problem",
  "solution",
  "demo",
  "product_features",
  "user_testing",
  "competitor_matrix",
  "next_steps",
];

const SYSTEM_PROMPT = `You are an expert presentation coach evaluating a slide deck for a Project Invent Demo Day pitch.

You must produce TWO separate assessments:

1) QUALITY RUBRIC — score 0-10 per category:
- organization: logical flow, clear structure, good pacing
- clarity: easy to follow, minimal jargon, readable slide text
- content_quality: strong evidence, relevant data, well-supported claims
- professionalism: polish, consistency, no typos/formatting issues (infer from text only)
- overall_impression: holistic quality

2) OFFICIAL PITCH CRITERIA COMPLIANCE — Project Invent requires every Demo Day deck to
include these 8 elements. For each one, decide if the deck actually contains it (true/false)
based on the slide text, and give a one-sentence note (what you found, or what's missing):
- team_name: Team name, student first names + last initials, and a team photo
- problem: Who the community partner is and what problem they're working together to solve
- solution: The solution, including quotes about why it's desirable to the community partner
- demo: A brief demo section featuring the physical product and how it works
- product_features: The inputs and outputs of the invention
- user_testing: Quotes from the community partner; what was learned from testing, pivots, aha moments
- competitor_matrix: Similar products identified and how this one stands out
- next_steps: What's next to further develop the product

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "scores": {
    "organization": <0-10 integer>,
    "clarity": <0-10 integer>,
    "content_quality": <0-10 integer>,
    "professionalism": <0-10 integer>,
    "overall_impression": <0-10 integer>
  },
  "feedback": ["<short actionable bullet>", "..."],
  "compliance": {
    "team_name": { "present": <true|false>, "note": "<one sentence>" },
    "problem": { "present": <true|false>, "note": "<one sentence>" },
    "solution": { "present": <true|false>, "note": "<one sentence>" },
    "demo": { "present": <true|false>, "note": "<one sentence>" },
    "product_features": { "present": <true|false>, "note": "<one sentence>" },
    "user_testing": { "present": <true|false>, "note": "<one sentence>" },
    "competitor_matrix": { "present": <true|false>, "note": "<one sentence>" },
    "next_steps": { "present": <true|false>, "note": "<one sentence>" }
  }
}
Include 3-6 feedback bullets. Do not include any text outside the JSON object.`;

// ---------- Extraction (Workers-compatible) ----------

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({ ignoreAttributes: false });

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });

  const slides = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async("string");
    const parsed = parser.parse(xml);
    const text = collectText(parsed).trim();

    // Speaker notes live in a matching notesSlideN.xml, if present
    const notesPath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    let notes = "";
    if (zip.files[notesPath]) {
      const notesXml = await zip.files[notesPath].async("string");
      notes = collectText(parser.parse(notesXml)).trim();
    }

    slides.push({
      slide_number: i + 1,
      text,
      notes: notes || null,
      empty: text.length === 0,
    });
  }
  return slides;
}

// Recursively walk parsed XML and pull out every <a:t> text run
function collectText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node + " ";
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (typeof node === "object") {
    let out = "";
    for (const key of Object.keys(node)) {
      if (key === "a:t") {
        const val = node[key];
        out += (Array.isArray(val) ? val.join(" ") : String(val)) + " ";
      } else {
        out += collectText(node[key]);
      }
    }
    return out;
  }
  return "";
}

async function extractPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const slides = [];
  const pages = Array.isArray(text) ? text : [text];
  for (let i = 0; i < totalPages; i++) {
    const pageText = (pages[i] || "").trim();
    slides.push({
      slide_number: i + 1,
      text: pageText,
      notes: null,
      empty: pageText.length === 0,
    });
  }
  return slides;
}

async function extractSlides(buffer, mimetype, filename) {
  const isPptx = mimetype.includes("presentation") || /\.pptx$/i.test(filename);
  const isPdf = mimetype.includes("pdf") || /\.pdf$/i.test(filename);

  if (isPptx) return extractPptx(buffer);
  if (isPdf) return extractPdf(buffer);
  throw new Error("Unsupported file type");
}

// ---------- Evaluation (Groq) ----------

function slidesToPrompt(slides) {
  const body = slides
    .map((s) => {
      const notes = s.notes ? `\n  Speaker notes: ${s.notes}` : "";
      const text = s.empty ? "[empty or image-only slide]" : s.text;
      return `Slide ${s.slide_number}: ${text}${notes}`;
    })
    .join("\n\n");
  return `Evaluate this slide deck:\n\n${body}`;
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validateResult(result) {
  if (!result.scores || typeof result.scores !== "object") {
    throw new Error("Missing 'scores' object");
  }
  for (const key of RUBRIC_KEYS) {
    const val = result.scores[key];
    if (typeof val !== "number" || val < 0 || val > 10) {
      throw new Error(`Invalid or missing score for '${key}'`);
    }
  }
  if (!Array.isArray(result.feedback) || result.feedback.length === 0) {
    throw new Error("Missing 'feedback' array");
  }
  if (!result.compliance || typeof result.compliance !== "object") {
    throw new Error("Missing 'compliance' object");
  }
  for (const key of COMPLIANCE_KEYS) {
    const item = result.compliance[key];
    if (!item || typeof item.present !== "boolean" || typeof item.note !== "string") {
      throw new Error(`Invalid or missing compliance entry for '${key}'`);
    }
  }
  return result;
}

async function runGroqPrompt(prompt, env) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const model = env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq returned an empty response");
  return text;
}

async function evaluateDeck(slides, env) {
  const prompt = slidesToPrompt(slides);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runGroqPrompt(
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous response was not valid JSON matching the required shape. Return ONLY the JSON object, nothing else.`,
        env
      );
      return validateResult(extractJson(raw));
    } catch (err) {
      lastError = err;
      if (err.message.includes("429")) break;
    }
  }
  throw new Error(`Evaluation failed after retry: ${lastError.message}`);
}

// ---------- Worker entry point ----------

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/evaluate" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const file = formData.get("deck");
        if (!file) {
          return json({ error: "No file uploaded (expected field name 'deck')" }, 400, headers);
        }

        const buffer = await file.arrayBuffer();
        const mimetype = file.type || "";
        const filename = file.name || "";

        const isAllowedType =
          mimetype.includes("presentation") ||
          mimetype.includes("pdf") ||
          /\.(pptx|pdf)$/i.test(filename);
        if (!isAllowedType) {
          return json({ error: "Only .pptx and .pdf files are supported" }, 400, headers);
        }

        let slides;
        try {
          slides = await extractSlides(buffer, mimetype, filename);
        } catch (err) {
          return json({ error: `Could not extract content: ${err.message}` }, 422, headers);
        }

        const nonEmptySlides = slides.filter((s) => !s.empty);
        if (nonEmptySlides.length === 0) {
          return json(
            { error: "No readable text found in this deck (it may be entirely image-based)" },
            422,
            headers
          );
        }

        try {
          const result = await evaluateDeck(slides, env);
          return json({ ...result, slide_count: slides.length }, 200, headers);
        } catch (err) {
          return json({ error: `Evaluation failed: ${err.message}` }, 502, headers);
        }
      } catch (err) {
        return json({ error: "Unexpected server error" }, 500, headers);
      }
    }

    return json({ error: "Not found" }, 404, headers);
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
