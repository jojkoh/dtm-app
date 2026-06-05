// Unified BOQ exporter (Excel + PDF) for sectioned tender BQs.
// Columns: Item No | Description | Size / Spec | Qty | Unit | Remarks
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { BqDocument, BqLineItem, BqSection } from "@/lib/bq-types";

const HEADERS = ["Item No", "Description", "Size / Spec", "Qty", "Unit", "Remarks"];

function safe(name: string) { return name.replace(/[^a-z0-9]+/gi, "_"); }
function row(it: BqLineItem) { return [it.item_no, it.description, it.size_spec, it.qty, it.unit, it.remarks ?? ""]; }

function flattenForSheet(doc: BqDocument): (string | number)[][] {
  const out: (string | number)[][] = [];
  out.push([`BILL OF QUANTITIES — ${doc.trade.toUpperCase()}`]);
  out.push([`Project: ${doc.project}`]);
  out.push([`Standards: ${doc.standards.join(", ")}`]);
  out.push([`Generated: ${new Date().toLocaleString()}`]);
  out.push([]);
  for (const sec of doc.sections) {
    out.push([sec.title]);
    out.push(HEADERS);
    if (sec.groups) {
      for (const g of sec.groups) {
        out.push([`— ${g.title} —`]);
        for (const it of g.items) out.push(row(it));
      }
    }
    if (sec.items) for (const it of sec.items) out.push(row(it));
    out.push([]);
  }
  return out;
}

export function exportSectionedBqXlsx(doc: BqDocument) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(flattenForSheet(doc));
  ws["!cols"] = [{ wch: 8 }, { wch: 54 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, ws, "BOQ");
  XLSX.writeFile(wb, `${safe(doc.project)}_BOQ_${doc.trade}.xlsx`);
}

export function exportSectionedBqPdf(doc: BqDocument) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  pdf.setFont("helvetica", "bold").setFontSize(14)
    .text(`BILL OF QUANTITIES — ${doc.trade.toUpperCase()}`, 40, 40);
  pdf.setFont("helvetica", "normal").setFontSize(10)
    .text(`Project: ${doc.project}`, 40, 58)
    .text(`Standards: ${doc.standards.join(", ")}`, 40, 72)
    .text(`Generated: ${new Date().toLocaleString()}`, pageW - 40, 58, { align: "right" });

  let y = 90;
  for (const sec of doc.sections) {
    if (y > pdf.internal.pageSize.getHeight() - 120) { pdf.addPage(); y = 40; }
    pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(30, 41, 59).text(sec.title, 40, y);
    y += 8;

    const body: (string | number)[][] = [];
    if (sec.groups) {
      for (const g of sec.groups) {
        body.push([{ content: `— ${g.title} —`, colSpan: 6, styles: { fillColor: [241, 245, 249], fontStyle: "bold", textColor: 30 } } as unknown as string]);
        for (const it of g.items) body.push(row(it).map((c) => (c == null ? "" : String(c))));
      }
    }
    if (sec.items) for (const it of sec.items) body.push(row(it).map((c) => (c == null ? "" : String(c))));

    autoTable(pdf, {
      startY: y + 6,
      head: [HEADERS],
      body,
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: "right", cellWidth: 42 },
        1: { cellWidth: 280 },
        2: { cellWidth: 110 },
        3: { cellWidth: 45, halign: "right" },
        4: { cellWidth: 45, halign: "center" },
        5: { cellWidth: "auto" },
      },
      didDrawPage: (data) => {
        const ph = pdf.internal.pageSize.getHeight();
        pdf.setFontSize(8).setTextColor(120)
          .text(`Page ${data.pageNumber} · Quantify AI · ${doc.standards.join(", ")} · Auto-generated`, 40, ph - 16);
      },
      margin: { left: 24, right: 24 },
    });
    y = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 100;
    y += 16;
  }

  pdf.save(`${safe(doc.project)}_BOQ_${doc.trade}.pdf`);
}

// Back-compat shims for existing Electrical call sites
export function exportElectricalBqXlsx(projectName: string, doc: BqDocument) {
  void projectName; exportSectionedBqXlsx(doc);
}
export function exportElectricalBqPdf(projectName: string, doc: BqDocument) {
  void projectName; exportSectionedBqPdf(doc);
}
