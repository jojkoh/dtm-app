import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  imagePaths: z.array(z.string().min(1).max(512)).min(1).max(10),
  fileName: z.string().min(1).max(255),
  trade: z.enum(["Electrical", "ACMV", "Plumbing"]),
});

export interface Phase1Item {
  detected_item: string;
  description?: string;
  trade: string;
  system?: string;
  specification?: string;
  position?: string;
  size?: string;
  unit: string;
  quantity: number;
  confidence: number;
  page?: number;
  remarks?: string;
}

export interface Phase1Result {
  ok: boolean;
  classification: string | null;
  items: Phase1Item[];
  legend?: LegendSymbol[];
  pagesProcessed: number;
  error?: string;
}

const TRADE_HINTS: Record<string, string> = {
  Electrical:
    "Singapore SS638 practice. Detect ONLY what is visible. Lighting fixtures (LED downlight, LED panel, track light, LED strip, hood light, signage lighting, fly-trap UV, exit lights, emergency lights — record wattage / CCT / zone where shown). Lighting switches. Socket outlets — 13A SSO, 15A SSO. 20A heater switch. TPN isolators: 20A / 32A / 40A / 63A. Main incoming (e.g. 250A TPN). MDB, sub-DB, RCCB, MCCB, distribution boards / panel boards. Cable routes, trunking, GI conduit (record sizes such as 20mm / 25mm). Data points (RJ45), CCTV points, AP (access points). Capture room/zone (Kitchen / Pantry vs Dining / Living / Bedroom) in 'position' so metal-clad vs PVC accessories can be derived. Use unit 'm' for linear runs (cable tray, conduit, trunking) and 'no' for points/devices. DO NOT invent cables, fittings, lugs, glands, ko-boxes — those are derived later.",
  ACMV:
    "Singapore SS553 / SS554 / SCDF practice. Detect ONLY visible items. Classify ductwork explicitly as SAD (supply), RAD (return), EAD (exhaust), FAD (fresh air) and ALWAYS include rectangular size as WxH mm in 'size' (e.g. '450x300'). Detect grilles by class: SAG, RAG, EAG, FAG and note neck size. Detect FCU / AHU (note 'EXTG' if existing/retained), VAV boxes, exhaust air fan, fresh air fan, MV control panel, electronic air cleaner, hood VCDs, flexible duct connections (default Ø250mm), access panels, guide vanes, fire dampers, volume control dampers. Use 'm' for duct linear runs. DO NOT visually count elbows, tees, reducers, transitions, plenum boxes or supports — those are derived from route geometry.",
  Plumbing:
    "Singapore PUB / CP48 / SS636 practice. Detect ONLY visible items. Pipe routes with diameter (DN or mm or inch) and material (uPVC, copper, GI, PPR, HDPE) — record linear metres in unit 'm'. Classify system: Cold Water, Hot Water, Sanitary/Waste, Vent, Rainwater, Sprinkler. Fixtures: WC, wash hand basin, urinal, shower mixer, sink, floor trap, floor waste, bib tap. Valves: gate, check/NRV, ball, stop. Equipment: water heater / storage tank, booster / transfer pumps. DO NOT visually count elbows, tees, reducers, couplings, unions or supports — derived from route geometry with a 5% fittings allowance.",
};

function safeParseJson(raw: string): Record<string, unknown> {
  if (!raw) return {};
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) return {};
  cleaned = cleaned.slice(start);
  for (let end = cleaned.length; end > 0; end--) {
    try {
      const parsed = JSON.parse(cleaned.slice(0, end));
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* keep trimming */
    }
    const lastClose = Math.max(cleaned.lastIndexOf("}", end - 2), cleaned.lastIndexOf("]", end - 2));
    if (lastClose <= 0) break;
    end = lastClose + 2;
  }
  return {};
}

function normalizeItem(raw: unknown, fallbackTrade: string, page?: number): Phase1Item | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const description = String(r.detected_item ?? r.description ?? r.item ?? "").trim();
  if (!description) return null;
  const qtyNum = Number(r.quantity ?? r.qty ?? 1);
  return {
    detected_item: description,
    description,
    trade: String(r.trade ?? fallbackTrade),
    system: r.system != null ? String(r.system) : undefined,
    specification: r.specification != null ? String(r.specification) : undefined,
    position: r.position != null ? String(r.position) : undefined,
    size: r.size != null ? String(r.size) : undefined,
    unit: String(r.unit ?? "no"),
    quantity: Number.isFinite(qtyNum) ? qtyNum : 0,
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0.5))),
    page: page ?? (Number.isFinite(Number(r.page)) ? Number(r.page) : undefined),
    remarks: r.remarks != null ? String(r.remarks) : undefined,
  };
}

