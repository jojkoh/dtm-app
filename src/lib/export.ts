import * as XLSX from "xlsx";

export interface BoqRow {
  item_no?: number | null;
  description: string;
  trade?: string | null;
  system?: string | null;
  specification?: string | null;
  unit?: string | null;
  quantity: number;
  rate?: number | null;
  confidence?: number | null;
  remarks?: string | null;
  approval_status?: string | null;
}

const headers = [
  "Item No.",
  "Description",
  "Trade",
  "System",
  "Specification",
  "Unit",
  "Quantity",
  "Rate",
  "Amount",
  "Confidence",
  "Status",
  "Remarks",
];

function toMatrix(rows: BoqRow[]) {
  return rows.map((r, i) => [
    r.item_no ?? i + 1,
    r.description,
    r.trade ?? "",
    r.system ?? "",
    r.specification ?? "",
    r.unit ?? "",
    Number(r.quantity ?? 0),
    r.rate ?? "",
    r.rate != null ? Number(r.quantity) * Number(r.rate) : "",
    r.confidence != null ? Math.round(Number(r.confidence) * 100) + "%" : "",
    r.approval_status ?? "",
    r.remarks ?? "",
  ]);
}

export function exportXlsx(projectName: string, rows: BoqRow[]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...toMatrix(rows)]);
  ws["!cols"] = [{ wch: 8 }, { wch: 40 }, { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, "BOQ");
  XLSX.writeFile(wb, `${projectName.replace(/[^a-z0-9]+/gi, "_")}_BOQ.xlsx`);
}

export function exportCsv(projectName: string, rows: BoqRow[]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...toMatrix(rows)]);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/[^a-z0-9]+/gi, "_")}_BOQ.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
