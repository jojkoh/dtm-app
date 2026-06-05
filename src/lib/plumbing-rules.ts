// Plumbing BOQ engine — PUB / CP48 practice.
// - Groups pipe by system + size, computes total length per size.
// - Derives stock-length splits (3m & 4m), couplings, fittings (5% allowance).
// - Adds supports based on pipe size and spacing standards.
import type { Phase1Item } from "@/lib/quantify-phase1.functions";
import type { BqDocument, BqLineItem, BqSection } from "@/lib/bq-types";
import { commonClosingItems, renumber } from "@/lib/bq-types";

type System =
  | "Cold Water" | "Hot Water" | "Sanitary / Waste" | "Vent"
  | "Rainwater" | "Sprinkler" | "Other";

function txt(it: Phase1Item): string {
  return [it.detected_item, it.description, it.specification, it.system, it.remarks]
    .filter(Boolean).join(" ").toLowerCase();
}

function classifySystem(it: Phase1Item): System {
  const s = txt(it);
  if (/cold\s*water|cw\b|pcw\b/.test(s)) return "Cold Water";
  if (/hot\s*water|\bhw\b/.test(s)) return "Hot Water";
  if (/sanitary|waste|soil|swp/.test(s)) return "Sanitary / Waste";
  if (/\bvent\b|vp\b/.test(s)) return "Vent";
  if (/rain\s*water|rwdp|down\s*pipe/.test(s)) return "Rainwater";
  if (/sprinkler|fire\s*main/.test(s)) return "Sprinkler";
  return "Other";
}

