
const RUBRIC_KEYS = [
  "organization",
  "clarity",
  "content_quality",
  "professionalism",
  "overall_impression",
];
 
const SYSTEM_PROMPT = `You are an expert presentation coach evaluating a slide deck.
Score the deck against this fixed rubric, 0-10 points per category:
- organization: logical flow, clear structure, good pacing
- clarity: easy to follow, minimal jargon, readable slide text
- content_quality: strong evidence, relevant data, well-supported claims
- professionalism: polish, consistency, no typos/formatting issues (infer from text only)
- overall_impression: holistic quality
 
Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "scores": {
    "organization": <0-10 integer>,
    "clarity": <0-10 integer>,
    "content_quality": <0-10 integer>,
    "professionalism": <0-10 integer>,
    "overall_impression": <0-10 integer>
  },
  "feedback": ["<short actionable bullet>", "..."]
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
  return result;
}
 
/**
 * Sends one prompt to the Groq API (OpenAI-compatible chat completions
 * endpoint) over plain HTTPS and returns the raw assistant text. Stateless
 * REST call - no subprocess, no native binary - so it works fine inside a
 * Vercel serverless function.
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