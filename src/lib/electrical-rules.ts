// Electrical engineering rules — SS638. Produces the unified tender BQ.
import type { Phase1Item } from "@/lib/quantify-phase1.functions";
import type { BqDocument, BqLineItem, BqSection } from "@/lib/bq-types";
import { commonClosingItems, renumber } from "@/lib/bq-types";

export type Phase = "1Φ" | "3Φ" | "—";

export type ElectricalCategory =
  | "Lighting Point" | "Switch"
  | "13A SSO" | "15A SSO"
  | "20A Heater Switch" | "20A TPN Isolator" | "32A TPN Isolator"
  | "40A TPN Isolator" | "63A TPN Isolator"
  | "Main Incoming 250A TPN" | "Distribution Board"
  | "Data Point" | "CCTV Point" | "Access Point"
  | "Cable Tray / Containment" | "Conduit" | "Other";

const SS = "SS638";

export interface ElectricalRule {
  category: ElectricalCategory;
  cable_size: string;   // "1.5 mm²" | "—"
  cable_type: string;   // "PVC" | "CAT6" | "—"
  phase: Phase;
  device_type: string;
  standard_ref: string;
  socket_type?: string; // "Metal-clad" | "PVC"
}

function txt(it: Phase1Item): string {
  return [it.detected_item, it.description, it.specification, it.system, it.remarks, it.position]
    .filter(Boolean).join(" ").toLowerCase();
}

function classify(it: Phase1Item): ElectricalCategory {
  const s = txt(it);
  if (/(^|\b)(250a)\b.*tpn|main\s*incoming|incoming\s*supply/.test(s)) return "Main Incoming 250A TPN";
  if (/63\s*a.*tpn|tpn.*63\s*a/.test(s)) return "63A TPN Isolator";
  if (/40\s*a.*tpn|tpn.*40\s*a/.test(s)) return "40A TPN Isolator";
  if (/32\s*a.*tpn|tpn.*32\s*a/.test(s)) return "32A TPN Isolator";
  if (/20\s*a.*tpn|tpn.*20\s*a/.test(s)) return "20A TPN Isolator";
  if (/20\s*a.*heater|heater\s*switch/.test(s)) return "20A Heater Switch";
  if (/15\s*a.*(sso|socket)/.test(s)) return "15A SSO";
  if (/13\s*a.*(sso|socket)|\bsso\b|socket\s*outlet|gpo/.test(s)) return "13A SSO";
  if (/\bdb\b|distribution\s*board|sub[-\s]*db|panel\s*board|mdb|rccb|mccb/.test(s)) return "Distribution Board";
  if (/data\s*point|\brj45\b|outlet\s*data|\bdata\b.*outlet/.test(s)) return "Data Point";
  if (/cctv|camera/.test(s)) return "CCTV Point";
  if (/access\s*(control|point)|card\s*reader|door\s*release|\bap\b/.test(s)) return "Access Point";
  if (/cable\s*tray|ladder|trunking|containment/.test(s)) return "Cable Tray / Containment";
  if (/conduit/.test(s)) return "Conduit";
  if (/switch(?!gear)/.test(s)) return "Switch";
  if (/light|luminaire|down\s*light|troffer|exit\s*sign|fluorescent|led\s*panel|track\s*light|strip|hood\s*light|signage|fly\s*trap|uv/.test(s))
    return "Lighting Point";
  return "Other";
}

function detectLocation(it: Phase1Item): "kitchen" | "dining" | "other" {
  const s = txt(it);
  if (/kitchen|pantry|wet\s*kitchen|dry\s*kitchen/.test(s)) return "kitchen";
  if (/dining|living|bedroom|study|hall|guest/.test(s)) return "dining";
  return "other";
}