interface StageOneOutput {
  page: number;
  classification: string;
  items: Phase1Item[];
}

export interface LegendSymbol {
  symbol: string;        // short label / glyph code as it appears in the legend
  description: string;   // human description
  trade: string;         // Electrical | ACMV | Plumbing | other
  page?: number;
}

async function stageZeroLegend(
  apiKey: string,
  trade: string,
  pageNumber: number,
  base64Png: string,
): Promise<LegendSymbol[]> {
  const systemPrompt = `You are Quantify AI inside DTM Workspace. Stage 0 — LEGEND EXTRACTION ONLY.
Trade focus: ${trade}. Page ${pageNumber}.

Task: Locate the drawing's legend / symbol key / schedule-of-symbols panel and extract every entry.
For each legend entry return:
- symbol: the short symbol code or label as printed (e.g. "SSO", "SAG", "GV", "⊕")
- description: the meaning text printed next to the symbol
- trade: one of Electrical | ACMV | Plumbing (best guess from context)

RULES:
- Read the LEGEND ONLY. Do NOT count any symbols in the layout.
- Do NOT include quantities.
- Ignore title blocks, notes, and equipment schedules (schedules list specific equipment, not symbol meanings).
- If no legend is present on this page, return an empty list.

Return STRICT JSON only.`;

  const userPrompt = `Return JSON ONLY:
{
  "symbols": [
    { "symbol": "string", "description": "string", "trade": "Electrical|ACMV|Plumbing" }
  ]
}
If no legend: {"symbols":[]}.`;

  const res = await gatewayCall(
    apiKey,
    {
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Png}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2048,
    },
    60_000,
  );

  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseJson(content);
  const raw = Array.isArray(parsed.symbols) ? (parsed.symbols as unknown[]) : [];
  return raw
    .map((s): LegendSymbol | null => {
      if (!s || typeof s !== "object") return null;
      const r = s as Record<string, unknown>;
      const symbol = String(r.symbol ?? "").trim();
      const description = String(r.description ?? "").trim();
      if (!symbol || !description) return null;
      return {
        symbol,
        description,
        trade: String(r.trade ?? trade),
        page: pageNumber,
      };
    })
    .filter((x): x is LegendSymbol => x !== null);
}

