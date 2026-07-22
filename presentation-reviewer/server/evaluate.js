import { CopilotClient, approveAll } from "@github/copilot-sdk";

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
  // Copilot may still wrap output in ```json fences despite instructions — strip them.
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
 * Runs one prompt through a fresh Copilot CLI session and returns the raw
 * assistant text. Starting/stopping a client per request is simplest for an
 * MVP; see README for notes on reusing a long-lived client under load.
 */
async function runCopilotPrompt(prompt) {
  // The SDK authenticates via the `gitHubToken` option (or, if omitted, a
  // logged-in user via `gh`/stored OAuth). It does NOT read our
  // COPILOT_GITHUB_TOKEN env var on its own, so pass it through explicitly.
  const gitHubToken = process.env.COPILOT_GITHUB_TOKEN;
  const client = new CopilotClient(gitHubToken ? { gitHubToken } : {});
  try {
    await client.start();
    const session = await client.createSession({
      model: process.env.COPILOT_MODEL || "gpt-5",
      onPermissionRequest: approveAll,
      // "replace" so the deck-judge prompt is the entire system message —
      // we don't want Copilot's default coding-agent prompt/tool behavior here.
      systemMessage: { mode: "replace", content: SYSTEM_PROMPT },
    });
    try {
      const response = await session.sendAndWait({ prompt }, 60_000);
      if (!response) throw new Error("Copilot did not respond within the timeout");
      return response.data.content;
    } finally {
      await session.disconnect();
    }
  } finally {
    await client.stop();
  }
}

export async function evaluateDeck(slides) {
  const prompt = slidesToPrompt(slides);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runCopilotPrompt(
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous response was not valid JSON matching the required shape. Return ONLY the JSON object, nothing else.`
      );
      const parsed = extractJson(raw);
      return validateResult(parsed);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Evaluation failed after retry: ${lastError.message}`);
}