const BASE: Record<ElectricalCategory, Omit<ElectricalRule, "category" | "socket_type">> = {
  "Lighting Point":           { cable_size: "1.5 mm²", cable_type: "PVC",  phase: "1Φ", device_type: "Lighting circuit",            standard_ref: SS },
  "Switch":                   { cable_size: "1.5 mm²", cable_type: "PVC",  phase: "1Φ", device_type: "Lighting switch",             standard_ref: SS },
  "13A SSO":                  { cable_size: "2.5 mm²", cable_type: "PVC",  phase: "1Φ", device_type: "13A switched socket outlet",  standard_ref: SS },
  "15A SSO":                  { cable_size: "2.5 mm²", cable_type: "PVC",  phase: "1Φ", device_type: "15A switched socket outlet",  standard_ref: SS },
  "20A Heater Switch":        { cable_size: "2.5 mm²", cable_type: "PVC",  phase: "1Φ", device_type: "20A DP heater switch",        standard_ref: SS },
  "20A TPN Isolator":         { cable_size: "4 mm²",   cable_type: "PVC",  phase: "3Φ", device_type: "20A TPN isolator",            standard_ref: SS },
  "32A TPN Isolator":         { cable_size: "6 mm²",   cable_type: "PVC",  phase: "3Φ", device_type: "32A TPN isolator",            standard_ref: SS },
  "40A TPN Isolator":         { cable_size: "10 mm²",  cable_type: "PVC",  phase: "3Φ", device_type: "40A TPN isolator",            standard_ref: SS },
  "63A TPN Isolator":         { cable_size: "10 mm²",  cable_type: "PVC",  phase: "3Φ", device_type: "63A TPN isolator",            standard_ref: SS },
  "Main Incoming 250A TPN":   { cable_size: "—",       cable_type: "—",    phase: "3Φ", device_type: "Main incoming 250A TPN",      standard_ref: SS },
  "Distribution Board":       { cable_size: "—",       cable_type: "—",    phase: "3Φ", device_type: "Distribution board",          standard_ref: SS },
  "Data Point":               { cable_size: "—",       cable_type: "CAT6", phase: "—",  device_type: "Structured cabling outlet",   standard_ref: SS },
  "CCTV Point":               { cable_size: "—",       cable_type: "CAT6", phase: "—",  device_type: "CCTV camera point",           standard_ref: SS },
  "Access Point":             { cable_size: "—",       cable_type: "CAT6", phase: "—",  device_type: "Access control point",        standard_ref: SS },
  "Cable Tray / Containment": { cable_size: "—",       cable_type: "—",    phase: "—",  device_type: "Containment",                 standard_ref: SS },
  "Conduit":                  { cable_size: "—",       cable_type: "—",    phase: "—",  device_type: "Conduit run",                 standard_ref: SS },
  "Other":                    { cable_size: "—",       cable_type: "—",    phase: "—",  device_type: "Other electrical item",       standard_ref: SS },
};

export function applyElectricalRule(it: Phase1Item): ElectricalRule {
  const category = classify(it);
  const base = BASE[category];
  let socket_type: string | undefined;
  if (category === "13A SSO" || category === "15A SSO") {
    const loc = detectLocation(it);
    socket_type = loc === "kitchen" ? "Metal-clad" : "PVC";
  }
  return { category, ...base, socket_type };
}

// Approximate point-to-circuit cable length per device (m).
const RUN_PER_DEVICE_M: Partial<Record<ElectricalCategory, number>> = {
  "Lighting Point": 6,
  "Switch": 4,
  "13A SSO": 8,
  "15A SSO": 8,
  "20A Heater Switch": 10,
  "20A TPN Isolator": 12,
  "32A TPN Isolator": 14,
  "40A TPN Isolator": 16,
  "63A TPN Isolator": 18,
  "Data Point": 20,
  "CCTV Point": 25,
  "Access Point": 20,
};

function isLinearUnit(unit?: string): boolean {
  return /^m\b|meter|metre|lm/i.test(unit ?? "");
}

const CABLE_COLOURS_SP: Record<string, string[]> = {
  "1.5 mm²": ["Brown", "Blue", "Green"],
  "2.5 mm²": ["Brown", "Blue", "Green"],
};
const CABLE_COLOURS_TP: Record<string, string[]> = {
  "4 mm²":  ["Brown", "Black", "Grey", "Blue", "Green"],
  "6 mm²":  ["Brown", "Black", "Grey", "Blue", "Green"],
  "10 mm²": ["Brown", "Black", "Grey", "Blue", "Green"],
};

const ROLL_M = 100;

