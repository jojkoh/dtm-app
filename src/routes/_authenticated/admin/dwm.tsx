import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Sparkles, Download, Mail, Trash2, ShieldCheck, Clock, Pencil, X, Check, CalendarOff, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  adminDwmOverview, adminDwmArchive, generateWeeklyReport,
  adminUpdateSubmission, adminDeleteSubmission,
  setUserAvailability, clearUserAvailability, setUserOperational,
} from "@/lib/dwm.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/dwm")({ component: AdminDwm });

type Sub = { id: string; user_id: string; name: string; work_update: string; ai_summary: string | null; created_at: string; updated_at?: string };
type Profile = { id: string; full_name: string | null; email: string | null; is_active: boolean; is_operational: boolean };
type Availability = { id: string; user_id: string; status: "on_leave" | "mc" | "exempted"; note: string | null };
type Recipient = { id: string; email: string; is_active: boolean };

const STATUS_LABEL: Record<Availability["status"], string> = { on_leave: "On Leave", mc: "MC", exempted: "Exempted" };

function fmtDate(s: string | Date) {
  const d = typeof s === "string" ? new Date(s) : s;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AdminDwm() {
  const { role } = useAuth();
  const fetchOverview = useServerFn(adminDwmOverview);
  const fetchArchive = useServerFn(adminDwmArchive);
  const genReport = useServerFn(generateWeeklyReport);
  const adminUpdate = useServerFn(adminUpdateSubmission);
  const adminDelete = useServerFn(adminDeleteSubmission);
  const setAvail = useServerFn(setUserAvailability);
  const clearAvail = useServerFn(clearUserAvailability);
  const setOp = useServerFn(setUserOperational);

  const [loading, setLoading] = useState(true);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [activeUsers, setActiveUsers] = useState<Profile[]>([]);
  const [today, setToday] = useState<Sub[]>([]);
  const [week, setWeek] = useState<Sub[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [cutoff, setCutoff] = useState("17:30");
  const [cutoffDraft, setCutoffDraft] = useState("17:30");
  const [cutoffBusy, setCutoffBusy] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [newEmail, setNewEmail] = useState("");

  const [reportBusy, setReportBusy] = useState(false);
  const [report, setReport] = useState<{ summary: string; highlights: string; submissionsCount: number } | null>(null);

  const [archiveFrom, setArchiveFrom] = useState("");
  const [archiveTo, setArchiveTo] = useState("");
  const [archiveRows, setArchiveRows] = useState<Sub[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const loadAll = async () => {
    const [ov, c, r] = await Promise.all([
      fetchOverview(),
      supabase.from("app_settings").select("value").eq("key", "dwm_cutoff_time").maybeSingle(),
      supabase.from("report_recipients").select("id,email,is_active").order("email"),
    ]);
    const o = ov as any;
    setAllProfiles(o.allProfiles ?? []);
    setActiveUsers(o.activeUsers ?? []);
    setToday(o.today ?? []);
    setWeek(o.week ?? []);
    setAvailability(o.availability ?? []);
    const cv = (c.data?.value as string) ?? "17:30";
    setCutoff(cv); setCutoffDraft(cv);
    setRecipients((r.data as Recipient[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { if (role === "admin") loadAll(); }, [role]);

  const availMap = useMemo(() => {
    const m = new Map<string, Availability>();
    availability.forEach((a) => m.set(a.user_id, a));
    return m;
  }, [availability]);

  const submittedIds = useMemo(() => new Set(today.map((s) => s.user_id)), [today]);
  const pending = useMemo(
    () => activeUsers.filter((u) => !submittedIds.has(u.id) && !availMap.has(u.id)),
    [activeUsers, submittedIds, availMap]
  );
  const unavailable = useMemo(
    () => activeUsers.filter((u) => availMap.has(u.id) && !submittedIds.has(u.id)),
    [activeUsers, availMap, submittedIds]
  );

  const byUser = useMemo(() => {
    const m = new Map<string, { name: string; rows: Sub[] }>();
    for (const s of week) {
      if (!m.has(s.user_id)) m.set(s.user_id, { name: s.name, rows: [] });
      m.get(s.user_id)!.rows.push(s);
    }
    return Array.from(m.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [week]);

  const saveCutoff = async () => {
    if (!/^\d{1,2}:\d{2}$/.test(cutoffDraft)) return toast.error("Use HH:MM");
    setCutoffBusy(true);
    try {
      const { error } = await supabase.from("app_settings").upsert(
        { key: "dwm_cutoff_time", value: cutoffDraft, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (error) throw error;
      setCutoff(cutoffDraft);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setCutoffBusy(false); }
  };

  const addRecipient = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const { error } = await supabase.from("report_recipients").insert({ email, is_active: true });
    if (error) return toast.error(error.message);
    setNewEmail("");
    const { data } = await supabase.from("report_recipients").select("id,email,is_active").order("email");
    setRecipients((data as Recipient[]) ?? []);
  };
  const toggleRecipient = async (r: Recipient) => {
    await supabase.from("report_recipients").update({ is_active: !r.is_active }).eq("id", r.id);
    const { data } = await supabase.from("report_recipients").select("id,email,is_active").order("email");
    setRecipients((data as Recipient[]) ?? []);
  };
  const removeRecipient = async (r: Recipient) => {
    await supabase.from("report_recipients").delete().eq("id", r.id);
    setRecipients(recipients.filter((x) => x.id !== r.id));
  };

  const runReport = async () => {
    setReportBusy(true);
    try {
      const res: any = await genReport();
      if (!res.ok) { toast.error(res.error ?? "Failed"); return; }
      setReport({ summary: res.summary, highlights: res.highlights, submissionsCount: res.submissionsCount });
    } finally { setReportBusy(false); }
  };

  const runArchive = async () => {
    if (!archiveFrom || !archiveTo) return toast.error("Pick date range");
    setArchiveBusy(true);
    try {
      const res: any = await fetchArchive({ data: { fromDate: archiveFrom, toDate: archiveTo } });
      setArchiveRows(res.rows ?? []);
    } finally { setArchiveBusy(false); }
  };

  const exportRows = (rows: Sub[], name: string) => {
    if (rows.length === 0) return toast.error("Nothing to export.");
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Date", "Time", "Name", "Work Update", "Summary"].join(",");
    const lines = rows.map((r) => {
      const d = new Date(r.created_at);
      return [esc(d.toISOString().slice(0, 10)), esc(d.toLocaleTimeString()), esc(r.name), esc(r.work_update), esc(r.ai_summary ?? "")].join(",");
    });
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const onSaveEdit = async (id: string) => {
    if (!editText.trim()) return;
    try {
      await adminUpdate({ data: { id, work_update: editText.trim() } });
      toast.success("Updated.");
      setEditId(null);
      await loadAll();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this submission?")) return;
    try {
      await adminDelete({ data: { id } });
      toast.success("Deleted.");
      await loadAll();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const onSetAvail = async (user_id: string, status: Availability["status"]) => {
    try {
      await setAvail({ data: { user_id, status } });
      await loadAll();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  const onClearAvail = async (user_id: string) => {
    try {
      await clearAvail({ data: { user_id } });
      await loadAll();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  const onToggleOp = async (p: Profile) => {
    try {
      await setOp({ data: { user_id: p.id, is_operational: !p.is_operational } });
      await loadAll();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  if (role !== "admin") {
    return (
      <div className="min-h-screen">
        <WorkspaceHeader subtitle="Admin" />
        <div className="py-20 text-center text-muted-foreground">Admins only.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <WorkspaceHeader subtitle="DWM Admin" />
        <div className="py-20 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <WorkspaceHeader subtitle="DWM Admin" />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10 space-y-5">
        <div className="flex items-center justify-between">
          <Link to="/daily-work-matters" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 mr-1" /> Back to Daily Work Matters
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="size-11 rounded-lg bg-accent grid place-items-center shrink-0">
            <ShieldCheck className="size-5 text-accent-foreground" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold leading-tight">DWM Management Dashboard</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Consolidated reporting, roster & archive</p>
          </div>
        </div>

        {/* Stats */}
        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <Stat label="Operational users" value={activeUsers.length} />
            <Stat label="Submitted today" value={today.length} accent="text-emerald-600" />
            <Stat label="Pending today" value={pending.length} accent="text-amber-600" />
            <Stat label="Unavailable" value={unavailable.length} accent="text-sky-600" />
            <Stat label="7-day total" value={week.length} />
          </div>
        </Card>

        {/* Today consolidated report with admin edit/delete */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Today's consolidated report</h2>
            <Button variant="outline" size="sm" onClick={() => exportRows(today, `dwm_today_${new Date().toISOString().slice(0, 10)}`)}>
              <Download className="size-4" /> Export
            </Button>
          </div>
          {today.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions yet today.</p>
          ) : (
            <div className="space-y-2">
              {today.map((s) => (
                <div key={s.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 gap-2">
                    <span className="font-medium text-foreground">{s.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span>{fmtTime(s.created_at)}</span>
                      {editId !== s.id && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(s.id); setEditText(s.work_update); }}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(s.id)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {editId === s.id ? (
                    <div className="space-y-2">
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => onSaveEdit(s.id)}><Check className="size-4" /> Save override</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)}><X className="size-4" /> Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm whitespace-pre-wrap">{s.work_update}</div>
                      {s.ai_summary && <div className="mt-1 text-xs text-muted-foreground italic">Summary: {s.ai_summary}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {unavailable.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-[11px] uppercase tracking-wide font-medium text-sky-700 mb-2 inline-flex items-center gap-1.5">
                <CalendarOff className="size-3.5" /> Unavailable today ({unavailable.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {unavailable.map((u) => {
                  const a = availMap.get(u.id)!;
                  return (
                    <span key={u.id} className="text-xs rounded-full border bg-sky-50 text-sky-800 px-3 py-1">
                      {u.full_name ?? u.email} · <span className="font-medium">{STATUS_LABEL[a.status]}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Availability management */}
        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-semibold mb-3 inline-flex items-center gap-2"><CalendarOff className="size-4" /> Today's availability</h2>
          <p className="text-xs text-muted-foreground mb-3">Mark operational users as On Leave / MC / Exempted. They are excluded from Pending and shown under Unavailable Today.</p>
          {activeUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No operational users.</p>
          ) : (
            <div className="space-y-2">
              {activeUsers.map((u) => {
                const a = availMap.get(u.id);
                const submitted = submittedIds.has(u.id);
                return (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="text-sm min-w-0">
                      <div className="font-medium truncate">{u.full_name ?? u.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {submitted ? "Submitted today" : a ? `Marked ${STATUS_LABEL[a.status]}` : "Pending"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select value={a?.status ?? ""} onValueChange={(v) => onSetAvail(u.id, v as Availability["status"])}>
                        <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Mark…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="on_leave">On Leave</SelectItem>
                          <SelectItem value="mc">MC</SelectItem>
                          <SelectItem value="exempted">Exempted</SelectItem>
                        </SelectContent>
                      </Select>
                      {a && <Button size="sm" variant="ghost" onClick={() => onClearAvail(u.id)}>Clear</Button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Operational roster management */}
        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-semibold mb-3 inline-flex items-center gap-2"><Users className="size-4" /> Operational roster</h2>
          <p className="text-xs text-muted-foreground mb-3">Only users in the roster appear on the daily board.</p>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {allProfiles.filter((p) => p.is_active).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="text-sm min-w-0">
                  <div className="font-medium truncate">{p.full_name ?? p.email}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{p.is_operational ? "In roster" : "Not in roster"}</span>
                  <Switch checked={p.is_operational} onCheckedChange={() => onToggleOp(p)} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Weekly summary per user */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Weekly summary by user (last 7 days)</h2>
            <Button variant="outline" size="sm" onClick={() => exportRows(week, `dwm_week_${new Date().toISOString().slice(0, 10)}`)}>
              <Download className="size-4" /> Export
            </Button>
          </div>
          {byUser.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions in the last 7 days.</p>
          ) : (
            <div className="space-y-4">
              {byUser.map(([uid, g]) => (
                <div key={uid}>
                  <div className="font-medium text-sm mb-1">{g.name} <span className="text-muted-foreground">· {g.rows.length} submissions</span></div>
                  <div className="space-y-1">
                    {g.rows.map((r) => (
                      <div key={r.id} className="text-xs text-muted-foreground">
                        <span className="text-foreground/80">[{fmtDate(r.created_at)}]</span> {r.ai_summary ?? r.work_update.slice(0, 140)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* AI weekly management summary */}
        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-semibold inline-flex items-center gap-2"><Sparkles className="size-4" /> AI weekly management summary</h2>
          <Button className="mt-3" onClick={runReport} disabled={reportBusy}>
            {reportBusy ? <><Loader2 className="size-4 animate-spin" /> Generating…</> : <>Generate now</>}
          </Button>
          {report && (
            <div className="mt-4 rounded-md bg-muted p-4 text-sm space-y-3">
              <div className="text-xs text-muted-foreground">{report.submissionsCount} submissions analysed</div>
              <div className="whitespace-pre-wrap"><strong>Summary:</strong> {report.summary}</div>
              {report.highlights && <div className="whitespace-pre-wrap"><strong>Highlights:</strong>{"\n"}{report.highlights}</div>}
            </div>
          )}
        </Card>

        {/* Historical archive */}
        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-semibold mb-3">Historical archive</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={archiveFrom} onChange={(e) => setArchiveFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={archiveTo} onChange={(e) => setArchiveTo(e.target.value)} />
            </div>
            <Button onClick={runArchive} disabled={archiveBusy}>
              {archiveBusy ? <Loader2 className="size-4 animate-spin" /> : "Load"}
            </Button>
            {archiveRows.length > 0 && (
              <Button variant="outline" onClick={() => exportRows(archiveRows, `dwm_archive_${archiveFrom}_${archiveTo}`)}>
                <Download className="size-4" /> Export
              </Button>
            )}
          </div>
          {archiveRows.length > 0 && (
            <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
              {archiveRows.map((r) => (
                <div key={r.id} className="rounded-md border p-2 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span>{fmtDate(r.created_at)} {fmtTime(r.created_at)}</span>
                  </div>
                  <div className="mt-1 text-foreground/90 whitespace-pre-wrap">{r.work_update}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Settings */}
        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-semibold inline-flex items-center gap-2"><Clock className="size-4" /> Submission lock time</h2>
          <p className="text-xs text-muted-foreground mt-1">Users cannot edit submissions after this time each day.</p>
          <div className="mt-3 flex items-center gap-2">
            <Input type="time" value={cutoffDraft} onChange={(e) => setCutoffDraft(e.target.value)} className="w-40" />
            <Button onClick={saveCutoff} disabled={cutoffBusy}>{cutoffBusy ? "Saving…" : "Save"}</Button>
            <span className="text-xs text-muted-foreground">Current: {cutoff}</span>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-semibold inline-flex items-center gap-2"><Mail className="size-4" /> Weekly report recipients</h2>
          <div className="mt-3 flex gap-2">
            <Input type="email" placeholder="name@company.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <Button onClick={addRecipient} variant="outline">Add</Button>
          </div>
          <div className="mt-3 space-y-2">
            {recipients.length === 0 ? <p className="text-sm text-muted-foreground">No recipients yet.</p> :
              recipients.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="text-sm truncate">{r.email}</div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Switch checked={r.is_active} onCheckedChange={() => toggleRecipient(r)} />
                    <Button size="icon" variant="ghost" onClick={() => removeRecipient(r)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
