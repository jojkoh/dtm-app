// Browser-side PDF -> PNG rendering using pdf.js.
// Renders each page at ~300 DPI (scale 4.17 over the 72-DPI default).
import * as pdfjsLib from "pdfjs-dist";
// Vite-friendly worker import
// eslint-disable-next-line import/no-unresolved
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface RenderedPage {
  pageNumber: number;
  blob: Blob;
}

export interface RenderOptions {
  maxPages?: number;
  dpi?: number; // target DPI (default 300)
  onProgress?: (current: number, total: number) => void;
}

export async function renderPdfToPngs(file: File, opts: RenderOptions = {}): Promise<RenderedPage[]> {
  const maxPages = opts.maxPages ?? 10;
  const dpi = opts.dpi ?? 300;
  const scale = dpi / 72;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = Math.min(pdf.numPages, maxPages);
  const pages: RenderedPage[] = [];

  for (let i = 1; i <= total; i++) {
    opts.onProgress?.(i, total);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    // Cap canvas dimension to ~6000px on the long edge to keep memory & upload size reasonable
    const maxDim = 6000;
    let renderScale = scale;
    if (Math.max(viewport.width, viewport.height) > maxDim) {
      renderScale = scale * (maxDim / Math.max(viewport.width, viewport.height));
    }
    const finalViewport = page.getViewport({ scale: renderScale });
    canvas.width = Math.ceil(finalViewport.width);
    canvas.height = Math.ceil(finalViewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    await page.render({ canvas, canvasContext: ctx, viewport: finalViewport }).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to encode PNG"))), "image/png"),
    );
    pages.push({ pageNumber: i, blob });
    // Free canvas
    canvas.width = 0;
    canvas.height = 0;
  }

  await pdf.destroy();
  return pages;
}