export function buildElectricalBq(items: Phase1Item[], projectName: string): BqDocument {
  // Per-category running totals
  type DeviceBucket = { sample: Phase1Item; rule: ElectricalRule; qty: number; locations: Set<string>; route: number };
  const devices = new Map<string, DeviceBucket>();
  let trayLen = 0;
  const conduitLen: Record<string, number> = {}; // by size (e.g. "20mm", "25mm")
  const cableMetersBySize: Record<string, number> = {}; // total derived per cable size
  const cableMetersByType: Record<string, number> = {}; // CAT6 / PVC totals (for large feeders)
  let mainIncomingQty = 0;
  let dbQty = 0;

  for (const it of items) {
    const rule = applyElectricalRule(it);
    const cat = rule.category;
    const qty = Number(it.quantity) || 0;

    if (cat === "Cable Tray / Containment") {
      trayLen += isLinearUnit(it.unit) ? qty : 0;
      continue;
    }
    if (cat === "Conduit") {
      const sz = (it.size ?? it.specification ?? "20mm").match(/\d+\s*mm/i)?.[0]?.replace(/\s+/g, "") ?? "20mm";
      conduitLen[sz] = (conduitLen[sz] ?? 0) + (isLinearUnit(it.unit) ? qty : 0);
      continue;
    }
    if (cat === "Main Incoming 250A TPN") { mainIncomingQty += qty || 1; continue; }
    if (cat === "Distribution Board")     { dbQty += qty || 1; continue; }

    const key = `${cat}|${rule.socket_type ?? ""}|${it.size ?? ""}`;
    const b = devices.get(key);
    const loc = detectLocation(it);
    if (b) { b.qty += qty; b.locations.add(loc); }
    else devices.set(key, { sample: it, rule, qty, locations: new Set([loc]), route: 0 });

    // Derived cable metres
    const perDevice = RUN_PER_DEVICE_M[cat] ?? 0;
    const totalMeters = perDevice * qty;
    if (totalMeters > 0) {
      if (rule.cable_size !== "—") {
        cableMetersBySize[rule.cable_size] = (cableMetersBySize[rule.cable_size] ?? 0) + totalMeters;
      }
      if (rule.cable_type === "CAT6") {
        cableMetersByType["CAT6"] = (cableMetersByType["CAT6"] ?? 0) + totalMeters;
      }
    }
  }

  // ---- Sections ----
  const sections: BqSection[] = [];

  // 1. Mains & Switchgear
  const mainsItems: BqLineItem[] = [];
  if (mainIncomingQty) mainsItems.push({ item_no: "", description: "Main incoming switch — 250A TPN", size_spec: "250A, 3Φ+N", qty: mainIncomingQty, unit: "no" });
  if (dbQty) mainsItems.push({ item_no: "", description: "Distribution Board (DB) c/w MCBs/RCBOs as per SLD", size_spec: "TPN, IP31", qty: dbQty, unit: "no" });
  if (mainsItems.length) sections.push({ title: "ELECTRICAL — MAINS & SWITCHGEAR", items: mainsItems });

  // 2. Devices grouped: Metal-clad accessories (Kitchen), PVC accessories (Dining/Other), Lighting, Heater/Isolators, ELV
  const accMC: BqLineItem[] = [];
  const accPVC: BqLineItem[] = [];
  const lighting: BqLineItem[] = [];
  const switches: BqLineItem[] = [];
  const isolators: BqLineItem[] = [];
  const elv: BqLineItem[] = [];

  for (const b of devices.values()) {
    const { rule, sample, qty } = b;
    const row: BqLineItem = {
      item_no: "",
      description: rule.device_type,
      size_spec: [rule.cable_size !== "—" ? rule.cable_size : null, rule.cable_type !== "—" ? rule.cable_type : null, rule.phase !== "—" ? rule.phase : null]
        .filter(Boolean).join(" · ") || "—",
      qty, unit: "no",
      remarks: sample.position ? `Loc: ${sample.position}` : undefined,
    };
    switch (rule.category) {
      case "13A SSO":
      case "15A SSO":
        if (rule.socket_type === "Metal-clad") accMC.push({ ...row, description: `${rule.device_type} — Metal-clad (Kitchen)` });
        else accPVC.push({ ...row, description: `${rule.device_type} — PVC (Dining/General)` });
        break;
      case "20A Heater Switch":
        accPVC.push(row); break;
      case "Lighting Point": lighting.push(row); break;
      case "Switch": switches.push(row); break;
      case "20A TPN Isolator":
      case "32A TPN Isolator":
      case "40A TPN Isolator":
      case "63A TPN Isolator":
        isolators.push(row); break;
      case "Data Point":
      case "CCTV Point":
      case "Access Point":
        elv.push(row); break;
      default: break;
    }
  }

  if (lighting.length || switches.length) {
    sections.push({ title: "ELECTRICAL — LIGHTING & SWITCHING", groups: [
      ...(lighting.length ? [{ title: "Lighting Fixtures (record W / CCT / Zone)", items: lighting }] : []),
      ...(switches.length ? [{ title: "Lighting Switches", items: switches }] : []),
    ] });
  }

  if (accMC.length || accPVC.length || isolators.length) {
    sections.push({ title: "ELECTRICAL — POWER ACCESSORIES & ISOLATORS", groups: [
      ...(accMC.length  ? [{ title: "Metal-Clad Accessories (Kitchen / Wet areas)", items: accMC }]  : []),
      ...(accPVC.length ? [{ title: "PVC Accessories (Dining / Dry areas)",        items: accPVC }] : []),
      ...(isolators.length ? [{ title: "TPN Isolators", items: isolators }] : []),
    ] });
  }

  if (elv.length) sections.push({ title: "ELECTRICAL — ELV (DATA / CCTV / AP)", items: elv });

  // 3. Cables — small in rolls (split by colour), large in metres
  const cableSmallGroups: NonNullable<BqSection["groups"]> = [];
  for (const sz of Object.keys(CABLE_COLOURS_SP)) {
    const total = cableMetersBySize[sz] ?? 0;
    if (total <= 0) continue;
    const rolls = Math.ceil(total / ROLL_M);
    const colours = CABLE_COLOURS_SP[sz];
    const perColour = Math.ceil(rolls / colours.length);
    cableSmallGroups.push({
      title: `${sz} PVC single-core — single phase (Brown/Blue/Green)`,
      items: colours.map((c) => ({
        item_no: "", description: `${sz} PVC single-core ${c}`,
        size_spec: `${sz} · ${c}`, qty: perColour, unit: "roll",
        remarks: `1 roll = ${ROLL_M}m · derived from ${round(total)} m total`,
      })),
    });
  }
  for (const sz of Object.keys(CABLE_COLOURS_TP)) {
    const total = cableMetersBySize[sz] ?? 0;
    if (total <= 0) continue;
    const rolls = Math.ceil(total / ROLL_M);
    const colours = CABLE_COLOURS_TP[sz];
    const perColour = Math.ceil(rolls / colours.length);
    cableSmallGroups.push({
      title: `${sz} PVC single-core — three phase (Brown/Black/Grey/Blue/Green)`,
      items: colours.map((c) => ({
        item_no: "", description: `${sz} PVC single-core ${c}`,
        size_spec: `${sz} · ${c}`, qty: perColour, unit: "roll",
        remarks: `1 roll = ${ROLL_M}m · derived from ${round(total)} m total`,
      })),
    });
  }

  // Large feeder cable (e.g. 250A main incoming) — output in metres
  const largeCableItems: BqLineItem[] = [];
  if (mainIncomingQty > 0) {
    largeCableItems.push({
      item_no: "", description: "Main incoming feeder — XLPE/PVC SWA Cu (sized to 250A TPN, per consultant)",
      size_spec: "4C × 95 mm² (indicative)", qty: 30, unit: "m",
      remarks: "Final size & length per SLD; included for tender pricing",
    });
  }
  if ((cableMetersByType["CAT6"] ?? 0) > 0) {
    const m = Math.ceil(cableMetersByType["CAT6"]);
    largeCableItems.push({
      item_no: "", description: "CAT6 UTP cable for Data / CCTV / AP",
      size_spec: "CAT6 4P 23AWG", qty: Math.ceil(m / 305) * 305, unit: "m",
      remarks: `Supplied in 305m boxes · derived ${m} m`,
    });
  }

  if (cableSmallGroups.length || largeCableItems.length) {
    sections.push({ title: "ELECTRICAL — CABLES",
      groups: [
        ...cableSmallGroups,
        ...(largeCableItems.length ? [{ title: "Large / Feeder Cables (by length)", items: largeCableItems }] : []),
      ],
    });
  }

  // 4. Containment & accessories
  const containment: BqLineItem[] = [];
  if (trayLen > 0) {
    containment.push({ item_no: "", description: "Cable tray / ladder — hot-dip galvanised", size_spec: "300mm wide (indicative)", qty: round(trayLen), unit: "m" });
    containment.push({ item_no: "", description: "Cable tray support bracket c/w rod & anchor", size_spec: "@ 1.5m c/c", qty: Math.ceil(trayLen / 1.5), unit: "no" });
  }
  for (const [sz, len] of Object.entries(conduitLen)) {
    if (len <= 0) continue;
    containment.push({ item_no: "", description: "GI conduit", size_spec: sz, qty: round(len), unit: "m" });
    // Per-size accessories (auto-generated per spec)
    const each = Math.max(1, Math.ceil(len / 6));
    containment.push(
      { item_no: "", description: `Full saddle — ${sz}`,        size_spec: sz, qty: each * 2, unit: "no" },
      { item_no: "", description: `Half saddle — ${sz}`,        size_spec: sz, qty: each,     unit: "no" },
      { item_no: "", description: `Pipe clip — ${sz}`,          size_spec: sz, qty: each,     unit: "no" },
      { item_no: "", description: `Flexible conduit — ${sz}`,   size_spec: sz, qty: Math.ceil(len * 0.1), unit: "m"  },
      { item_no: "", description: `GI socket — ${sz}`,          size_spec: sz, qty: each,     unit: "no" },
      { item_no: "", description: `Copper bush — ${sz}`,        size_spec: sz, qty: each,     unit: "no" },
      { item_no: "", description: `GI adapter — ${sz}`,         size_spec: sz, qty: Math.ceil(each / 2), unit: "no" },
      { item_no: "", description: `Copper adapter — ${sz}`,     size_spec: sz, qty: Math.ceil(each / 2), unit: "no" },
      { item_no: "", description: `T-box — ${sz}`,              size_spec: sz, qty: Math.ceil(each / 2), unit: "no" },
      { item_no: "", description: `Through-box — ${sz}`,        size_spec: sz, qty: each,     unit: "no" },
      { item_no: "", description: `Cross-box — ${sz}`,          size_spec: sz, qty: Math.ceil(each / 4), unit: "no" },
      { item_no: "", description: `End-box — ${sz}`,            size_spec: sz, qty: Math.ceil(each / 3), unit: "no" },
      { item_no: "", description: `L-box — ${sz}`,              size_spec: sz, qty: Math.ceil(each / 2), unit: "no" },
      { item_no: "", description: `Dome cover — ${sz}`,         size_spec: sz, qty: each,     unit: "no" },
    );
  }
  // Reducing copper adapter if both 3/4" (~20mm) and 1" (~25mm) exist
  if (conduitLen["20mm"] && conduitLen["25mm"]) {
    containment.push({ item_no: "", description: "Reducing copper adapter — 25mm to 20mm", size_spec: "25→20mm", qty: 10, unit: "no" });
  }
  if (containment.length) sections.push({ title: "ELECTRICAL — CONTAINMENT & CONDUIT ACCESSORIES", items: containment });

  // 5. Sundries auto-generated per spec
  const totalDevicePoints = Array.from(devices.values()).reduce((a, b) => a + b.qty, 0);
  const sundries: BqLineItem[] = [
    { item_no: "", description: "Cable lug (assorted sizes)",         size_spec: "1.5–10 mm²", qty: totalDevicePoints * 4, unit: "no" },
    { item_no: "", description: "Cable end cap / boot",                size_spec: "Assorted",   qty: totalDevicePoints * 2, unit: "no" },
    { item_no: "", description: "Cable gland (brass) — IP-rated",      size_spec: "20–32mm",    qty: Math.max(10, dbQty * 8 + mainIncomingQty * 4), unit: "no" },
    { item_no: "", description: "Cable tie",                            size_spec: "200/300mm",  qty: Math.max(100, totalDevicePoints * 5), unit: "no" },
    { item_no: "", description: "Wire marker — printed sleeve",         size_spec: "Assorted",   qty: totalDevicePoints * 2, unit: "no" },
    { item_no: "", description: "KO box (recessed)",                    size_spec: "1G / 2G",    qty: totalDevicePoints, unit: "no" },
    { item_no: "", description: "Junction box (surface)",               size_spec: "100×100mm",  qty: Math.ceil(totalDevicePoints / 6), unit: "no" },
    { item_no: "", description: "Trunking accessory pack (bends, tees, end caps)", size_spec: "—", qty: 1, unit: "lot" },
    { item_no: "", description: "Anchor / rod / washer / screw consumables",        size_spec: "—", qty: 1, unit: "lot" },
  ];
  sections.push({ title: "ELECTRICAL — SUNDRIES & FIXINGS", items: sundries });

  sections.push({ title: "GENERAL", items: commonClosingItems() });

  return renumber({ project: projectName, trade: "Electrical", standards: ["SS638"], sections });
}

function round(n: number): number { return Math.round(n * 100) / 100; }
