import pdf from "pdf-parse";

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  title: string | null;
  author: string | null;
}

export async function extractPdfText(pdfPath: string): Promise<PdfExtractionResult> {
  // Load fs lazily via dynamic import so Turbopack's static asset tracer doesn't
  // flag the runtime path (lint TP1004) at compile time.
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(pdfPath);
  const data = await pdf(buffer);

  const info = data.info as Record<string, unknown>;

  return {
    text: data.text,
    pageCount: data.numpages,
    title: typeof info?.Title === "string" ? info.Title : null,
    author: typeof info?.Author === "string" ? info.Author : null,
  };
}
