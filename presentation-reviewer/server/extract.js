import JSZip from "jszip";
import xml2js from "xml2js";
import pdfParse from "pdf-parse";

/**
 * Pulls plain text out of a single PPTX slideN.xml buffer.
 * Grabs every <a:t> run so we get titles, body text, and any text boxes.
 */
async function textFromSlideXml(xml) {
  const parsed = await xml2js.parseStringPromise(xml);
  const runs = [];

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node["a:t"]) {
      for (const t of node["a:t"]) {
        if (typeof t === "string" && t.trim()) runs.push(t.trim());
      }
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) val.forEach(walk);
      else if (typeof val === "object") walk(val);
    }
  }

  walk(parsed);
  return runs.join(" ");
}

async function extractSpeakerNotes(zip, slideNumber) {
  const notesPath = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
  const file = zip.file(notesPath);
  if (!file) return "";
  const xml = await file.async("string");
  return textFromSlideXml(xml);
}

/**
 * Returns [{ slide_number, text, notes, empty }]
 */
export async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });

  if (slideFiles.length === 0) {
    throw new Error("No slides found — file may be corrupted or not a valid .pptx");
  }

  const slides = [];
  for (const path of slideFiles) {
    const slideNumber = parseInt(path.match(/slide(\d+)\.xml/)[1], 10);
    const xml = await zip.file(path).async("string");
    const text = await textFromSlideXml(xml);
    const notes = await extractSpeakerNotes(zip, slideNumber);
    slides.push({
      slide_number: slideNumber,
      text,
      notes,
      empty: text.trim().length === 0,
    });
  }

  return slides;
}

/**
 * pdf-parse gives us full-document text with page break markers via
 * page render callback; we split per page.
 */
export async function extractPdf(buffer) {
  const pages = [];

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ");
      pages.push(text);
      return text;
    },
  });

  if (pages.length === 0) {
    throw new Error("No pages found — file may be corrupted or not a valid .pdf");
  }

  return pages.map((text, i) => ({
    slide_number: i + 1,
    text,
    notes: "",
    empty: text.trim().length === 0,
  }));
}

export async function extractSlides(buffer, mimetype, filename) {
  const isPptx =
    mimetype.includes("presentation") || filename.toLowerCase().endsWith(".pptx");
  const isPdf = mimetype.includes("pdf") || filename.toLowerCase().endsWith(".pdf");

  if (isPptx) return extractPptx(buffer);
  if (isPdf) return extractPdf(buffer);

  throw new Error("Unsupported file type — please upload a .pptx or .pdf file");
}
