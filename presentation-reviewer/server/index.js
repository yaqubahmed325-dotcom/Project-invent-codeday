import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { extractSlides } from "./extract.js";
import { evaluateDeck } from "./evaluate.js";

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE_MB = 25;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/evaluate", upload.single("deck"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded (expected field name 'deck')" });
  }

  const { originalname, mimetype, buffer } = req.file;
  const isAllowedType =
    mimetype.includes("presentation") ||
    mimetype.includes("pdf") ||
    /\.(pptx|pdf)$/i.test(originalname);

  if (!isAllowedType) {
    return res.status(400).json({ error: "Only .pptx and .pdf files are supported" });
  }

  let slides;
  try {
    slides = await extractSlides(buffer, mimetype, originalname);
  } catch (err) {
    return res.status(422).json({ error: `Could not extract content: ${err.message}` });
  }

  const nonEmptySlides = slides.filter((s) => !s.empty);
  if (nonEmptySlides.length === 0) {
    return res.status(422).json({
      error: "No readable text found in this deck (it may be entirely image-based)",
    });
  }

  try {
    const result = await evaluateDeck(slides);
    return res.json({ ...result, slide_count: slides.length });
  } catch (err) {
    console.error("Evaluation error:", err);
    return res.status(502).json({ error: `Evaluation failed: ${err.message}` });
  }
});

// Multer / body-size errors land here
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  console.error(err);
  res.status(500).json({ error: "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Presentation reviewer backend listening on port ${PORT}`);
});

// The Copilot SDK drives a subprocess over JSON-RPC and can surface failures
// (bad/absent auth, model-not-found, dropped connection) as async errors that
// escape the per-request try/catch. On an always-on server we must not let one
// bad evaluation take down the whole process — log and stay up. The in-flight
// request still fails cleanly via sendAndWait's timeout → 502.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server kept alive):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (server kept alive):", reason);
});