function dedupeLegend(all: LegendSymbol[]): LegendSymbol[] {
  const seen = new Map<string, LegendSymbol>();
  for (const s of all) {
    const key = `${s.symbol.toLowerCase()}|${s.description.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return Array.from(seen.values());
}


async function gatewayCall(apiKey: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function stageOneExtract(
  apiKey: string,
  trade: string,
  pageNumber: number,
  base64Png: string,
  legend: LegendSymbol[],
): Promise<StageOneOutput> {
  const legendBlock =
    legend.length > 0
      ? `\nREFERENCE LEGEND (extracted in Stage 0 — use as the symbol library for this scan):\n${legend
          .map((s) => `- ${s.symbol} = ${s.description} [${s.trade}]`)
          .join("\n")}\n`
      : "\nNo legend was extracted in Stage 0 — fall back to standard trade symbols.\n";

  const systemPrompt = `You are Quantify AI inside DTM Workspace — an AI-assisted construction drawing quantity extraction engine. Behave like a real M&E QS estimator analyzing a PDF construction drawing page-by-page (current page ${pageNumber}). Trade focus: ${trade}. Supported trades: Electrical, ACMV, Plumbing.
${TRADE_HINTS[trade] ?? ""}
${legendBlock}
WORKFLOW:
1. Use the REFERENCE LEGEND above as the symbol library.
2. Scan layout regions for matching symbols.
3. Count exact visible symbol instances.
4. Estimate practical routed system lengths.
5. Return structured extraction data only.

RULES:
- Prioritize visual localization over semantic summarization.
- Match symbols visually against the legend symbols.
- IGNORE title blocks, schedules, notes, and the legend region itself when counting quantities.
- Do NOT fabricate hidden items.

DISCRETE ITEMS (sockets, switches, lights, FCUs, diffusers, grilles, valves, sanitary fixtures):
- Perform EXACT symbol-instance matching against the reference legend.
- Find every matching symbol occurrence on this page (the validator will merge across pages).
- Report the EXACT visible instance count — one row per visible symbol, summed into 'quantity'.
- DO NOT estimate, round, or interpolate discrete quantities. If you cannot see it, do not count it.
- Use unit "no" (or "set" only where the legend says so).

ROUTED SYSTEMS (cables, conduits, ducts, pipes, trunking):
- Do NOT rely only on visible linework. Most installation runs are not drawn end-to-end.
- Estimate practical installation lengths using: visible dimensions, drawing scale, logical engineering routes, equipment locations, and standard M&E installation practices.
- Where full routes are not visible, INTERPOLATE the practical installation path — follow walls, ceilings, corridors, risers, and service routes.
- Derive cable lengths from device locations (e.g. each 13A SSO → 2.5mm² PVC drop + run back to its DB along the ceiling/wall route).
- Use unit "m". Report one row per (system + size).

DO NOT generate a final BOQ, derive fittings/supports/accessories, or produce contractor costing or labour calculations — those are handled downstream by the rules engine.

Return STRICT JSON only.`;

  const userPrompt = `Return JSON ONLY in this exact shape:
{
  "trade": "${trade}",
  "drawing_classification": "string (e.g. 'ACMV Layout Plan', 'Single Line Diagram', 'Plumbing Riser')",
  "items": [
    {
      "type": "string (legend symbol / equipment name, e.g. '13A SSO', 'SAG', 'WC')",
      "size": "string (e.g. '600x300mm', 'DN50', '2C+E 2.5mm²')",
      "system": "string (sub-system if obvious)",
      "specification": "string (material/type)",
      "position": "string (room / grid ref if visible)",
      "quantity": number,
      "unit": "no|set",
      "confidence": 0..1,
      "page": ${pageNumber},
      "remarks": "string"
    }
  ],
  "routes": [
    {
      "type": "string (e.g. 'cable', 'conduit', 'duct', 'pipe', 'trunking')",
      "size": "string (e.g. '2.5mm² PVC', '25mm GI conduit', '450x300mm SAD', 'DN50 uPVC')",
      "system": "string (sub-system, e.g. 'Lighting', 'Power', 'SAD', 'Cold Water')",
      "estimated_length": number,
      "unit": "m",
      "confidence": 0..1,
      "page": ${pageNumber},
      "remarks": "string (basis of estimate — e.g. 'sum of SSO drops + horizontal run to DB along ceiling')"
    }
  ]
}
If nothing detectable: {"trade":"${trade}","drawing_classification":"unknown","items":[],"routes":[]}.`;


  const res = await gatewayCall(
    apiKey,
    {
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Png}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 6144,
    },
    90_000,
  );

  if (!res.ok) {
    const status = res.status;
    if (status === 429) throw new Error("AI is busy (rate limit). Please retry shortly.");
    if (status === 402) throw new Error("AI credits exhausted. Add credits to the workspace.");
    throw new Error(`Vision extraction failed (${status}) on page ${pageNumber}.`);
  }

  const json = await res.json().catch(() => ({}));
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseJson(content);

  const rawItems = Array.isArray(parsed.items) ? (parsed.items as unknown[]) : [];
  const discreteItems = rawItems
    .map((it) => {
      // Map new schema { type, ... } onto Phase1Item shape ({ detected_item, ... }).
      if (it && typeof it === "object") {
        const r = it as Record<string, unknown>;
        if (r.type != null && r.detected_item == null) r.detected_item = r.type;
      }
      return normalizeItem(it, trade, pageNumber);
    })
    .filter((x): x is Phase1Item => x !== null);

  const rawRoutes = Array.isArray((parsed as Record<string, unknown>).routes)
    ? ((parsed as Record<string, unknown>).routes as unknown[])
    : [];
  const routeItems = rawRoutes
    .map((rt) => {
      if (!rt || typeof rt !== "object") return null;
      const r = rt as Record<string, unknown>;
      const type = String(r.type ?? "").trim();
      const size = String(r.size ?? "").trim();
      if (!type && !size) return null;
      const len = Number(r.estimated_length ?? r.quantity ?? 0);
      return normalizeItem(
        {
          detected_item: [type, size].filter(Boolean).join(" "),
          trade,
          system: r.system,
          specification: r.specification ?? type,
          size,
          unit: r.unit ?? "m",
          quantity: Number.isFinite(len) ? len : 0,
          confidence: r.confidence ?? 0.5,
          remarks: r.remarks,
        },
        trade,
        pageNumber,
      );
    })
    .filter((x): x is Phase1Item => x !== null);

  return {
    page: pageNumber,
    classification: typeof parsed.drawing_classification === "string" ? parsed.drawing_classification : "unknown",
    items: [...discreteItems, ...routeItems],
  };
}

async function stageTwoValidate(
  apiKey: string,
  trade: string,
  fileName: string,
  stageOne: StageOneOutput[],
): Promise<{ classification: string | null; items: Phase1Item[] }> {
  const flat = stageOne.flatMap((p) => p.items);
  if (flat.length === 0) {
    return {
      classification: stageOne.find((p) => p.classification && p.classification !== "unknown")?.classification ?? null,
      items: [],
    };
  }

  const systemPrompt = `You are a senior MEP engineer validating an AI quantity takeoff for a ${trade} drawing set (${fileName}). Your job:
- For DISCRETE symbol items (unit "no" / "set" — sockets, switches, lights, FCUs, diffusers, grilles, valves, sanitary fixtures): SUM exact visible instance counts across pages. Never estimate, round, or invent. Same symbol + same spec → one merged row whose quantity = sum of per-page counts.
- For ROUTED systems (unit "m" — cables, conduits, ducts, pipes, trunking): merge same size + same system into one row and sum the lengths.
- Standardize units and sizes (e.g. duct 600x300, pipe DN50).
- Drop obvious hallucinations (items inconsistent with ${trade}).
- Keep moderate-confidence items; do not over-prune.
- Add clear remarks where useful.
Return STRICT JSON only.`;

  const userPrompt = `Stage-1 raw detections from ${stageOne.length} page(s):
${JSON.stringify(stageOne).slice(0, 60000)}

Return JSON ONLY in this exact shape:
{
  "classification": "string",
  "items": [
    {
      "detected_item": "string",
      "trade": "${trade}",
      "system": "string",
      "specification": "string",
      "position": "string",
      "size": "string",
      "unit": "no|set|m|m2|m3|kg|lot",
      "quantity": number,
      "confidence": 0..1,
      "page": number,
      "remarks": "string"
    }
  ]
}`;

  const res = await gatewayCall(
    apiKey,
    {
      model: "openai/gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8192,
    },
    90_000,
  );

  if (!res.ok) {
    // Fall back to stage-one merged data rather than failing entirely
    return {
      classification: stageOne.find((p) => p.classification && p.classification !== "unknown")?.classification ?? null,
      items: flat,
    };
  }

  const json = await res.json().catch(() => ({}));
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseJson(content);
  const rawItems = Array.isArray(parsed.items) ? (parsed.items as unknown[]) : [];
  const items = rawItems
    .map((it) => normalizeItem(it, trade))
    .filter((x): x is Phase1Item => x !== null)
    .slice(0, 1000);
  return {
    classification: typeof parsed.classification === "string" ? parsed.classification : null,
    items: items.length > 0 ? items : flat,
  };
}

export const extractTempImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<Phase1Result> => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false, classification: null, items: [], pagesProcessed: 0, error: "AI service not configured." };
    }
    for (const p of data.imagePaths) {
      if (!p.startsWith(`${userId}/`)) {
        return { ok: false, classification: null, items: [], pagesProcessed: 0, error: "Forbidden file path." };
      }
    }

    // Download all rendered page PNGs from storage in parallel
    let base64Pages: string[];
    try {
      base64Pages = await Promise.all(
        data.imagePaths.map(async (path) => {
          const { data: file, error } = await supabase.storage.from("drawings-temp").download(path);
          if (error || !file) throw new Error(`Could not read ${path}`);
          const buf = Buffer.from(await file.arrayBuffer());
          return buf.toString("base64");
        }),
      );
    } catch {
      return {
        ok: false,
        classification: null,
        items: [],
        pagesProcessed: 0,
        error: "Could not read rendered drawing pages.",
      };
    }

    // STAGE 0 — Legend extraction (parallel per page). Failures are non-fatal.
    let legend: LegendSymbol[] = [];
    try {
      const perPage = await Promise.all(
        base64Pages.map((b64, i) => stageZeroLegend(apiKey, data.trade, i + 1, b64).catch(() => [])),
      );
      legend = dedupeLegend(perPage.flat());
    } catch {
      legend = [];
    }

    // STAGE 1 — Vision per page, guided by the extracted legend (parallel)
    let stageOne: StageOneOutput[];
    try {
      stageOne = await Promise.all(
        base64Pages.map((b64, i) => stageOneExtract(apiKey, data.trade, i + 1, b64, legend)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Vision extraction failed.";
      return { ok: false, classification: null, items: [], legend, pagesProcessed: 0, error: msg };
    }

    // STAGE 2 — GPT-5 validator/structurer
    let merged: { classification: string | null; items: Phase1Item[] };
    try {
      merged = await stageTwoValidate(apiKey, data.trade, data.fileName, stageOne);
    } catch {
      merged = {
        classification: stageOne.find((p) => p.classification && p.classification !== "unknown")?.classification ?? null,
        items: stageOne.flatMap((p) => p.items),
      };
    }

    return {
      ok: true,
      classification: merged.classification,
      items: merged.items,
      legend,
      pagesProcessed: stageOne.length,
    };
  });
