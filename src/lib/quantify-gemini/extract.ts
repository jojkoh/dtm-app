// Gemini vision extraction pipeline (runs from the browser).
//
// Single-call flow:
//   1. pdf.js renders each PDF page to PNG locally.
//   2. ONE Gemini request is sent with ALL page images attached.
//      The prompt tells Gemini to first learn every legend block across
//      all pages, then count every symbol across all pages, and return
//      combined totals per symbol.
//   3. Results are mapped to Phase1Item rows that feed the trade rule
//      engines unchanged.

import type { Phase1Item } from "@/lib/quantify-phase1.functions";
import { renderPdfToPngs, type RenderedPage } from "@/lib/pdf-render";

export type Trade = "Electrical" | "ACMV" | "Plumbing";

export interface LegendEntry {
  symbol: string;
  description: string;
  trade: Trade;
  page: number;
}

export interface GeminiExtractResult {
  ok: true;
  classification: string;
  legend: LegendEntry[];
  items: Phase1Item[];
  pagesProcessed: number;
  pageErrors: string[];
}

export interface ExtractProgress {
  phase: "rendering" | "legend" | "scanning";
  current: number;
  total: number;
}

export interface ExtractOptions {
  trade: Trade;
  maxPages?: number;
  onProgress?: (p: ExtractProgress) => void;
}

const GEMINI_API_KEY = "AIzaSyA6bVybeU4WeATh-noFMdqNtnOc6uD39lU";
// Fallback chain: try newest first, fall back on 503/429/transient errors.
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"] as const;
const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const TRADE_HINTS: Record<Trade, string> = {
  Electrical:
    "Singapore SS638. Sockets (13A/15A SSO), switches, isolators (20/32/40/63A), DBs, lights (LED downlight/panel/track/strip/exit/emergency), data/CCTV/AP points, cable trays, trunking, conduits.",
  ACMV:
    "Singapore SS553/554. FCU, AHU, VAV, exhaust/fresh-air fans, duct runs, grilles (SAG/RAG/EAG/FAG), flex ducts, dampers (VCD/FD), access panels.",
  Plumbing:
    "Singapore PUB/CP48/SS636. Pipes by system (Cold/Hot Water, Sanitary, Vent, Rainwater, Sprinkler), fixtures (WC/basin/urinal/shower/sink/floor trap), valves, water heaters, pumps.",
};

/** Thrown when Gemini returns 429 (quota exhausted). */
export class GeminiQuotaError extends Error {
  constructor(msg = "Daily quota reached. Please try again later or upgrade your Gemini API plan.") {
    super(msg);
    this.name = "GeminiQuotaError";
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; code?: number; status?: string };
}

async function callGemini(
  prompt: string,
  pageImagesBase64: string[],
  mimeType = "image/png",
): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const b64 of pageImagesBase64) {
    parts.push({ inline_data: { mime_type: mimeType, data: b64 } });
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  });

  let lastErr: unknown = null;
  let sawOverloaded = false;

  for (const model of MODELS) {
    try {
      console.log(`[Quantify AI] Analysing with ${model}...`);
      const res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      // Transient — try next model in chain
      if (res.status === 503 || res.status === 429) {
        sawOverloaded = sawOverloaded || res.status === 503;
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        if (/quota|rate limit|RESOURCE_EXHAUSTED|overloaded|unavailable/i.test(txt)) {
          sawOverloaded = sawOverloaded || /overloaded|unavailable/i.test(txt);
          lastErr = new Error(txt.slice(0, 300));
          continue;
        }
        throw new Error(`Gemini error ${res.status}: ${txt.slice(0, 300)}`);
      }

      const json = (await res.json()) as GeminiResponse;
      if (json.error) {
        const code = json.error.code;
        const status = json.error.status ?? "";
        const msg = json.error.message ?? "";
        if (code === 503 || /UNAVAILABLE|overloaded/i.test(status) || /overloaded|unavailable/i.test(msg)) {
          sawOverloaded = true;
          lastErr = new Error(msg || status);
          continue;
        }
        if (code === 429 || /RESOURCE_EXHAUSTED/i.test(status) || /quota/i.test(msg)) {
          lastErr = new Error(msg || status);
          continue;
        }
        throw new Error(msg || "Gemini error");
      }
      return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  if (sawOverloaded) {
    throw new Error("AI servers busy. Try again in few minutes.");
  }
  // If it was clearly a quota issue across all models, surface quota error.
  if (lastErr instanceof Error && /quota|RESOURCE_EXHAUSTED/i.test(lastErr.message)) {
    throw new GeminiQuotaError();
  }
  throw new Error("AI servers busy. Try again in few minutes.");
}

function safeJson<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* try slice */ }
  const start = cleaned.search(/[{[]/);
  if (start < 0) return null;
  for (let end = cleaned.length; end > start; end--) {
    try { return JSON.parse(cleaned.slice(start, end)) as T; } catch { /* keep trimming */ }
  }
  return null;
}

/** Plain-text fallback: each line "Description - Qty". */
function parsePlainTextCounts(raw: string): Array<{ description: string; quantity: number }> {
  const out: Array<{ description: string; quantity: number }> = [];
  if (!raw) return out;
  const cleaned = raw.replace(/```[a-z]*|```/gi, "");
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(.+?)\s*[-–:\t]\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) continue;
    const desc = m[1].replace(/^[-*•\d.\s)]+/, "").trim();
    const qty = Number(m[2]);
    if (!desc || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ description: desc, quantity: qty });
  }
  return out;
}

