import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Download, FileText, Loader2, Trash2, Upload, AlertCircle,
  Zap, Wind, Droplet, Search, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { Phase1Item } from "@/lib/quantify-phase1.functions";
import { extractWithGemini, GeminiQuotaError, type GeminiExtractResult, type LegendEntry, type Trade } from "@/lib/quantify-gemini/extract";
import { exportCsv, exportXlsx, type BoqRow } from "@/lib/export";
import { buildElectricalBq } from "@/lib/electrical-rules";
import { buildAcmvBq } from "@/lib/acmv-rules";
import { buildPlumbingBq } from "@/lib/plumbing-rules";
import { exportSectionedBqXlsx, exportSectionedBqPdf } from "@/lib/bq-export";

import { ModuleGate } from "@/hooks/use-module-permissions";

export const Route = createFileRoute("/_authenticated/quantify/")({
  component: () => <ModuleGate name="quantify_ai"><QuantifyPage /></ModuleGate>,
});


type Phase = "idle" | "rendering" | "legend" | "scanning" | "done" | "error";

interface Status {
  phase: Phase;
  message?: string;
  current?: number;
  total?: number;
}

const TRADES: { id: Trade; label: string; Icon: typeof Zap; tint: string }[] = [
  { id: "Electrical", label: "Electrical", Icon: Zap, tint: "text-amber-500" },
  { id: "ACMV", label: "ACMV", Icon: Wind, tint: "text-sky-500" },
  { id: "Plumbing", label: "Plumbing", Icon: Droplet, tint: "text-blue-600" },
];

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 10;
const IDLE_RESET_MS = 30 * 60 * 1000;

