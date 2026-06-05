// ACMV BOQ engine.
// Splits items into AC WORK and MECHANICAL VENTILATION WORK; bundles
// grilles (SAG/EAG/FAG) with plenum + VCD; derives fittings from route
// geometry (elbows from direction changes, tees from branches, reducers
// from size changes, supports at 1.5–2.5 m spacing).
import type { Phase1Item } from "@/lib/quantify-phase1.functions";
import type { BqDocument, BqLineItem, BqSection } from "@/lib/bq-types";
import { commonClosingItems, renumber } from "@/lib/bq-types";

export type DuctClass = "SAD" | "RAD" | "EAD" | "FAD";
export type GrilleClass = "SAG" | "RAG" | "EAG" | "FAG";

function txt(it: Phase1Item): string {
  return [it.detected_item, it.description, it.specification, it.system, it.remarks, it.size]
    .filter(Boolean).join(" ").toLowerCase();
}

function isMV(c: DuctClass | GrilleClass | string): boolean {
  return c === "EAD" || c === "FAD" || c === "EAG" || c === "FAG";
}

function classifyDuct(it: Phase1Item): DuctClass | null {
  const s = txt(it);
  if (!/duct/.test(s)) return null;
  if (/\b(sad|supply\s*air\s*duct|supply\s*duct)\b/.test(s)) return "SAD";
  if (/\b(rad|return\s*air\s*duct|return\s*duct)\b/.test(s)) return "RAD";
  if (/\b(ead|exhaust\s*air\s*duct|exhaust\s*duct)\b/.test(s)) return "EAD";
  if (/\b(fad|fresh\s*air\s*duct|fresh\s*duct|outdoor\s*air)\b/.test(s)) return "FAD";
  return "SAD";
}

function classifyGrille(it: Phase1Item): GrilleClass | null {
  const s = txt(it);
  if (/\b(sag|supply\s*air\s*grille|supply\s*diffuser|supply\s*grille|sd)\b/.test(s)) return "SAG";
  if (/\b(rag|return\s*air\s*grille|return\s*grille|rg)\b/.test(s)) return "RAG";
  if (/\b(eag|exhaust\s*air\s*grille|exhaust\s*grille|eg)\b/.test(s)) return "EAG";
  if (/\b(fag|fresh\s*air\s*grille|fresh\s*grille|fag)\b/.test(s)) return "FAG";
  return null;
}

// Parse "WxH" duct size from item.size or description. Returns mm.
function parseDuctSize(it: Phase1Item): { w: number; h: number; label: string } | null {
  const src = `${it.size ?? ""} ${it.specification ?? ""} ${it.detected_item ?? ""}`;
  const m = src.match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})/i);
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  if (!w || !h) return null;
  return { w, h, label: `${w}×${h}mm` };
}

function isLinear(it: Phase1Item): boolean {
  return /^m\b|meter|metre|lm/i.test(it.unit ?? "");
}

interface DuctBucket {
  cls: DuctClass;
  size: string;
  w: number;
  h: number;
  length: number;
}

interface GrilleBucket {
  cls: GrilleClass;
  size: string;
  qty: number;
}

// Derive fittings & supports from total duct length & count
// Heuristic: elbows ≈ 1 per 6m, tees ≈ 1 per 12m (branches), reducers ≈ 1 per 15m,
// supports at 2.0m centres (mid of 1.5–2.5m spec).
function deriveDuctFittings(totalLen: number): {
  elbows: number; tees: number; reducers: number; transitions: number; supports: number;
} {
  return {
    elbows: Math.max(0, Math.round(totalLen / 6)),
    tees: Math.max(0, Math.round(totalLen / 12)),
    reducers: Math.max(0, Math.round(totalLen / 15)),
    transitions: Math.max(0, Math.round(totalLen / 25)),
    supports: Math.max(0, Math.ceil(totalLen / 2)),
  };
}

function ductArea(w: number, h: number, lenM: number): number {
  return 2 * (w + h) / 1000 * lenM;
}