// Strip wiring/circuit refs like K/L1-S1, D/L2-P2, L1-S6, K/ISO-7
const CIRCUIT_REF = /^[A-Z]{0,3}\/?[A-Z]{1,4}\d+-[A-Z]{1,4}\d+$|\/[A-Z0-9]+-[A-Z0-9]+/i;
function isCircuitRef(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (CIRCUIT_REF.test(t)) return true;
  if (!/\s/.test(t) && /\//.test(t) && /\d/.test(t)) return true;
  return false;
}


interface DuctRow {
  type?: unknown;
  width_mm?: unknown;
  height_mm?: unknown;
  length_m?: unknown;
}

interface CombinedResponse {
  legend?: Array<{ symbol?: unknown; description?: unknown; page?: unknown }>;
  counts?: Array<{ symbol?: unknown; description?: unknown; name?: unknown; count?: unknown; qty?: unknown; quantity?: unknown; unit?: unknown }>;
  discrete_items?: CombinedResponse["counts"];
  items?: CombinedResponse["counts"];
  results?: CombinedResponse["counts"];
  ducts?: DuctRow[];
  duct_runs?: DuctRow[];
}

/** Single combined Gemini call across all rendered pages. */
async function scanAllPages(
  trade: Trade,
  pages: RenderedPage[],
): Promise<{ legend: LegendEntry[]; items: Phase1Item[]; raw: string }> {
  const images = await Promise.all(pages.map((p) => blobToBase64(p.blob)));

  const prompt = `You are a Singapore MEP QS.

STEP 1 — LEGEND
Find legend box. Read every symbol
and description exactly as written.
Legend is only source of truth.
Never assume shapes.

STEP 2 — COUNT
For each legend symbol scan layout:
  Top-left to top-right
  Middle-left to middle-right
  Bottom-left to bottom-right
  All perimeter walls
Count only exact shape matches.
Never count text, Chinese characters,
slash+number codes, or legend box items.

STEP 3 — DUCTS
Find labels like 450X300SAD, 700X300,
650X300RAD. Read width, height, type.
Estimate length from title block scale.

STEP 4 — RETURN ONLY:
{
  counts: [
    { description: string,
      count: number,
      unit: string }
  ],
  ducts: [
    { type: string,
      width_mm: number,
      height_mm: number,
      length_m: number }
  ]
}
Every legend symbol must appear in counts.
Use count 0 if not found.

Trade context: ${trade}. ${TRADE_HINTS[trade]}`;

  const raw = await callGemini(prompt, images, "image/png");

  // ----- NEW PARSER -----
  const clean = raw.replace(/```json/g, "").replace(/```/g, "").trim();

  const items: Phase1Item[] = [];
  const legend: LegendEntry[] = [];

  type CountRow = { name: string; qty: number; unit: string };
  type DuctOut = { name: string; qty: number; unit: string; remarks: string };
  let counts: CountRow[] = [];
  let ducts: DuctOut[] = [];

  try {
    const d = JSON.parse(clean) as CombinedResponse;
    const countRows = d.counts || d.discrete_items || d.items || d.results || [];
    const ductRows = d.ducts || d.duct_runs || [];

    counts = (countRows as Array<Record<string, unknown>>).map((i) => ({
      name: String(i.description ?? i.name ?? i.symbol ?? "").trim(),
      qty: Number(i.count ?? i.qty ?? i.quantity ?? 0) || 0,
      unit: String(i.unit ?? "nos"),
    }));

    ducts = (ductRows as Array<Record<string, unknown>>).map((dd) => {
      const w = Number(dd.width_mm) || 0;
      const h = Number(dd.height_mm) || 0;
      const len = Number(dd.length_m) || 0;
      const type = String(dd.type ?? "").trim();
      return {
        name: `${w}x${h} ${type}`.trim(),
        qty: +(2 * (w + h) / 1000 * len).toFixed(2),
        unit: "m²",
        remarks: `${len}m run`,
      };
    });
  } catch {
    // plain text fallback
    counts = clean
      .split("\n")
      .filter((l) => l.includes(" - "))
      .map((l) => ({
        name: l.split(" - ")[0].trim(),
        qty: parseInt(l.split(" - ")[1]) || 0,
        unit: "nos",
      }));
  }

  // VCD rule: if VCD count = 0, assume = flex duct count
  const isVcd = (n: string) => /\bvcd\b/i.test(n) || /volume\s*control\s*damper/i.test(n);
  const isFlex = (n: string) => /flex(ible)?\s*duct/i.test(n);
  const vcdIdx = counts.findIndex((c) => isVcd(c.name));
  if (vcdIdx >= 0 && counts[vcdIdx].qty === 0) {
    const flex = counts.find((c) => isFlex(c.name));
    if (flex && flex.qty > 0) {
      counts[vcdIdx].qty = flex.qty;
      (counts[vcdIdx] as CountRow & { remarks?: string }).remarks = "assumed = flex duct qty";
    }
  }

  for (const c of counts) {
    if (!c.name) continue;
    if (isCircuitRef(c.name)) continue;
    const remarks = (c as CountRow & { remarks?: string }).remarks;
    items.push({
      detected_item: c.name,
      description: c.name,
      trade,
      unit: c.unit || "nos",
      quantity: c.qty,
      confidence: 0.8,
      page: 1,
      ...(remarks ? { remarks } : {}),
    });
    legend.push({ symbol: c.name, description: c.name, trade, page: 1 });
  }

  for (const dRow of ducts) {
    if (!dRow.name || dRow.qty <= 0) continue;
    items.push({
      detected_item: dRow.name,
      description: dRow.name,
      trade,
      unit: dRow.unit,
      quantity: dRow.qty,
      confidence: 0.8,
      page: 1,
      remarks: dRow.remarks,
    });
  }

  return { legend, items, raw };

}

export async function extractWithGemini(
  file: File,
  opts: ExtractOptions,
): Promise<GeminiExtractResult> {
  const trade = opts.trade;
  const maxPages = opts.maxPages ?? 10;

  // 1) Render PDF locally.
  const pages = await renderPdfToPngs(file, {
    maxPages,
    dpi: trade === "Electrical" ? 216 : 180,
    onProgress: (c, t) => opts.onProgress?.({ phase: "rendering", current: c, total: t }),
  });
  if (!pages.length) {
    return { ok: true, classification: `${trade} (empty)`, legend: [], items: [], pagesProcessed: 0, pageErrors: [] };
  }

  // 2) ONE Gemini call for legend learning + counting across all pages.
  opts.onProgress?.({ phase: "legend", current: 0, total: pages.length });
  opts.onProgress?.({ phase: "scanning", current: 1, total: 1 });
  console.log(`Sending ${pages.length} page(s) to Gemini in one combined request…`);

  const { legend, items, raw } = await scanAllPages(trade, pages);
  console.log(`Gemini combined response (first 400 chars): ${raw.slice(0, 400)}`);
  console.log(`Learned ${legend.length} legend symbol(s); counted ${items.length} unique item(s).`);

  return {
    ok: true,
    classification: `${trade} Drawings`,
    legend,
    items,
    pagesProcessed: pages.length,
    pageErrors: [],
  };
}
