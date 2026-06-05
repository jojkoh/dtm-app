// Unified BOQ contract used across ACMV, Electrical, Plumbing.
// Output columns: Item No | Description | Size / Spec | Qty | Unit
export interface BqLineItem {
  item_no: string;        // "1.01", "2.03" — sub-numbered within section
  description: string;
  size_spec: string;      // e.g. "450x300mm", "2.5mm² PVC", "DN50 uPVC"
  qty: number | string;   // number; string only for "—"
  unit: string;           // "no", "set", "m", "m²", "roll", "length", "lot", "man-day"
  remarks?: string;
}

export interface BqSection {
  // Top-level trade banner shown in the report
  title: string;          // e.g. "ACMV WORK", "MECHANICAL VENTILATION WORK"
  // Optional sub-group label rendered as a section sub-header
  groups?: { title: string; items: BqLineItem[] }[];
  // Or a flat item list if no sub-groups
  items?: BqLineItem[];
}

export interface BqDocument {
  project: string;
  trade: string;          // "Electrical" | "ACMV" | "Plumbing"
  standards: string[];    // e.g. ["SS638"], ["PUB", "CP48"]
  sections: BqSection[];
}

export function commonClosingItems(): BqLineItem[] {
  return [
    { item_no: "—", description: "Drawing endorsement (As-Built / Tender drawings)", size_spec: "—", qty: 1, unit: "lot" },
    { item_no: "—", description: "Testing & Commissioning", size_spec: "—", qty: 1, unit: "lot" },
  ];
}

// Re-number items as 1.01, 1.02, … within each section/group.
export function renumber(doc: BqDocument): BqDocument {
  doc.sections.forEach((sec, sIdx) => {
    let counter = 1;
    const num = () => `${sIdx + 1}.${String(counter++).padStart(2, "0")}`;
    if (sec.groups) {
      sec.groups.forEach((g) => g.items.forEach((it) => (it.item_no = num())));
    }
    if (sec.items) sec.items.forEach((it) => (it.item_no = num()));
  });
  return doc;
}
