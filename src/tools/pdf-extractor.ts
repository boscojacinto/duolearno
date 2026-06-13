import fs from "fs";
import pdf from "pdf-parse";

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  title: string | null;
  author: string | null;
}

export async function extractPdfText(pdfPath: string): Promise<PdfExtractionResult> {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdf(buffer);

  const info = data.info as Record<string, unknown>;

  return {
    text: data.text,
    pageCount: data.numpages,
    title: typeof info?.Title === "string" ? info.Title : null,
    author: typeof info?.Author === "string" ? info.Author : null,
  };
}