function QuantifyPage() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [trade, setTrade] = useState<Trade>("Electrical");
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [items, setItems] = useState<Phase1Item[]>([]);
  const [legend, setLegend] = useState<LegendEntry[]>([]);
  const [classification, setClassification] = useState<string | null>(null);
  const [pagesProcessed, setPagesProcessed] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const runIdRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setItems([]);
    setLegend([]);
    setClassification(null);
    setPagesProcessed(0);
    setFileName(null);
    setFilter("");
    setStatus({ phase: "idle" });
  }, []);

  const bumpIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(reset, IDLE_RESET_MS);
  }, [reset]);

  useEffect(() => {
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, []);

  const handleFile = async (file: File) => {
    if (file.type !== "application/pdf") { toast.error("Please upload a PDF file"); return; }
    if (file.size > MAX_FILE_BYTES) { toast.error("PDF exceeds 50MB limit"); return; }

    const runId = ++runIdRef.current;
    setItems([]); setLegend([]); setClassification(null); setPagesProcessed(0);
    setFileName(file.name); setFilter(""); bumpIdle();

    setStatus({ phase: "rendering", current: 0, total: 0 });
    let result: GeminiExtractResult;
    try {
      result = await extractWithGemini(file, {
        trade,
        maxPages: MAX_PAGES,
        onProgress: (p) => {
          if (runIdRef.current !== runId) return;
          setStatus({ phase: p.phase, current: p.current, total: p.total });
        },
      });
    } catch (e) {
      const msg = e instanceof GeminiQuotaError
        ? "Daily quota reached. The Gemini API has hit its free-tier limit for today. Please try again later or upgrade your API plan."
        : e instanceof Error ? e.message : "Gemini extraction failed.";
      setStatus({ phase: "error", message: msg });
      toast.error(msg);
      return;
    }
    if (runIdRef.current !== runId) return;

    setItems(result.items);
    setLegend(result.legend);
    setClassification(result.classification);
    setPagesProcessed(result.pagesProcessed);
    setStatus({ phase: "done" });

    for (const err of result.pageErrors ?? []) {
      toast.error(err);
    }

    if (result.items.length === 0) {
      toast.message("Gemini did not detect any visible items. Try another PDF.");
    } else {
      toast.success(
        `Detected ${result.items.length} ${trade} item(s) from ${result.pagesProcessed} page(s) · ${result.legend.length} legend symbol(s) learned.`,
      );
    }
  };

  const busy = status.phase === "rendering" || status.phase === "legend" || status.phase === "scanning";
  const exportName = (fileName?.replace(/\.pdf$/i, "") || "QuantifyAI") + "_" + trade;

  const filteredItems = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter((r) =>
      [r.detected_item, r.system, r.specification, r.size, r.position, r.remarks]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [items, filter]);




  return (
    <div className="min-h-screen">
      <WorkspaceHeader subtitle="Quantify AI — Gemini 2.5 Flash Vision Takeoff" />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="size-4 mr-1" /> Back to workspace
        </Link>

        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Quantify AI</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              pdf.js renders the drawing locally, Gemini 2.5 Flash reads the legend then counts visible
              symbols page-by-page, and the local JS rule engine derives the BQ. Pages clear on
              refresh or after 30 minutes — nothing is saved.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-md border bg-violet-50/60 dark:bg-violet-950/30 border-violet-200/60 px-3 py-2 text-xs text-violet-700 dark:text-violet-300">
            <Sparkles className="size-4" /> Powered by Gemini 2.5 Flash vision
          </div>
        </div>

        <Card className="p-6 mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">1. Select trade</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TRADES.map(({ id, label, Icon, tint }) => {
              const active = trade === id;
              return (
                <button
                  key={id} type="button" onClick={() => !busy && setTrade(id)} disabled={busy}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                    active ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/40"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Icon className={`size-5 ${tint}`} />
                  <span className="font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-6 mb-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            2. Upload PDF drawing (max 50MB · first {MAX_PAGES} pages)
          </p>
          <input
            ref={fileRef} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <><Loader2 className="size-4 animate-spin" /> Working…</> : <><Upload className="size-4" /> Upload PDF</>}
            </Button>
            {fileName && (
              <span className="text-sm text-muted-foreground inline-flex items-center gap-2">
                <FileText className="size-4" /> {fileName}
              </span>
            )}
            {(items.length > 0 || fileName) && !busy && (
              <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => reset()}>
                <Trash2 className="size-4" /> Clear
              </Button>
            )}
          </div>
        </Card>

        {busy && <ProgressCard status={status} />}

        {status.phase === "error" && (
          <Card className="p-6 border-destructive/40 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-destructive">Extraction failed</p>
                <p className="text-sm text-muted-foreground mt-1">{status.message}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => fileRef.current?.click()}>
                  <Upload className="size-4" /> Try another PDF
                </Button>
              </div>
            </div>
          </Card>
        )}

        {status.phase === "done" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm">
                  <span className="font-medium">{items.length}</span>{" "}
                  <span className="text-muted-foreground">item(s) detected</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {items.length > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => exportCsv(exportName, items as unknown as BoqRow[])}>
                      <Download className="size-4" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => exportXlsx(exportName, items as unknown as BoqRow[])}>
                      <Download className="size-4" /> Excel
                    </Button>
                    {(() => {
                      const doc =
                        trade === "Electrical" ? buildElectricalBq(items, exportName) :
                        trade === "ACMV"       ? buildAcmvBq(items, exportName) :
                                                 buildPlumbingBq(items, exportName);
                      return (
                        <>
                          <Button size="sm" onClick={() => exportSectionedBqXlsx(doc)}>
                            <Download className="size-4" /> BQ Excel
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => exportSectionedBqPdf(doc)}>
                            <Download className="size-4" /> BQ PDF
                          </Button>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>

            {(() => {
              const safeItems = Array.isArray(filteredItems) ? filteredItems : [];
              const TRADE_HEADINGS: Record<string, string> = {
                Electrical: "ELECTRICAL WORK",
                ACMV: "ACMV WORK",
                Plumbing: "PLUMBING WORK",
                Fire: "FIRE PROTECTION WORK",
              };
              const ORDER = ["ACMV WORK", "ELECTRICAL WORK", "PLUMBING WORK", "FIRE PROTECTION WORK"];
              const groups = new Map<string, typeof safeItems>();
              for (const r of safeItems) {
                const t = String(r?.trade ?? trade);
                const heading = TRADE_HEADINGS[t] ?? `${t.toUpperCase()} WORK`;
                if (!groups.has(heading)) groups.set(heading, []);
                groups.get(heading)!.push(r);
              }
              const sortedHeadings = [...groups.keys()].sort((a, b) => {
                const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
              });
              return (
                <>
                  <div className="mb-3 relative max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input value={filter} onChange={(e) => setFilter(e.target.value)}
                      placeholder="Search items…" className="pl-9" />
                  </div>

                  {safeItems.length === 0 ? (
                    <Card className="p-8 text-center text-muted-foreground mb-6">
                      No items detected.
                    </Card>
                  ) : (
                    sortedHeadings.map((heading) => {
                      const rows = groups.get(heading)!;
                      return (
                        <Card key={heading} className="p-2 overflow-x-auto mb-6">
                          <div className="px-3 py-2 text-sm font-semibold tracking-wide border-b bg-muted/40">
                            {heading}
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-16">No.</TableHead>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-right w-24">Qty</TableHead>
                                <TableHead className="w-20">Unit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rows.map((r, i) => (
                                <TableRow key={i}>
                                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                                  <TableCell className="font-medium">{r?.detected_item ?? r?.description ?? "—"}</TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {Number.isFinite(Number(r?.quantity)) ? Number(r?.quantity) : 0}
                                  </TableCell>
                                  <TableCell>{r?.unit ?? "no"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Card>
                      );
                    })
                  )}
                </>
              );
            })()}
          </>
        )}

        {status.phase === "idle" && (
          <Card className="p-12 text-center border-dashed">
            <FileText className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Select a trade above and upload a PDF to begin.</p>
          </Card>
        )}
      </main>
    </div>
  );
}

function ProgressCard({ status }: { status: Status }) {
  const label =
    status.phase === "rendering" ? `Rendering pages${status.total ? ` (${status.current ?? 0}/${status.total})` : "…"}`
    : status.phase === "legend" ? "Gemini reading legend symbols…"
    : status.phase === "scanning" ? `Gemini counting symbols${status.total ? ` (page ${status.current ?? 0}/${status.total})` : "…"}`
    : "Working…";
  const sub =
    status.phase === "rendering" ? "pdf.js converting drawings to images — 100% local."
    : status.phase === "legend" ? "Pass A — learning the symbol library on this drawing set."
    : status.phase === "scanning" ? "Pass B — visible-instance count per page using the learned legend."
    : "";
  return (
    <Card className="p-10 text-center mb-6">
      <Loader2 className="size-10 text-primary mx-auto mb-4 animate-spin" />
      <p className="font-medium">{label}</p>
      <p className="text-sm text-muted-foreground mt-1">{sub}</p>
    </Card>
  );
}