function parsePipeSize(it: Phase1Item): string | null {
  const src = `${it.size ?? ""} ${it.specification ?? ""} ${it.detected_item ?? ""}`;
  const dn = src.match(/dn\s*(\d{2,4})/i); if (dn) return `DN${dn[1]}`;
  const mm = src.match(/(\d{2,4})\s*mm\b/i); if (mm) return `DN${mm[1]}`;
  const inch = src.match(/(\d+(?:\/\d+)?|\d+\.\d+)\s*"/); if (inch) return `${inch[1]}"`;
  return null;
}

function pipeMaterial(it: Phase1Item, sys: System): string {
  const s = txt(it);
  if (/copper|cu\b/.test(s)) return "Copper";
  if (/upvc|u-pvc|pvc/.test(s)) return "uPVC";
  if (/galv|gi\b|gms/.test(s)) return "GI";
  if (/ppr/.test(s)) return "PPR";
  if (/hdpe/.test(s)) return "HDPE";
  if (sys === "Cold Water") return "uPVC";
  if (sys === "Hot Water") return "PPR";
  if (sys === "Sanitary / Waste" || sys === "Vent" || sys === "Rainwater") return "uPVC";
  return "GI";
}

// Support spacing midpoints by nominal size (mm).
function supportSpacingMeters(sizeLabel: string): number {
  const m = sizeLabel.match(/(\d+)/); const n = m ? Number(m[1]) : 0;
  if (n >= 100) return 2.5;
  if (n >= 50)  return 2.0;
  return 1.35; // small pipes 1.2–1.5 m
}

function isLinear(it: Phase1Item): boolean {
  return /^m\b|meter|metre|lm/i.test(it.unit ?? "");
}

interface PipeBucket {
  system: System;
  size: string;
  material: string;
  length: number;
}

export function buildPlumbingBq(items: Phase1Item[], projectName: string): BqDocument {
  const buckets = new Map<string, PipeBucket>();
  const fixtures: BqLineItem[] = [];
  const valves: BqLineItem[] = [];
  const equipment: BqLineItem[] = [];

  for (const it of items) {
    const s = txt(it);
    // Fixtures
    if (/\bwc\b|water\s*closet|toilet/.test(s)) { fixtures.push(fixRow("Water Closet (WC)", it)); continue; }
    if (/wash\s*basin|\bwhb\b|basin/.test(s))    { fixtures.push(fixRow("Wash Hand Basin (WHB)", it)); continue; }
    if (/urinal/.test(s))                         { fixtures.push(fixRow("Urinal", it)); continue; }
    if (/shower/.test(s))                          { fixtures.push(fixRow("Shower Mixer", it)); continue; }
    if (/kitchen\s*sink|\bsink\b/.test(s))         { fixtures.push(fixRow("Sink", it)); continue; }
    if (/floor\s*trap|\bft\b/.test(s))             { fixtures.push(fixRow("Floor Trap c/w grating", it)); continue; }
    if (/floor\s*waste|\bfw\b/.test(s))            { fixtures.push(fixRow("Floor Waste c/w grating", it)); continue; }
    if (/bib\s*tap|tap\b/.test(s))                  { fixtures.push(fixRow("Bib Tap", it)); continue; }

    // Valves
    if (/gate\s*valve/.test(s))   { valves.push(fixRow("Gate Valve", it)); continue; }
    if (/check\s*valve|nrv/.test(s)) { valves.push(fixRow("Non-Return / Check Valve", it)); continue; }
    if (/ball\s*valve/.test(s))   { valves.push(fixRow("Ball Valve", it)); continue; }
    if (/stopcock|stop\s*valve/.test(s)) { valves.push(fixRow("Stop Valve", it)); continue; }

    // Equipment
    if (/water\s*heater|storage\s*tank/.test(s)) { equipment.push(fixRow("Water Heater / Storage Tank", it)); continue; }
    if (/booster\s*pump|transfer\s*pump|\bpump\b/.test(s)) { equipment.push(fixRow("Pump Set", it)); continue; }

    // Pipes (linear)
    if (isLinear(it) || /pipe/.test(s)) {
      const sys = classifySystem(it);
      const size = parsePipeSize(it);
      if (!size) continue;
      const material = pipeMaterial(it, sys);
      const key = `${sys}|${size}|${material}`;
      const len = Number(it.quantity) || 0;
      const b = buckets.get(key);
      if (b) b.length += len;
      else buckets.set(key, { system: sys, size, material, length: len });
    }
  }

  // Pipe rows + supports + fittings allowance + stock-length split
  const pipeRows: BqLineItem[] = [];
  const supportRows: BqLineItem[] = [];
  const fittingRows: BqLineItem[] = [];

  for (const b of Array.from(buckets.values()).sort(sortPipes)) {
    const len = round(b.length);
    pipeRows.push({
      item_no: "", description: `${b.system} pipe — ${b.material}`,
      size_spec: b.size, qty: len, unit: "m",
    });
    // Stock-length breakdown (3m & 4m)
    const lengths3 = Math.ceil(b.length / 3);
    const lengths4 = Math.ceil(b.length / 4);
    pipeRows.push({
      item_no: "", description: `${b.size} ${b.material} — supply in 3m stock lengths`,
      size_spec: b.size, qty: lengths3, unit: "length",
    });
    pipeRows.push({
      item_no: "", description: `${b.size} ${b.material} — alternative 4m stock lengths`,
      size_spec: b.size, qty: lengths4, unit: "length",
      remarks: "Use one stock length only; contractor to optimise wastage",
    });
    // Couplings = (stock lengths - 1)
    pipeRows.push({
      item_no: "", description: `${b.size} ${b.material} pipe coupling / socket`,
      size_spec: b.size, qty: Math.max(0, lengths3 - 1), unit: "no",
    });

    // Derived fittings — 5% allowance on visible counts (per spec)
    // Elbows (direction changes), tees (branches), reducers, unions
    const elbows  = Math.max(1, Math.round(b.length / 4));
    const tees    = Math.max(0, Math.round(b.length / 8));
    const reducers = Math.max(0, Math.round(b.length / 12));
    const unions  = Math.max(0, Math.round(b.length / 10));
    const allow = (n: number) => Math.ceil(n * 1.05);
    fittingRows.push(
      { item_no: "", description: `${b.size} ${b.material} elbow 90° (incl. 5% allowance)`, size_spec: b.size, qty: allow(elbows), unit: "no" },
      { item_no: "", description: `${b.size} ${b.material} equal/reducing tee (incl. 5% allowance)`, size_spec: b.size, qty: allow(tees), unit: "no" },
      { item_no: "", description: `${b.size} ${b.material} reducer (incl. 5% allowance)`, size_spec: b.size, qty: allow(reducers), unit: "no" },
      { item_no: "", description: `${b.size} ${b.material} union (incl. 5% allowance)`, size_spec: b.size, qty: allow(unions), unit: "no" },
    );

    // Supports
    const spacing = supportSpacingMeters(b.size);
    const supports = Math.ceil(b.length / spacing);
    supportRows.push({
      item_no: "", description: `Pipe support / clamp c/w rod & anchor — ${b.system}`,
      size_spec: `${b.size} @ ${spacing.toFixed(2)}m c/c`, qty: supports, unit: "no",
    });
  }

  const sections: BqSection[] = [];
  const groups: NonNullable<BqSection["groups"]> = [];
  if (fixtures.length) groups.push({ title: "Sanitary Fixtures", items: fixtures });
  if (valves.length)   groups.push({ title: "Valves", items: valves });
  if (equipment.length) groups.push({ title: "Plumbing Equipment", items: equipment });
  if (pipeRows.length) groups.push({ title: "Pipework — Supply, Stock Lengths & Couplings", items: pipeRows });
  if (fittingRows.length) groups.push({ title: "Pipe Fittings (derived, +5% allowance)", items: fittingRows });
  if (supportRows.length) groups.push({ title: "Pipe Supports & Anchorage", items: supportRows });
  if (groups.length === 0) groups.push({ title: "Plumbing", items: [{ item_no: "", description: "No plumbing items detected", size_spec: "—", qty: 0, unit: "no" }] });
  sections.push({ title: "PLUMBING WORK", groups });

  sections.push({ title: "GENERAL", items: commonClosingItems() });

  return renumber({ project: projectName, trade: "Plumbing", standards: ["PUB", "CP48", "SS636"], sections });
}

function fixRow(name: string, it: Phase1Item): BqLineItem {
  return {
    item_no: "", description: name,
    size_spec: it.size ?? it.specification ?? "—",
    qty: Number(it.quantity) || 1,
    unit: it.unit && /^(no|set|pair)$/i.test(it.unit) ? it.unit : "no",
  };
}

function sortPipes(a: PipeBucket, b: PipeBucket): number {
  if (a.system !== b.system) return a.system.localeCompare(b.system);
  return a.size.localeCompare(b.size);
}

function round(n: number): number { return Math.round(n * 100) / 100; }