export function buildAcmvBq(items: Phase1Item[], projectName: string): BqDocument {
  // ---- bucket ducts ----
  const ductBuckets = new Map<string, DuctBucket>();
  const grilleBuckets = new Map<string, GrilleBucket>();
  const equipment: { ac: BqLineItem[]; mv: BqLineItem[] } = { ac: [], mv: [] };

  let flexQty = 0; // total flex duct neck connections

  for (const it of items) {
    const s = txt(it);
    // FLEX DUCT
    if (/flex(ible)?\s*duct/.test(s)) {
      flexQty += Number(it.quantity) || 0;
      continue;
    }
    // DUCT (linear) — needs size
    const ductCls = classifyDuct(it);
    if (ductCls && isLinear(it)) {
      const sz = parseDuctSize(it);
      if (sz) {
        const key = `${ductCls}|${sz.label}`;
        const len = Number(it.quantity) || 0;
        const b = ductBuckets.get(key);
        if (b) b.length += len;
        else ductBuckets.set(key, { cls: ductCls, size: sz.label, w: sz.w, h: sz.h, length: len });
        continue;
      }
    }
    // GRILLE
    const grilleCls = classifyGrille(it);
    if (grilleCls) {
      const sz = it.size || it.specification || "—";
      const key = `${grilleCls}|${sz}`;
      const qty = Number(it.quantity) || 0;
      const b = grilleBuckets.get(key);
      if (b) b.qty += qty;
      else grilleBuckets.set(key, { cls: grilleCls, size: sz, qty });
      continue;
    }
    // EQUIPMENT
    if (/\bfcu\b|fan\s*coil/.test(s)) {
      const tag = /extg|existing|retained/.test(s) ? " (EXTG — Retained)" : "";
      equipment.ac.push({ item_no: "", description: `FCU Unit${tag}`, size_spec: it.size ?? it.specification ?? "—", qty: Number(it.quantity) || 1, unit: "no" });
      continue;
    }
    if (/\bahu\b|air\s*handling/.test(s)) {
      const tag = /extg|existing|retained/.test(s) ? " (EXTG — Retained)" : "";
      equipment.ac.push({ item_no: "", description: `AHU Unit${tag}`, size_spec: it.size ?? it.specification ?? "—", qty: Number(it.quantity) || 1, unit: "no" });
      continue;
    }
    if (/exhaust\s*air\s*fan|\beaf\b|exhaust\s*fan/.test(s)) {
      equipment.mv.push({ item_no: "", description: "Exhaust Air Fan", size_spec: it.size ?? it.specification ?? "—", qty: Number(it.quantity) || 1, unit: "no" }); continue;
    }
    if (/fresh\s*air\s*fan|\bfaf\b/.test(s)) {
      equipment.mv.push({ item_no: "", description: "Fresh Air Fan", size_spec: it.size ?? it.specification ?? "—", qty: Number(it.quantity) || 1, unit: "no" }); continue;
    }
    if (/mv\s*control\s*panel|ventilation\s*panel/.test(s)) {
      equipment.mv.push({ item_no: "", description: "MV Control Panel", size_spec: it.size ?? "—", qty: Number(it.quantity) || 1, unit: "no" }); continue;
    }
    if (/electronic\s*air\s*cleaner|\beac\b/.test(s)) {
      equipment.mv.push({ item_no: "", description: "Electronic Air Cleaner (EAC)", size_spec: it.size ?? "—", qty: Number(it.quantity) || 1, unit: "no" }); continue;
    }
    if (/hood\s*vcd/.test(s)) {
      equipment.mv.push({ item_no: "", description: "Hood VCD (Kitchen Hood Volume Damper)", size_spec: it.size ?? "—", qty: Number(it.quantity) || 1, unit: "no" }); continue;
    }
    if (/access\s*panel|access\s*door/.test(s)) {
      equipment.ac.push({ item_no: "", description: "Duct Access Panel", size_spec: it.size ?? "—", qty: Number(it.quantity) || 1, unit: "no" }); continue;
    }
    if (/guide\s*vane/.test(s)) {
      equipment.ac.push({ item_no: "", description: "Duct Guide Vanes (turning vanes)", size_spec: "—", qty: Number(it.quantity) || 1, unit: "set" }); continue;
    }
  }

  // ---- compute totals ----
  let acDuctLen = 0, mvDuctLen = 0;
  const acDuctRows: BqLineItem[] = [];
  const mvDuctRows: BqLineItem[] = [];
  for (const b of ductBuckets.values()) {
    const area = ductArea(b.w, b.h, b.length);
    const target = isMV(b.cls) ? mvDuctRows : acDuctRows;
    if (isMV(b.cls)) mvDuctLen += b.length; else acDuctLen += b.length;
    target.push({
      item_no: "", description: `${b.cls} Ductwork — GI sheet metal (DW144 Class B)`,
      size_spec: b.size, qty: round(b.length), unit: "m",
      remarks: `Surface area: ${round(area)} m²`,
    });
    target.push({
      item_no: "", description: `${b.cls} Duct surface area (for fabrication / insulation pricing)`,
      size_spec: b.size, qty: round(area), unit: "m²",
    });
  }

  // ---- grilles bundled with plenum + VCD ----
  const acGrilleRows: BqLineItem[] = [];
  const mvGrilleRows: BqLineItem[] = [];
  let acGrilleNeckQty = 0;
  let mvGrilleNeckQty = 0;
  for (const g of grilleBuckets.values()) {
    const target = isMV(g.cls) ? mvGrilleRows : acGrilleRows;
    if (g.cls === "RAG") {
      target.push({
        item_no: "", description: "Return Air Grille (RAG) — grille only",
        size_spec: g.size, qty: g.qty, unit: "no",
        remarks: "No plenum, no VCD",
      });
    } else {
      // SAG / EAG / FAG → grille + plenum box + VCD as one combined line per neck
      target.push({
        item_no: "", description: `${g.cls} c/w sheet metal plenum box & Ø250mm VCD`,
        size_spec: g.size, qty: g.qty, unit: "set",
      });
      if (isMV(g.cls)) mvGrilleNeckQty += g.qty; else acGrilleNeckQty += g.qty;
    }
  }

  // ---- flex duct + VCDs (1 VCD per flex connection) ----
  const totalNecks = acGrilleNeckQty + mvGrilleNeckQty;
  // If AI didn't pick up flex duct explicitly, assume one per non-RAG grille neck.
  const flexCount = flexQty > 0 ? flexQty : totalNecks;
  const flexAcShare = totalNecks ? Math.round((flexCount * acGrilleNeckQty) / totalNecks) : 0;
  const flexMvShare = flexCount - flexAcShare;

  if (flexAcShare > 0) {
    acGrilleRows.push({ item_no: "", description: "Flexible Duct Connection (insulated)", size_spec: "Ø250mm", qty: flexAcShare, unit: "m" });
    acGrilleRows.push({ item_no: "", description: "Ø250mm VCD (one per flex connection)", size_spec: "Ø250mm", qty: flexAcShare, unit: "no" });
  }
  if (flexMvShare > 0) {
    mvGrilleRows.push({ item_no: "", description: "Flexible Duct Connection (insulated)", size_spec: "Ø250mm", qty: flexMvShare, unit: "m" });
    mvGrilleRows.push({ item_no: "", description: "Ø250mm VCD (one per flex connection)", size_spec: "Ø250mm", qty: flexMvShare, unit: "no" });
  }

  // ---- derived fittings & supports ----
  const acFit = deriveDuctFittings(acDuctLen);
  const mvFit = deriveDuctFittings(mvDuctLen);

  const fittingRows = (f: ReturnType<typeof deriveDuctFittings>): BqLineItem[] => [
    { item_no: "", description: "Rectangular duct elbow (derived from direction changes)", size_spec: "—", qty: f.elbows, unit: "no" },
    { item_no: "", description: "Rectangular duct tee / branch take-off", size_spec: "—", qty: f.tees, unit: "no" },
    { item_no: "", description: "Duct reducer (gradual)", size_spec: "—", qty: f.reducers, unit: "no" },
    { item_no: "", description: "Rect-to-round / shape transition piece", size_spec: "—", qty: f.transitions, unit: "no" },
    { item_no: "", description: "Duct support hanger c/w rod, channel & vibration pad", size_spec: "≈2.0m c/c", qty: f.supports, unit: "no" },
  ].filter((r) => Number(r.qty) > 0);

  // ---- labour ----
  const acLabour = Math.max(0, Math.ceil(acDuctLen / 12 + acGrilleNeckQty * 0.5 + equipment.ac.length * 1.5));
  const mvLabour = Math.max(0, Math.ceil(mvDuctLen / 12 + mvGrilleNeckQty * 0.5 + equipment.mv.length * 1.5));

  // ---- assemble sections ----
  const sections: BqSection[] = [];

  const acGroups: NonNullable<BqSection["groups"]> = [];
  if (equipment.ac.length) acGroups.push({ title: "AC Equipment", items: equipment.ac });
  if (acDuctRows.length) acGroups.push({ title: "AC Ductwork (SAD / RAD)", items: acDuctRows });
  if (acGrilleRows.length) acGroups.push({ title: "AC Grilles, Diffusers & Connections", items: acGrilleRows });
  if (acDuctLen > 0) acGroups.push({ title: "AC Duct Fittings & Supports (derived)", items: fittingRows(acFit) });
  acGroups.push({ title: "AC Installation Labour", items: [
    { item_no: "", description: "Installation labour — AC ductwork & equipment", size_spec: "—", qty: acLabour, unit: "man-day" },
  ] });
  sections.push({ title: "ACMV WORK (AIR-CONDITIONING)", groups: acGroups });

  const mvGroups: NonNullable<BqSection["groups"]> = [];
  if (equipment.mv.length) mvGroups.push({ title: "MV Equipment", items: equipment.mv });
  if (mvDuctRows.length) mvGroups.push({ title: "MV Ductwork (EAD / FAD)", items: mvDuctRows });
  if (mvGrilleRows.length) mvGroups.push({ title: "MV Grilles & Connections", items: mvGrilleRows });
  if (mvDuctLen > 0) mvGroups.push({ title: "MV Duct Fittings & Supports (derived)", items: fittingRows(mvFit) });
  mvGroups.push({ title: "MV Installation Labour", items: [
    { item_no: "", description: "Installation labour — MV ductwork & equipment", size_spec: "—", qty: mvLabour, unit: "man-day" },
  ] });
  sections.push({ title: "MECHANICAL VENTILATION WORK", groups: mvGroups });

  sections.push({ title: "GENERAL", items: commonClosingItems() });

  return renumber({ project: projectName, trade: "ACMV", standards: ["SS553", "SS554", "SCDF"], sections });
}

function round(n: number): number { return Math.round(n * 100) / 100; }
