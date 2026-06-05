import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, ClipboardList, Loader2, Send, Pencil, Lock, X, Check, Download, Clock, Users, CheckCircle2, AlertCircle, ShieldCheck, CalendarOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { submitDailyUpdate, updateDailyUpdate, getTodayBoard, getMyWeeklyReport, getTeamWeeklyReport } from "@/lib/dwm.functions";
import { toast } from "sonner";
import { ModuleGate } from "@/hooks/use-module-permissions";

export const Route = createFileRoute("/_authenticated/daily-work-matters")({
  component: () => <ModuleGate name="daily_work_matters"><Page /></ModuleGate>,
});

type Submission = {
  id: string;
  user_id: string;
  name: string;
  work_update: string;
  ai_summary: string | null;
  created_at: string;
  updated_at?: string | null;
};

const DEFAULT_CUTOFF = "17:30";

function parseCutoff(v: unknown): string {
  if (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v)) return v;
  return DEFAULT_CUTOFF;
}

function isBeforeCutoff(cutoff: string): boolean {
  const now = new Date();
  const [h, m] = cutoff.split(":").map((n) => parseInt(n, 10));
  const cut = new Date();
  cut.setHours(h || 17, m || 30, 0, 0);
  return now.getTime() < cut.getTime();
}

function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(s: string | Date) {
  const d = typeof s === "string" ? new Date(s) : s;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function isEdited(s: Submission): boolean {
  if (!s.updated_at) return false;
  return Math.abs(new Date(s.updated_at).getTime() - new Date(s.created_at).getTime()) > 5000;
}

function Page() {
  const { user, role, profileName } = useAuth();
  const submit = useServerFn(submitDailyUpdate);
  const updateFn = useServerFn(updateDailyUpdate);
  const fetchBoard = useServerFn(getTodayBoard);
  const fetchWeek = useServerFn(getMyWeeklyReport);
  const fetchTeamWeek = useServerFn(getTeamWeeklyReport);

  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF);
  const [board, setBoard] = useState<{
    activeUsers: { id: string; name: string }[];
    submissions: Submission[];
    availability: { user_id: string; status: "on_leave" | "mc" | "exempted"; note: string | null }[];
  }>({ activeUsers: [], submissions: [], availability: [] });
  const [loading, setLoading] = useState(true);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const [weekOffset, setWeekOffset] = useState<0 | 1>(0);
  const [weekRows, setWeekRows] = useState<Submission[]>([]);
  const [weekRange, setWeekRange] = useState<{ s: string; e: string } | null>(null);

  type TeamUser = {
    id: string;
    name: string;
    days: Array<{ dayIndex: number; date: string; entries: Submission[] }>;
    weeklySummary: string | null;
    todayAvailability: { status: "on_leave" | "mc" | "exempted"; note: string | null } | null;
  };
  const [teamWeek, setTeamWeek] = useState<TeamUser[]>([]);

  const loadAll = async () => {
    const [c, b, t] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "dwm_cutoff_time").maybeSingle(),
      fetchBoard(),
      fetchTeamWeek(),
    ]);
    setCutoff(parseCutoff(c.data?.value));
    setBoard(b as any);
    setTeamWeek(((t as any).users ?? []) as TeamUser[]);
    setLoading(false);
  };

  const loadWeek = async (offset: 0 | 1) => {
    const res: any = await fetchWeek({ data: { weekOffset: offset } });
    setWeekRows(res.rows);
    setWeekRange({ s: res.weekStart, e: res.weekEnd });
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadWeek(weekOffset); }, [weekOffset]);

  const mySubmission = useMemo(
    () => board.submissions.find((s) => s.user_id === user?.id) ?? null,
    [board.submissions, user?.id]
  );

  const availMap = useMemo(() => {
    const m = new Map<string, { status: "on_leave" | "mc" | "exempted"; note: string | null }>();
    board.availability.forEach((a) => m.set(a.user_id, { status: a.status, note: a.note }));
    return m;
  }, [board.availability]);

  const submittedUserIds = useMemo(() => new Set(board.submissions.map((s) => s.user_id)), [board.submissions]);
  const unavailableUsers = useMemo(
    () => board.activeUsers.filter((u) => availMap.has(u.id) && !submittedUserIds.has(u.id)),
    [board.activeUsers, availMap, submittedUserIds]
  );
  const pendingUsers = useMemo(
    () => board.activeUsers.filter((u) => !submittedUserIds.has(u.id) && !availMap.has(u.id)),
    [board.activeUsers, submittedUserIds, availMap]
  );

  const editable = isBeforeCutoff(cutoff);
  const today = new Date();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res: any = await submit({ data: { work_update: text.trim() } });
      if (res?.ok === false) { toast.error(res.error ?? "Failed"); return; }
      setText("");
      toast.success("Submitted.");
      await loadAll();
      await loadWeek(weekOffset);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  };

  const onSaveEdit = async () => {
    if (!mySubmission || !editText.trim()) return;
    setBusy(true);
    try {
      const res: any = await updateFn({ data: { id: mySubmission.id, work_update: editText.trim() } });
      if (!res.ok) { toast.error(res.error ?? "Failed"); return; }
      toast.success("Updated.");
      setEditing(false);
      await loadAll();
      await loadWeek(weekOffset);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  };

  const exportWeekCsv = () => {
    if (weekRows.length === 0) return toast.error("Nothing to export.");
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Date", "Time", "Work Update", "Summary"].join(",");
    const rows = weekRows.map((r) => {
      const d = new Date(r.created_at);
      return [esc(d.toISOString().slice(0, 10)), esc(d.toLocaleTimeString()), esc(r.work_update), esc(r.ai_summary ?? "")].join(",");
    });
    const csv = "\uFEFF" + [header, ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `my-weekly-report_${(weekRange?.s ?? "").slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <WorkspaceHeader subtitle="Daily Work Matters" />
        <div className="py-20 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      </div>
    );
  }

  const totalActive = board.activeUsers.length;
  const totalSubmitted = board.submissions.length;
  const expectedToday = Math.max(totalActive - unavailableUsers.length, 0);

  return (
    <div className="min-h-screen pb-20">
      <WorkspaceHeader subtitle="Daily Work Matters" />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 mr-1" /> Workspace
          </Link>
          {role === "admin" && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/dwm"><ShieldCheck className="size-4" /> Admin dashboard</Link>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="size-11 rounded-lg bg-accent grid place-items-center shrink-0">
            <ClipboardList className="size-5 text-accent-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold leading-tight">Daily Work Matters</h1>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">Operational reporting · {profileName ?? user?.email}</p>
          </div>
        </div>

        {/* TODAY STATUS BAR */}
        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Today</div>
              <div className="text-sm font-semibold mt-1">{fmtDate(today)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Lock time</div>
              <div className="text-sm font-semibold mt-1 inline-flex items-center justify-center gap-1">
                <Clock className="size-3.5" /> {cutoff}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Submitted</div>
              <div className="text-sm font-semibold mt-1 text-emerald-600">{totalSubmitted}/{expectedToday}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Pending</div>
              <div className={`text-sm font-semibold mt-1 ${pendingUsers.length > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{pendingUsers.length}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Unavailable</div>
              <div className={`text-sm font-semibold mt-1 ${unavailableUsers.length > 0 ? "text-sky-600" : "text-muted-foreground"}`}>{unavailableUsers.length}</div>
            </div>
          </div>
        </Card>

        {/* MY DAILY SUBMISSION */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">My submission</h2>
            {!editable && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3.5" /> Locked</span>}
          </div>

          {!mySubmission ? (
            editable ? (
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="work" className="text-sm">What did you work on today?</Label>
                  <Textarea id="work" value={text} onChange={(e) => setText(e.target.value)} required rows={5}
                    placeholder="Key actions, outcomes, blockers…" maxLength={4000} className="text-base" />
                </div>
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                  {busy ? <><Loader2 className="size-4 animate-spin" /> Submitting…</> : <><Send className="size-4" /> Submit today's report</>}
                </Button>
              </form>
            ) : (
              <div className="rounded-md bg-muted/40 p-4 text-sm text-muted-foreground">
                Submissions are locked for today (after {cutoff}). You did not submit a report today.
              </div>
            )
          ) : editing ? (
            <div className="space-y-3">
              <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={5} maxLength={4000} className="text-base" />
              <div className="flex gap-2">
                <Button onClick={onSaveEdit} disabled={busy} className="flex-1 sm:flex-none">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}><X className="size-4" /> Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border bg-card p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Submitted at {fmtTime(mySubmission.created_at)}</span>
                  {isEdited(mySubmission) && <span className="text-amber-600">edited</span>}
                </div>
                <div className="text-sm whitespace-pre-wrap">{mySubmission.work_update}</div>
              </div>
              {editable ? (
                <Button variant="outline" size="sm" onClick={() => { setEditText(mySubmission.work_update); setEditing(true); }}>
                  <Pencil className="size-4" /> Edit
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1"><Lock className="size-3" /> Editing closed at {cutoff}</p>
              )}
            </div>
          )}
        </Card>

        {/* TEAM BOARD — WEEKLY PER-USER (Mon-Fri) */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold inline-flex items-center gap-2">
              <Users className="size-4" /> Team board · this week
            </h2>
            <span className="text-xs text-muted-foreground">Mon–Fri · {teamWeek.length} operational users</span>
          </div>

          {teamWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground">No operational users in the roster.</p>
          ) : (
            <div className="space-y-5">
              {teamWeek.map((u) => {
                const todayIdx = (() => {
                  const dow = new Date().getDay();
                  return dow === 0 ? -1 : dow - 1; // 0..4 = Mon..Fri
                })();
                const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
                const availLabel = u.todayAvailability
                  ? u.todayAvailability.status === "on_leave"
                    ? "On Leave"
                    : u.todayAvailability.status === "mc"
                    ? "MC"
                    : "Exempted"
                  : null;
                return (
                  <div key={u.id} className="rounded-md border p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="font-medium text-sm">{u.name}</div>
                      {availLabel && (
                        <span className="text-xs rounded-full border bg-sky-50 text-sky-800 px-2 py-0.5 inline-flex items-center gap-1">
                          <CalendarOff className="size-3" /> Today: {availLabel}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {u.days.map((d) => {
                        const isToday = d.dayIndex === todayIdx;
                        const isAvailDay = isToday && u.todayAvailability;
                        return (
                          <div key={d.dayIndex} className="grid grid-cols-[44px_1fr] gap-2 text-sm">
                            <div className={`text-xs font-medium pt-0.5 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                              {dayNames[d.dayIndex]}
                            </div>
                            <div className="min-w-0">
                              {d.entries.length === 0 ? (
                                isAvailDay ? (
                                  <span className="text-xs text-sky-700">{availLabel}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )
                              ) : (
                                <div className="space-y-1">
                                  {d.entries.map((e) => (
                                    <div key={e.id} className="whitespace-pre-wrap text-sm">
                                      {e.work_update}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {u.weeklySummary && (
                      <div className="mt-3 pt-3 border-t text-xs">
                        <span className="font-medium text-foreground">Weekly summary: </span>
                        <span className="text-muted-foreground">{u.weeklySummary}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* MY WEEKLY REPORTS */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">My weekly reports</h2>
            <Button variant="outline" size="sm" onClick={exportWeekCsv}>
              <Download className="size-4" /> Export
            </Button>
          </div>
          <Tabs value={String(weekOffset)} onValueChange={(v) => setWeekOffset(Number(v) as 0 | 1)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="0">This week</TabsTrigger>
              <TabsTrigger value="1">Last week</TabsTrigger>
            </TabsList>
            <TabsContent value="0" className="mt-3">
              <WeekList rows={weekRows} />
            </TabsContent>
            <TabsContent value="1" className="mt-3">
              <WeekList rows={weekRows} />
            </TabsContent>
          </Tabs>
          <p className="text-[11px] text-muted-foreground mt-3">Older reports are archived and accessible to admins only.</p>
        </Card>
      </main>
    </div>
  );
}

function WeekList({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-4">No submissions this week.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="rounded-md border p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{fmtDate(r.created_at)} · {fmtTime(r.created_at)}</span>
            {isEdited(r) && <span className="text-amber-600">edited</span>}
          </div>
          <div className="text-sm whitespace-pre-wrap">{r.work_update}</div>
        </div>
      ))}
    </div>
  );
}
