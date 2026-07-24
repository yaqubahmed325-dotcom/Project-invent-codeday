
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
 
const COMPLIANCE_LABELS = {
  team_name: "Team Name",
  problem: "Problem",
  solution: "Solution",
  demo: "Demo",
  product_features: "Product Features",
  user_testing: "User Testing",
  competitor_matrix: "Competitor Matrix",
  next_steps: "Next Steps",
};
 
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
 
/**
 * Sends one prompt to the Groq API (OpenAI-compatible chat completions
 * endpoint) over plain HTTPS and returns the raw assistant text.
 */
async function runGroqPrompt(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
 
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const url = "https://api.groq.com/openai/v1/chat/completions";
 
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
 
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Groq did not respond within the timeout");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
 
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${errBody.slice(0, 300)}`);
  }
 
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq returned an empty response");
  return text;
}
 
export async function evaluateDeck(slides) {
  const prompt = slidesToPrompt(slides);
 
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runGroqPrompt(
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous response was not valid JSON matching the required shape. Return ONLY the JSON object, nothing else.`
      );
      const parsed = extractJson(raw);
      return validateResult(parsed);
    } catch (err) {
      lastError = err;
      if (err.message.includes("429")) break;
    }
  }
  throw new Error(`Evaluation failed after retry: ${lastError.message}`);
}
 
export { COMPLIANCE_KEYS, COMPLIANCE_LABELS };
 