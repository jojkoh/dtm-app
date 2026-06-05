import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Truck, Users, ClipboardList, MapPin, Loader2, Sparkles, CalendarRange } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { ModuleGate } from "@/hooks/use-module-permissions";

export const Route = createFileRoute("/_authenticated/workforce")({
  component: () => <ModuleGate name="workforce_dispatch"><WorkforcePage /></ModuleGate>,
});

const TRADES = ["ACMV", "PLUMBING", "MT", "ELECTRICAL"] as const;
type Trade = typeof TRADES[number];

type Worker = { id: string; worker_name: string; phone: string | null; trade: string | null; worker_type: string; dormitory_block: string | null; active_status: boolean; user_id: string | null };
type Vehicle = { id: string; vehicle_name: string; vehicle_plate: string; vehicle_type: string | null; passenger_capacity: number; vehicle_status: string };
type Driver = { id: string; user_id: string | null; driver_name: string; phone: string | null; active_status: boolean; current_vehicle_id: string | null };
type Project = { id: string; name: string; location: string | null };
type Deployment = { id: string; deployment_date: string; project_id: string | null; reporting_time: string | null; return_time: string | null; trade_manager_id: string; remarks: string | null; deployment_status: string; template_id: string | null; source: string };
type Dispatch = { id: string; dispatch_date: string; status: string; created_by: string; published_at: string | null; notes: string | null };
type Trip = { id: string; deployment_id: string; vehicle_id: string | null; driver_id: string | null; departure_time: string | null; estimated_return_time: string | null; trip_status: string; remarks: string | null; dispatch_id: string | null };
type Template = { id: string; name: string; project_id: string | null; trade_manager_id: string; reporting_time: string | null; return_time: string | null; remarks: string | null; recurrence: string; weekday_mask: number; start_date: string; end_date: string | null; is_active: boolean };

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"] as const;

function statusColor(s: string) {
  switch (s) {
    case "completed": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "published": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "in_progress":
    case "departed":
    case "arrived": return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    case "assigned":
    case "draft": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "cancelled": return "bg-rose-500/15 text-rose-700 dark:text-rose-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function WorkforcePage() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const isTM = role === "trade_manager" || isAdmin;
  const isHub = role === "transport_hub" || isAdmin;
  const isDriver = role === "driver";
  const isWorker = role === "worker";

  const defaultTab = isHub ? "dispatch" : isTM ? "deployments" : isDriver ? "driver" : isWorker ? "worker" : "deployments";
  const [tab, setTab] = useState(defaultTab);

  return (
    <div className="min-h-screen">
      <WorkspaceHeader subtitle="Workforce Dispatch" />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Truck className="size-4" /> Workforce Dispatch
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-1">Daily deployment & transport</h1>
          <p className="text-muted-foreground mt-1 text-sm">Plan deployments, group trips intelligently, and dispatch drivers.</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto">
            {(isTM || isHub) && <TabsTrigger value="deployments">Deployments</TabsTrigger>}
            {(isTM || isHub) && <TabsTrigger value="templates">Templates</TabsTrigger>}
            {isHub && <TabsTrigger value="dispatch">Dispatch Board</TabsTrigger>}
            {(isDriver || isAdmin) && <TabsTrigger value="driver">Driver</TabsTrigger>}
            {(isWorker || isAdmin) && <TabsTrigger value="worker">My Transport</TabsTrigger>}
            {(isTM || isHub) && <TabsTrigger value="workforce">Workforce List</TabsTrigger>}
            {(isTM || isHub) && <TabsTrigger value="fleet">Fleet</TabsTrigger>}
          </TabsList>

          {(isTM || isHub) && <TabsContent value="deployments" className="mt-6"><DeploymentsTab userId={user!.id} /></TabsContent>}
          {(isTM || isHub) && <TabsContent value="templates" className="mt-6"><TemplatesTab userId={user!.id} /></TabsContent>}
          {isHub && <TabsContent value="dispatch" className="mt-6"><DispatchTab userId={user!.id} /></TabsContent>}
          {(isDriver || isAdmin) && <TabsContent value="driver" className="mt-6"><DriverTab userId={user!.id} /></TabsContent>}
          {(isWorker || isAdmin) && <TabsContent value="worker" className="mt-6"><WorkerTab userId={user!.id} /></TabsContent>}
          {(isTM || isHub) && <TabsContent value="workforce" className="mt-6"><WorkforceListTab /></TabsContent>}
          {(isTM || isHub) && <TabsContent value="fleet" className="mt-6"><FleetTab /></TabsContent>}
        </Tabs>
      </main>
    </div>
  );
}

/* ============= Workforce List (workers + drivers) ============= */
function WorkforceListTab() {
  const [sub, setSub] = useState<"workers" | "drivers">("workers");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={sub === "workers" ? "default" : "outline"} onClick={() => setSub("workers")}>Workers</Button>
        <Button size="sm" variant={sub === "drivers" ? "default" : "outline"} onClick={() => setSub("drivers")}>Drivers</Button>
      </div>
      {sub === "workers" ? <WorkersList /> : <DriversList />}
    </div>
  );
}

function WorkersList() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [w, setW] = useState({ worker_name: "", phone: "", trade: "" as Trade | "", dormitory_block: "Yishun" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Worker>>({});
  const load = async () => {
    const { data } = await supabase.from("workers").select("*").order("worker_name");
    setWorkers((data as Worker[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!w.worker_name) return toast.error("Name required");
    if (!w.trade) return toast.error("Trade required");
    const { error } = await supabase.from("workers").insert({
      worker_name: w.worker_name, phone: w.phone || null, trade: w.trade,
      worker_type: "in-house", dormitory_block: w.dormitory_block || null,
    });
    if (error) return toast.error(error.message);
    setW({ worker_name: "", phone: "", trade: "", dormitory_block: "Yishun" });
    load();
  };
  const toggle = async (id: string, active: boolean) => {
    await supabase.from("workers").update({ active_status: !active }).eq("id", id);
    load();
  };
  const startEdit = (x: Worker) => { setEditingId(x.id); setEditDraft({ worker_name: x.worker_name, phone: x.phone, trade: x.trade, dormitory_block: x.dormitory_block }); };
  const saveEdit = async () => {
    if (!editingId) return;
    const { error } = await supabase.from("workers").update(editDraft).eq("id", editingId);
    if (error) return toast.error(error.message);
    setEditingId(null); setEditDraft({}); load();
  };
  const remove = async (id: string) => {
    if (!confirm("Remove this worker?")) return;
    const { error } = await supabase.from("workers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-6">
      <Card className="p-5 space-y-3 h-fit">
        <h3 className="font-semibold">Add worker</h3>
        <Input placeholder="Name" value={w.worker_name} onChange={(e) => setW({ ...w, worker_name: e.target.value })} />
        <Input placeholder="Phone" value={w.phone} onChange={(e) => setW({ ...w, phone: e.target.value })} />
        <Select value={w.trade} onValueChange={(v) => setW({ ...w, trade: v as Trade })}>
          <SelectTrigger><SelectValue placeholder="Trade" /></SelectTrigger>
          <SelectContent>{TRADES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Dormitory" value={w.dormitory_block} onChange={(e) => setW({ ...w, dormitory_block: e.target.value })} />
        <Button onClick={add} className="w-full">Add worker</Button>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Workers ({workers.length})</h3>
        <div className="divide-y border rounded-md">
          {workers.map((x) => {
            const isEditing = editingId === x.id;
            return (
              <div key={x.id} className="px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
                {isEditing ? (
                  <>
                    <Input className="h-8 w-40" value={editDraft.worker_name ?? ""} onChange={(e) => setEditDraft({ ...editDraft, worker_name: e.target.value })} />
                    <Input className="h-8 w-32" placeholder="Phone" value={editDraft.phone ?? ""} onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })} />
                    <Select value={editDraft.trade ?? ""} onValueChange={(v) => setEditDraft({ ...editDraft, trade: v })}>
                      <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Trade" /></SelectTrigger>
                      <SelectContent>{TRADES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" onClick={saveEdit}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-[160px]">
                      <div className="font-medium">{x.worker_name} {x.trade && <span className="text-xs text-muted-foreground ml-1">· {x.trade}</span>}</div>
                      <div className="text-xs text-muted-foreground">{x.phone ?? "—"} {x.dormitory_block ? `· ${x.dormitory_block}` : ""}</div>
                    </div>
                    <Badge variant="secondary" className={statusColor(x.active_status ? "completed" : "cancelled")}>
                      {x.active_status ? "Active" : "Inactive"}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => toggle(x.id, x.active_status)}>{x.active_status ? "Deactivate" : "Activate"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(x)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(x.id)}>Remove</Button>
                  </>
                )}
              </div>
            );
          })}
          {workers.length === 0 && <div className="p-3 text-sm text-muted-foreground">No workers yet.</div>}
        </div>
      </Card>
    </div>
  );
}

function DriversList() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [d, setD] = useState({ driver_name: "", phone: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Driver>>({});
  const load = async () => {
    const { data } = await supabase.from("drivers").select("*").order("driver_name");
    setDrivers((data as Driver[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!d.driver_name) return toast.error("Name required");
    const { error } = await supabase.from("drivers").insert({ driver_name: d.driver_name, phone: d.phone || null });
    if (error) return toast.error(error.message);
    setD({ driver_name: "", phone: "" });
    load();
  };
  const toggle = async (id: string, active: boolean) => {
    await supabase.from("drivers").update({ active_status: !active }).eq("id", id);
    load();
  };
  const startEdit = (x: Driver) => { setEditingId(x.id); setEditDraft({ driver_name: x.driver_name, phone: x.phone }); };
  const saveEdit = async () => {
    if (!editingId) return;
    const { error } = await supabase.from("drivers").update(editDraft).eq("id", editingId);
    if (error) return toast.error(error.message);
    setEditingId(null); setEditDraft({}); load();
  };
  const remove = async (id: string) => {
    if (!confirm("Remove this driver?")) return;
    const { error } = await supabase.from("drivers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-6">
      <Card className="p-5 space-y-3 h-fit">
        <h3 className="font-semibold">Add driver</h3>
        <Input placeholder="Name" value={d.driver_name} onChange={(e) => setD({ ...d, driver_name: e.target.value })} />
        <Input placeholder="Phone" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
        <Button onClick={add} className="w-full">Add driver</Button>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Drivers ({drivers.length})</h3>
        <div className="divide-y border rounded-md">
          {drivers.map((x) => {
            const isEditing = editingId === x.id;
            return (
              <div key={x.id} className="px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
                {isEditing ? (
                  <>
                    <Input className="h-8 w-40" value={editDraft.driver_name ?? ""} onChange={(e) => setEditDraft({ ...editDraft, driver_name: e.target.value })} />
                    <Input className="h-8 w-32" placeholder="Phone" value={editDraft.phone ?? ""} onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })} />
                    <Button size="sm" onClick={saveEdit}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1">
                      <div className="font-medium">{x.driver_name}</div>
                      <div className="text-xs text-muted-foreground">{x.phone ?? "—"}</div>
                    </div>
                    <Badge variant="secondary" className={statusColor(x.active_status ? "completed" : "cancelled")}>
                      {x.active_status ? "Available" : "Unavailable"}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => toggle(x.id, x.active_status)}>{x.active_status ? "Set unavailable" : "Set available"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(x)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(x.id)}>Remove</Button>
                  </>
                )}
              </div>
            );
          })}
          {drivers.length === 0 && <div className="p-3 text-sm text-muted-foreground">No drivers yet.</div>}
        </div>
      </Card>
    </div>
  );
}

/* ============= Deployments ============= */
function DeploymentsTab({ userId }: { userId: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [depWorkers, setDepWorkers] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ deployment_date: today, project_id: "", reporting_time: "08:00", return_time: "18:00", remarks: "", worker_ids: [] as string[] });

  const load = async () => {
    setLoading(true);
    const [p, w, d] = await Promise.all([
      supabase.from("projects").select("id,name,location").order("name"),
      supabase.from("workers").select("*").eq("active_status", true).in("trade", TRADES as any).order("worker_name"),
      supabase.from("deployments").select("*").order("deployment_date", { ascending: false }).limit(50),
    ]);
    setProjects((p.data as Project[]) ?? []);
    setWorkers((w.data as Worker[]) ?? []);
    const depList = (d.data as Deployment[]) ?? [];
    setDeps(depList);
    if (depList.length) {
      const { data: dw } = await supabase.from("deployment_workers").select("deployment_id,worker_id").in("deployment_id", depList.map((x) => x.id));
      const map: Record<string, string[]> = {};
      (dw ?? []).forEach((r: any) => { (map[r.deployment_id] ||= []).push(r.worker_id); });
      setDepWorkers(map);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.project_id) return toast.error("Select a site");
    if (!form.worker_ids.length) return toast.error("Assign at least one worker");
    const { data: dep, error } = await supabase.from("deployments").insert({
      deployment_date: form.deployment_date, project_id: form.project_id,
      reporting_time: form.reporting_time || null, return_time: form.return_time || null,
      trade_manager_id: userId, remarks: form.remarks || null, deployment_status: "pending", source: "manual",
    }).select().single();
    if (error || !dep) return toast.error(error?.message ?? "Failed");
    const rows = form.worker_ids.map((wid) => ({ deployment_id: dep.id, worker_id: wid }));
    const { error: err2 } = await supabase.from("deployment_workers").insert(rows);
    if (err2) return toast.error(err2.message);
    toast.success("Deployment created");
    setForm({ ...form, remarks: "", worker_ids: [] });
    load();
  };

  return (
    <div className="grid lg:grid-cols-[420px_1fr] gap-6">
      <Card className="p-5 space-y-4 h-fit">
        <h3 className="font-semibold">New deployment</h3>
        <div className="space-y-2">
          <Label>Site</Label>
          <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
            <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ""}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.deployment_date} onChange={(e) => setForm({ ...form, deployment_date: e.target.value })} /></div>
          <div className="space-y-2"><Label>Report</Label><Input type="time" value={form.reporting_time} onChange={(e) => setForm({ ...form, reporting_time: e.target.value })} /></div>
          <div className="space-y-2"><Label>Return</Label><Input type="time" value={form.return_time} onChange={(e) => setForm({ ...form, return_time: e.target.value })} /></div>
        </div>
        <div className="space-y-2">
          <Label>Workers ({form.worker_ids.length} selected)</Label>
          <div className="max-h-60 overflow-auto border rounded-md divide-y">
            {workers.map((w) => {
              const checked = form.worker_ids.includes(w.id);
              return (
                <label key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                  <Checkbox checked={checked} onCheckedChange={(c) => setForm((f) => ({ ...f, worker_ids: c ? [...f.worker_ids, w.id] : f.worker_ids.filter((x) => x !== w.id) }))} />
                  <span className="font-medium">{w.worker_name}</span>
                  {w.trade && <span className="text-xs text-muted-foreground">{w.trade}</span>}
                </label>
              );
            })}
            {workers.length === 0 && <div className="p-3 text-xs text-muted-foreground">No active workers.</div>}
          </div>
        </div>
        <div className="space-y-2"><Label>Remarks</Label><Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
        <Button onClick={submit} className="w-full">Create deployment</Button>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Recent deployments</h3>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>
        {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : (
          <div className="space-y-2">
            {deps.map((d) => (
              <DeploymentRow key={d.id} dep={d} projects={projects} workers={workers} workerIds={depWorkers[d.id] ?? []} onChanged={load} />
            ))}
            {deps.length === 0 && <p className="text-sm text-muted-foreground">No deployments yet.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

function DeploymentRow({ dep, projects, workers, workerIds, onChanged }: { dep: Deployment; projects: Project[]; workers: Worker[]; workerIds: string[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    deployment_date: dep.deployment_date,
    project_id: dep.project_id ?? "",
    reporting_time: dep.reporting_time?.slice(0, 5) ?? "",
    return_time: dep.return_time?.slice(0, 5) ?? "",
    remarks: dep.remarks ?? "",
    worker_ids: [...workerIds],
  });
  const proj = projects.find((p) => p.id === dep.project_id);

  const save = async () => {
    const { error } = await supabase.from("deployments").update({
      deployment_date: draft.deployment_date,
      project_id: draft.project_id || null,
      reporting_time: draft.reporting_time || null,
      return_time: draft.return_time || null,
      remarks: draft.remarks || null,
    }).eq("id", dep.id);
    if (error) return toast.error(error.message);
    // resync workers
    await supabase.from("deployment_workers").delete().eq("deployment_id", dep.id);
    if (draft.worker_ids.length) {
      await supabase.from("deployment_workers").insert(draft.worker_ids.map((wid) => ({ deployment_id: dep.id, worker_id: wid })));
    }
    toast.success("Deployment saved. Linked dispatch (if any) reverted to draft.");
    setEditing(false);
    onChanged();
  };
  const remove = async () => {
    if (!confirm("Delete this deployment?")) return;
    const { error } = await supabase.from("deployments").delete().eq("id", dep.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  if (!editing) {
    return (
      <div className="border rounded-md p-3 flex flex-wrap items-center gap-3 text-sm">
        <div className="min-w-[110px]">
          <div className="font-medium">{dep.deployment_date}</div>
          <div className="text-xs text-muted-foreground">{dep.reporting_time?.slice(0,5)} → {dep.return_time?.slice(0,5)}</div>
        </div>
        <div className="flex-1 min-w-[160px]">
          <div className="font-medium flex items-center gap-1"><MapPin className="size-3" />{proj?.name ?? "—"}</div>
          {proj?.location && <div className="text-xs text-muted-foreground">{proj.location}</div>}
          {dep.remarks && <div className="text-xs text-muted-foreground">{dep.remarks}</div>}
        </div>
        {dep.source === "template" && <Badge variant="outline" className="text-xs">template</Badge>}
        <Badge variant="secondary" className={statusColor(dep.deployment_status)}>{dep.deployment_status}</Badge>
        <div className="text-xs text-muted-foreground"><Users className="size-3 inline mr-1" />{workerIds.length}</div>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="ghost" className="text-rose-600" onClick={remove}>Remove</Button>
      </div>
    );
  }
  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/20">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1 col-span-2"><Label className="text-xs">Site</Label>
          <Select value={draft.project_id} onValueChange={(v) => setDraft({ ...draft, project_id: v })}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Site" /></SelectTrigger>
            <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Date</Label><Input type="date" className="h-8" value={draft.deployment_date} onChange={(e) => setDraft({ ...draft, deployment_date: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-1">
          <div className="space-y-1"><Label className="text-xs">Start</Label><Input type="time" className="h-8" value={draft.reporting_time} onChange={(e) => setDraft({ ...draft, reporting_time: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Return</Label><Input type="time" className="h-8" value={draft.return_time} onChange={(e) => setDraft({ ...draft, return_time: e.target.value })} /></div>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Workers ({draft.worker_ids.length})</Label>
        <div className="max-h-40 overflow-auto border rounded-md divide-y bg-background">
          {workers.map((w) => {
            const checked = draft.worker_ids.includes(w.id);
            return (
              <label key={w.id} className="flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-muted/40">
                <Checkbox checked={checked} onCheckedChange={(c) => setDraft((dr) => ({ ...dr, worker_ids: c ? [...dr.worker_ids, w.id] : dr.worker_ids.filter((x) => x !== w.id) }))} />
                <span className="font-medium">{w.worker_name}</span>
                {w.trade && <span className="text-muted-foreground">{w.trade}</span>}
              </label>
            );
          })}
        </div>
      </div>
      <Textarea rows={2} placeholder="Remarks" value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} />
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" onClick={save}>Save</Button>
      </div>
    </div>
  );
}

/* ============= Templates ============= */
function TemplatesTab({ userId }: { userId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplWorkers, setTplWorkers] = useState<Record<string, string[]>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({
    name: "", project_id: "", reporting_time: "08:00", return_time: "18:00", remarks: "",
    recurrence: "weekdays", weekday_mask: 62, start_date: new Date().toISOString().slice(0,10), worker_ids: [] as string[],
  });

  const load = async () => {
    const [t, p, w] = await Promise.all([
      supabase.from("deployment_templates").select("*").order("created_at", { ascending: false }),
      supabase.from("projects").select("id,name,location").order("name"),
      supabase.from("workers").select("*").eq("active_status", true).in("trade", TRADES as any).order("worker_name"),
    ]);
    const ts = (t.data as Template[]) ?? [];
    setTemplates(ts);
    setProjects((p.data as Project[]) ?? []);
    setWorkers((w.data as Worker[]) ?? []);
    if (ts.length) {
      const { data: tw } = await supabase.from("deployment_template_workers").select("template_id,worker_id").in("template_id", ts.map((x) => x.id));
      const map: Record<string, string[]> = {};
      (tw ?? []).forEach((r: any) => { (map[r.template_id] ||= []).push(r.worker_id); });
      setTplWorkers(map);
    }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.name || !form.project_id || !form.worker_ids.length) return toast.error("Name, site, and workers required");
    const { data: t, error } = await supabase.from("deployment_templates").insert({
      name: form.name, project_id: form.project_id, trade_manager_id: userId,
      reporting_time: form.reporting_time, return_time: form.return_time, remarks: form.remarks || null,
      recurrence: form.recurrence, weekday_mask: form.weekday_mask, start_date: form.start_date,
    }).select().single();
    if (error || !t) return toast.error(error?.message ?? "Failed");
    await supabase.from("deployment_template_workers").insert(form.worker_ids.map((wid) => ({ template_id: t.id, worker_id: wid })));
    toast.success("Template created");
    setForm({ ...form, name: "", remarks: "", worker_ids: [] });
    load();
  };

  const toggle = async (id: string, active: boolean) => {
    await supabase.from("deployment_templates").update({ is_active: !active }).eq("id", id);
    load();
  };

  const generateNext14 = async () => {
    setGenerating(true);
    let total = 0;
    const start = new Date();
    for (let i = 0; i < 14; i++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      const ds = dt.toISOString().slice(0, 10);
      const { data, error } = await supabase.rpc("generate_deployments_from_templates", { target_date: ds });
      if (!error && typeof data === "number") total += data;
    }
    setGenerating(false);
    toast.success(`Generated ${total} deployments`);
  };

  const toggleDay = (bit: number) => {
    setForm((f) => ({ ...f, weekday_mask: f.weekday_mask ^ bit }));
  };

  return (
    <div className="grid lg:grid-cols-[420px_1fr] gap-6">
      <Card className="p-5 space-y-4 h-fit">
        <h3 className="font-semibold flex items-center gap-2"><CalendarRange className="size-4" /> New template</h3>
        <Input placeholder="Template name (e.g. Bugis daily M&E)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
          <SelectTrigger><SelectValue placeholder="Site" /></SelectTrigger>
          <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ""}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1"><Label className="text-xs">Start</Label><Input type="time" value={form.reporting_time} onChange={(e) => setForm({ ...form, reporting_time: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Return</Label><Input type="time" value={form.return_time} onChange={(e) => setForm({ ...form, return_time: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
        </div>
        <div className="space-y-2">
          <Label>Recurrence</Label>
          <Select value={form.recurrence} onValueChange={(v) => setForm({ ...form, recurrence: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekdays">Mon–Fri</SelectItem>
              <SelectItem value="weekly">Weekly (pick days)</SelectItem>
            </SelectContent>
          </Select>
          {form.recurrence === "weekly" && (
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const bit = 1 << i;
                const on = (form.weekday_mask & bit) !== 0;
                return <Button key={d} type="button" size="sm" variant={on ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => toggleDay(bit)}>{d}</Button>;
              })}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>Workers ({form.worker_ids.length})</Label>
          <div className="max-h-48 overflow-auto border rounded-md divide-y">
            {workers.map((w) => {
              const checked = form.worker_ids.includes(w.id);
              return (
                <label key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                  <Checkbox checked={checked} onCheckedChange={(c) => setForm((f) => ({ ...f, worker_ids: c ? [...f.worker_ids, w.id] : f.worker_ids.filter((x) => x !== w.id) }))} />
                  <span className="font-medium">{w.worker_name}</span>
                  {w.trade && <span className="text-xs text-muted-foreground">{w.trade}</span>}
                </label>
              );
            })}
          </div>
        </div>
        <Textarea rows={2} placeholder="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        <Button onClick={submit} className="w-full">Create template</Button>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Active templates ({templates.length})</h3>
          <Button size="sm" onClick={generateNext14} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : "Generate next 14 days"}
          </Button>
        </div>
        <div className="space-y-2">
          {templates.map((t) => {
            const proj = projects.find((p) => p.id === t.project_id);
            const ws = tplWorkers[t.id] ?? [];
            const days = t.recurrence === "daily" ? "Every day" :
              t.recurrence === "weekdays" ? "Mon–Fri" :
              DAYS.filter((_, i) => (t.weekday_mask & (1 << i)) !== 0).join(", ");
            return (
              <div key={t.id} className="border rounded-md p-3 flex flex-wrap items-center gap-3 text-sm">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{proj?.name ?? "—"} · {days} · {t.reporting_time?.slice(0,5)} → {t.return_time?.slice(0,5)} · {ws.length} workers</div>
                </div>
                <Badge variant="secondary" className={statusColor(t.is_active ? "completed" : "cancelled")}>{t.is_active ? "Active" : "Paused"}</Badge>
                <Button size="sm" variant="ghost" onClick={() => toggle(t.id, t.is_active)}>{t.is_active ? "Pause" : "Resume"}</Button>
              </div>
            );
          })}
          {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates. Create one to auto-generate daily deployments.</p>}
        </div>
      </Card>
    </div>
  );
}

/* ============= Dispatch Board (Hub) ============= */
type Suggestion = {
  key: string;
  depIds: string[];
  workerCount: number;
  sites: { id: string; name: string; location: string | null }[];
  earliestReport: string;
  suggestedDeparture: string;
  reason: string;
};

function normalizeTokens(s: string | null): string[] {
  if (!s) return [];
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}
function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0; sa.forEach((x) => { if (sb.has(x)) inter++; });
  return inter / (sa.size + sb.size - inter);
}
function subtract30(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m - 30;
  const hh = Math.max(0, Math.floor(t / 60));
  const mm = ((t % 60) + 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function buildSuggestions(deps: Deployment[], projects: Project[], depWorkers: Record<string, string[]>): Suggestion[] {
  const items = deps
    .filter((d) => d.reporting_time)
    .map((d) => {
      const proj = projects.find((p) => p.id === d.project_id);
      return { d, proj, tokens: [...normalizeTokens(proj?.name ?? null), ...normalizeTokens(proj?.location ?? null)] };
    });
  const clusters: typeof items[] = [];
  items.forEach((it) => {
    let placed = false;
    for (const c of clusters) {
      if (jaccard(it.tokens, c[0].tokens) >= 0.34 && Math.abs(toMin(it.d.reporting_time!) - toMin(c[0].d.reporting_time!)) <= 30) {
        c.push(it); placed = true; break;
      }
    }
    if (!placed) clusters.push([it]);
  });
  return clusters.map((c, i) => {
    const earliest = c.reduce((min, x) => toMin(x.d.reporting_time!) < toMin(min) ? x.d.reporting_time! : min, c[0].d.reporting_time!);
    const wCount = c.reduce((sum, x) => sum + (depWorkers[x.d.id]?.length ?? 0), 0);
    return {
      key: `s${i}`,
      depIds: c.map((x) => x.d.id),
      workerCount: wCount,
      sites: c.map((x) => ({ id: x.d.id, name: x.proj?.name ?? "—", location: x.proj?.location ?? null })),
      earliestReport: earliest.slice(0, 5),
      suggestedDeparture: subtract30(earliest.slice(0, 5)),
      reason: c.length > 1 ? "Nearby sites, compatible report times" : "Single site",
    };
  }).sort((a, b) => b.workerCount - a.workerCount);
}
function toMin(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

function DispatchTab({ userId }: { userId: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [workersAll, setWorkersAll] = useState<Worker[]>([]);
  const [depWorkers, setDepWorkers] = useState<Record<string, string[]>>({});
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ depIds: string[]; departure: string }>({ depIds: [], departure: "" });

  const load = async () => {
    setLoading(true);
    const [d, p, dr, vs, wAll, ds] = await Promise.all([
      supabase.from("deployments").select("*").eq("deployment_date", date),
      supabase.from("projects").select("id,name,location"),
      supabase.from("drivers").select("*").eq("active_status", true).order("driver_name"),
      supabase.from("vehicles").select("*").eq("vehicle_status", "available").order("vehicle_name"),
      supabase.from("workers").select("*").eq("active_status", true).order("worker_name"),
      supabase.from("dispatches").select("*").eq("dispatch_date", date).order("created_at", { ascending: false }),
    ]);
    const depList = (d.data as Deployment[]) ?? [];
    const dispList = (ds.data as Dispatch[]) ?? [];
    setDeps(depList);
    setProjects((p.data as Project[]) ?? []);
    setDrivers((dr.data as Driver[]) ?? []);
    setVehicles((vs.data as Vehicle[]) ?? []);
    setWorkersAll((wAll.data as Worker[]) ?? []);
    setDispatches(dispList);

    // Load trips by dispatch_id for accurate visibility
    let tripList: Trip[] = [];
    if (dispList.length) {
      const { data: t } = await supabase.from("trips").select("*").in("dispatch_id", dispList.map((x) => x.id));
      tripList = (t as Trip[]) ?? [];
    }
    setTrips(tripList);

    if (depList.length) {
      const { data: dw } = await supabase.from("deployment_workers").select("deployment_id,worker_id").in("deployment_id", depList.map((x) => x.id));
      const map: Record<string, string[]> = {};
      (dw ?? []).forEach((r: any) => { (map[r.deployment_id] ||= []).push(r.worker_id); });
      setDepWorkers(map);
    } else setDepWorkers({});
    setLoading(false);
  };
  useEffect(() => { load(); }, [date]);

  const tripDepIds = useMemo(() => new Set(trips.map((t) => t.deployment_id)), [trips]);
  const pendingDeps = useMemo(() => deps.filter((d) => !tripDepIds.has(d.id)), [deps, tripDepIds]);
  const suggestions = useMemo(() => buildSuggestions(pendingDeps, projects, depWorkers), [pendingDeps, projects, depWorkers]);

  const ensureDraft = async (): Promise<Dispatch | null> => {
    let draft = dispatches.find((x) => x.status === "draft");
    if (draft) return draft;
    const { data, error } = await supabase.from("dispatches").insert({ dispatch_date: date, status: "draft", created_by: userId }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Could not create dispatch"); return null; }
    return data as Dispatch;
  };

  const saveSuggestionAsDraft = async (depIds: string[], departure: string) => {
    if (!depIds.length) return toast.error("Pick at least one site");
    if (!departure) return toast.error("Departure time required");
    const draft = await ensureDraft();
    if (!draft) return;
    const departIso = new Date(`${date}T${departure}:00`).toISOString();
    for (const depId of depIds) {
      await supabase.from("trips").insert({
        deployment_id: depId, dispatch_id: draft.id,
        departure_time: departIso, trip_status: "assigned",
      });
    }
    toast.success("Saved to draft dispatch");
    setEditingKey(null);
    load();
  };

  const startEditSuggestion = (s: Suggestion) => {
    setEditingKey(s.key);
    setEditDraft({ depIds: [...s.depIds], departure: s.suggestedDeparture });
  };

  const updateTrip = async (id: string, patch: Partial<Trip>) => {
    const { error } = await supabase.from("trips").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };
  const removeTrip = async (id: string) => {
    if (!confirm("Remove this trip from dispatch?")) return;
    await supabase.from("trips").delete().eq("id", id);
    load();
  };

  const publish = async (id: string) => {
    const { error } = await supabase.from("dispatches").update({ status: "published", published_at: new Date().toISOString(), published_by: userId }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Dispatch published");
    load();
  };

  const markCompleted = async (id: string) => {
    await supabase.from("dispatches").update({ status: "completed" }).eq("id", id);
    load();
  };

  if (loading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>

      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="size-4" /> AI dispatch suggestions</h3>
        <p className="text-xs text-muted-foreground mb-3">Flow: AI Suggestion → Edit (optional) → Save Draft → Publish</p>
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending deployments to group for this date.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {suggestions.map((s) => {
              const isEditing = editingKey === s.key;
              if (!isEditing) {
                return (
                  <Card key={s.key} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">Suggested Trip · {s.workerCount} workers</div>
                      <Badge variant="secondary" className="text-xs">{s.suggestedDeparture}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Sites:</span> {s.sites.map((x) => x.name).join(", ")}
                    </div>
                    <div className="text-xs text-muted-foreground">Report: {s.earliestReport} · {s.reason}</div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => startEditSuggestion(s)}>Edit</Button>
                      <Button size="sm" className="flex-1" onClick={() => saveSuggestionAsDraft(s.depIds, s.suggestedDeparture)}>Save Draft</Button>
                    </div>
                  </Card>
                );
              }
              // edit mode — pick which deployments (sites & workers come from those deps), departure time
              return (
                <Card key={s.key} className="p-4 space-y-2 ring-2 ring-primary/40">
                  <div className="font-medium text-sm">Edit suggestion</div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sites & workers</Label>
                    <div className="max-h-40 overflow-auto border rounded-md divide-y bg-background">
                      {s.depIds.map((depId) => {
                        const dep = pendingDeps.find((x) => x.id === depId);
                        const proj = projects.find((p) => p.id === dep?.project_id);
                        const wIds = depWorkers[depId] ?? [];
                        const wNames = wIds.map((wid) => workersAll.find((w) => w.id === wid)?.worker_name).filter(Boolean).join(", ");
                        const checked = editDraft.depIds.includes(depId);
                        return (
                          <label key={depId} className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-muted/40">
                            <Checkbox checked={checked} onCheckedChange={(c) => setEditDraft((dr) => ({ ...dr, depIds: c ? [...dr.depIds, depId] : dr.depIds.filter((x) => x !== depId) }))} />
                            <div className="flex-1">
                              <div className="font-medium">{proj?.name ?? "—"} <span className="text-muted-foreground">· {wIds.length} workers</span></div>
                              {wNames && <div className="text-muted-foreground">{wNames}</div>}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Departure</Label>
                    <Input type="time" className="h-8 w-28" value={editDraft.departure} onChange={(e) => setEditDraft({ ...editDraft, departure: e.target.value })} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="flex-1" onClick={() => setEditingKey(null)}>Cancel</Button>
                    <Button size="sm" className="flex-1" onClick={() => saveSuggestionAsDraft(editDraft.depIds, editDraft.departure)}>Save Draft</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      {dispatches.map((dsp) => {
        const dspTrips = trips.filter((t) => t.dispatch_id === dsp.id);
        return (
          <Card key={dsp.id} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">Dispatch · {dsp.dispatch_date}</h3>
                <div className="text-xs text-muted-foreground">{dspTrips.length} trips</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={statusColor(dsp.status)}>{dsp.status}</Badge>
                {dsp.status === "draft" && <Button size="sm" onClick={() => publish(dsp.id)}>Publish</Button>}
                {dsp.status === "published" && <Button size="sm" variant="outline" onClick={() => markCompleted(dsp.id)}>Mark completed</Button>}
              </div>
            </div>
            <div className="space-y-2">
              {dspTrips.map((t) => {
                const dep = deps.find((d) => d.id === t.deployment_id);
                const proj = projects.find((p) => p.id === dep?.project_id);
                const wCount = depWorkers[t.deployment_id]?.length ?? 0;
                return (
                  <div key={t.id} className="border rounded-md p-3 flex flex-wrap items-center gap-2 text-sm">
                    <div className="flex-1 min-w-[160px]">
                      <div className="font-medium">{proj?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{wCount} workers · report {dep?.reporting_time?.slice(0,5)}</div>
                    </div>
                    <Select value={t.driver_id ?? ""} onValueChange={(v) => updateTrip(t.id, { driver_id: v })} disabled={dsp.status !== "draft"}>
                      <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Driver" /></SelectTrigger>
                      <SelectContent>{drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.driver_name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={t.vehicle_id ?? ""} onValueChange={(v) => updateTrip(t.id, { vehicle_id: v })} disabled={dsp.status !== "draft"}>
                      <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Vehicle" /></SelectTrigger>
                      <SelectContent>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="time" className="h-8 w-24 text-xs" disabled={dsp.status !== "draft"}
                      value={t.departure_time ? new Date(t.departure_time).toISOString().slice(11, 16) : ""}
                      onChange={(e) => updateTrip(t.id, { departure_time: new Date(`${date}T${e.target.value}:00`).toISOString() })} />
                    <Badge variant="secondary" className={statusColor(t.trip_status)}>{t.trip_status}</Badge>
                    {dsp.status === "draft" && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => removeTrip(t.id)}>Remove</Button>}
                  </div>
                );
              })}
              {dspTrips.length === 0 && <p className="text-xs text-muted-foreground">No trips. Save a suggestion above.</p>}
            </div>
          </Card>
        );
      })}

      {dispatches.length === 0 && (
        <p className="text-sm text-muted-foreground">No dispatch for this date yet. Save a suggestion above to start a draft.</p>
      )}
    </div>
  );
}

/* ============= Driver ============= */
function DriverTab({ userId }: { userId: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [driver, setDriver] = useState<Driver | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: dr } = await supabase.from("drivers").select("*").eq("user_id", userId).maybeSingle();
    setDriver((dr as Driver) ?? null);
    const { data: vs } = await supabase.from("vehicles").select("*").eq("vehicle_status", "available");
    setVehicles((vs as Vehicle[]) ?? []);
    if (!dr) { setLoading(false); return; }

    // Pull dispatches for the selected date that are published or completed
    const { data: ds } = await supabase
      .from("dispatches")
      .select("*")
      .eq("dispatch_date", date)
      .in("status", ["published", "completed"]);
    const dispList = (ds as Dispatch[]) ?? [];
    setDispatches(dispList);

    if (!dispList.length) { setTrips([]); setDeps([]); setProjects([]); setCounts({}); setLoading(false); return; }

    const { data: t } = await supabase
      .from("trips")
      .select("*")
      .in("dispatch_id", dispList.map((x) => x.id))
      .eq("driver_id", dr.id);
    const tList = (t as Trip[]) ?? [];
    setTrips(tList);

    if (!tList.length) { setDeps([]); setProjects([]); setCounts({}); setLoading(false); return; }
    const depIds = [...new Set(tList.map((x) => x.deployment_id))];
    const [{ data: d }, { data: p }, { data: dw }] = await Promise.all([
      supabase.from("deployments").select("*").in("id", depIds),
      supabase.from("projects").select("id,name,location"),
      supabase.from("deployment_workers").select("deployment_id,worker_id").in("deployment_id", depIds),
    ]);
    setDeps((d as Deployment[]) ?? []);
    setProjects((p as Project[]) ?? []);
    const cmap: Record<string, number> = {};
    (dw ?? []).forEach((r: any) => { cmap[r.deployment_id] = (cmap[r.deployment_id] ?? 0) + 1; });
    setCounts(cmap);
    setLoading(false);
  };
  useEffect(() => { load(); }, [userId, date]);

  const update = async (id: string, status: string) => {
    const { error } = await supabase.from("trips").update({ trip_status: status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`);
    load();
  };

  const setMyVehicle = async (vid: string) => {
    if (!driver) return;
    await supabase.from("drivers").update({ current_vehicle_id: vid }).eq("id", driver.id);
    setDriver({ ...driver, current_vehicle_id: vid });
    toast.success("Vehicle set");
  };

  if (loading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (!driver) return <Card className="p-6 text-sm text-muted-foreground">Your driver profile isn't linked yet. Ask the transport hub to link your account in Workforce List → Drivers.</Card>;

  const myVehicle = vehicles.find((v) => v.id === driver.current_vehicle_id);

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]">
          <div className="text-xs text-muted-foreground">My vehicle today</div>
          <div className="font-semibold">{myVehicle?.vehicle_name ?? "Not selected"} {myVehicle?.vehicle_plate ? `· ${myVehicle.vehicle_plate}` : ""}</div>
        </div>
        <Select value={driver.current_vehicle_id ?? ""} onValueChange={setMyVehicle}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
          <SelectContent>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_name} · {v.vehicle_plate}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </Card>

      {trips.length === 0 && <Card className="p-6 text-sm text-muted-foreground">No published dispatches assigned to you for {date}.</Card>}
      {trips.map((t) => {
        const dep = deps.find((d) => d.id === t.deployment_id);
        const proj = projects.find((p) => p.id === dep?.project_id);
        const dsp = dispatches.find((x) => x.id === t.dispatch_id);
        return (
          <Card key={t.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{proj?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{dep?.deployment_date} · {counts[t.deployment_id] ?? 0} workers</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant="secondary" className={statusColor(t.trip_status)}>{t.trip_status}</Badge>
                {dsp && <Badge variant="outline" className="text-xs">{dsp.status}</Badge>}
              </div>
            </div>
            {t.departure_time && <div className="text-sm">⏰ Depart {new Date(t.departure_time).toLocaleString()}</div>}
            <div className="text-sm">🚚 {myVehicle?.vehicle_name ?? "—"}</div>
            <div className="flex flex-wrap gap-2 pt-1">
              {t.trip_status === "assigned" && <Button size="sm" variant="outline" onClick={() => update(t.id, "departed")}>Departed</Button>}
              {t.trip_status === "departed" && <Button size="sm" variant="outline" onClick={() => update(t.id, "arrived")}>Arrived</Button>}
              {t.trip_status === "arrived" && <Button size="sm" variant="outline" onClick={() => update(t.id, "completed")}>Completed</Button>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ============= Worker ============= */
function WorkerTab({ userId }: { userId: string }) {
  const [items, setItems] = useState<Array<{ trip: Trip; dep?: Deployment; proj?: Project; veh?: Vehicle; dr?: Driver }>>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: w } = await supabase.from("workers").select("id").eq("user_id", userId).maybeSingle();
    if (!w) { setLoading(false); return; }
    const today = new Date().toISOString().slice(0, 10);
    // find deployments today containing this worker
    const { data: dw } = await supabase.from("deployment_workers").select("deployment_id").eq("worker_id", w.id);
    const depIds = (dw ?? []).map((r: any) => r.deployment_id);
    if (!depIds.length) { setItems([]); setLoading(false); return; }
    const { data: deps } = await supabase.from("deployments").select("*").in("id", depIds).eq("deployment_date", today);
    const depList = (deps as Deployment[]) ?? [];
    if (!depList.length) { setItems([]); setLoading(false); return; }
    const { data: trips } = await supabase.from("trips").select("*").in("deployment_id", depList.map((x) => x.id));
    const tList = (trips as Trip[]) ?? [];
    const dispatchIds = [...new Set(tList.map((t) => t.dispatch_id).filter(Boolean))] as string[];
    let publishedSet = new Set<string>();
    if (dispatchIds.length) {
      const { data: ds } = await supabase.from("dispatches").select("id,status").in("id", dispatchIds);
      publishedSet = new Set(((ds ?? []) as any[]).filter((d) => d.status === "published" || d.status === "completed").map((d) => d.id));
    }
    const visible = tList.filter((t) => t.dispatch_id && publishedSet.has(t.dispatch_id));
    const [{ data: projects }, { data: vehicles }, { data: drivers }] = await Promise.all([
      supabase.from("projects").select("id,name,location"),
      supabase.from("vehicles").select("*"),
      supabase.from("drivers").select("*"),
    ]);
    setItems(visible.map((t) => {
      const dep = depList.find((d) => d.id === t.deployment_id);
      const dr = (drivers as Driver[] | null)?.find((d) => d.id === t.driver_id);
      return {
        trip: t, dep,
        proj: (projects as Project[] | null)?.find((p) => p.id === dep?.project_id),
        veh: (vehicles as Vehicle[] | null)?.find((v) => v.id === (dr?.current_vehicle_id ?? t.vehicle_id)),
        dr,
      };
    }));
    setLoading(false);
  };
  useEffect(() => { load(); }, [userId]);

  if (loading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (!items.length) return <Card className="p-6 text-sm text-muted-foreground">No transport scheduled for today.</Card>;

  return (
    <div className="space-y-3 max-w-2xl">
      <h3 className="font-semibold text-sm">Today's Transport</h3>
      {items.map(({ trip, dep, proj, veh, dr }) => (
        <Card key={trip.id} className="p-4 space-y-1">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{proj?.name ?? "—"}</div>
            <Badge variant="secondary" className={statusColor(trip.trip_status)}>{trip.trip_status}</Badge>
          </div>
          {trip.departure_time && <div className="text-sm">⏰ Pickup {new Date(trip.departure_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
          <div className="text-sm">👤 Driver: {dr?.driver_name ?? "—"} {dr?.phone ? `· ${dr.phone}` : ""}</div>
          <div className="text-sm">🚚 {veh?.vehicle_name ?? "—"} {veh?.vehicle_plate ? `(${veh.vehicle_plate})` : ""}</div>
        </Card>
      ))}
    </div>
  );
}

/* ============= Fleet (vehicles only) ============= */
function FleetTab() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [v, setV] = useState({ vehicle_name: "", vehicle_plate: "", vehicle_type: "lorry", passenger_capacity: 10 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Vehicle>>({});

  const load = async () => {
    const { data } = await supabase.from("vehicles").select("*").order("vehicle_name");
    setVehicles((data as Vehicle[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!v.vehicle_name || !v.vehicle_plate) return toast.error("Name and plate required");
    const { error } = await supabase.from("vehicles").insert({ ...v, vehicle_status: "available" });
    if (error) return toast.error(error.message);
    setV({ vehicle_name: "", vehicle_plate: "", vehicle_type: "lorry", passenger_capacity: 10 });
    load();
  };
  const toggle = async (id: string, current: string) => {
    const next = current === "available" ? "inactive" : "available";
    await supabase.from("vehicles").update({ vehicle_status: next }).eq("id", id);
    load();
  };
  const startEdit = (x: Vehicle) => { setEditingId(x.id); setEditDraft({ vehicle_name: x.vehicle_name, vehicle_plate: x.vehicle_plate, vehicle_type: x.vehicle_type, passenger_capacity: x.passenger_capacity }); };
  const saveEdit = async () => {
    if (!editingId) return;
    const { error } = await supabase.from("vehicles").update(editDraft).eq("id", editingId);
    if (error) return toast.error(error.message);
    setEditingId(null); setEditDraft({}); load();
  };
  const remove = async (id: string) => {
    if (!confirm("Remove this vehicle?")) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <Card className="p-5 space-y-3 max-w-2xl">
      <h3 className="font-semibold flex items-center gap-2"><Truck className="size-4" /> Vehicles</h3>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Name (14ft Lorry A)" value={v.vehicle_name} onChange={(e) => setV({ ...v, vehicle_name: e.target.value })} />
        <Input placeholder="Plate" value={v.vehicle_plate} onChange={(e) => setV({ ...v, vehicle_plate: e.target.value })} />
        <Input placeholder="Type (14ft / 10ft)" value={v.vehicle_type} onChange={(e) => setV({ ...v, vehicle_type: e.target.value })} />
        <Input type="number" placeholder="Capacity" value={v.passenger_capacity} onChange={(e) => setV({ ...v, passenger_capacity: parseInt(e.target.value) || 0 })} />
      </div>
      <Button onClick={add} size="sm">Add vehicle</Button>
      <div className="divide-y border rounded-md">
        {vehicles.map((x) => {
          const isEditing = editingId === x.id;
          const isActive = x.vehicle_status === "available";
          return (
            <div key={x.id} className="px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
              {isEditing ? (
                <>
                  <Input className="h-8 w-40" value={editDraft.vehicle_name ?? ""} onChange={(e) => setEditDraft({ ...editDraft, vehicle_name: e.target.value })} />
                  <Input className="h-8 w-28" value={editDraft.vehicle_plate ?? ""} onChange={(e) => setEditDraft({ ...editDraft, vehicle_plate: e.target.value })} />
                  <Input className="h-8 w-24" value={editDraft.vehicle_type ?? ""} onChange={(e) => setEditDraft({ ...editDraft, vehicle_type: e.target.value })} />
                  <Input type="number" className="h-8 w-20" value={editDraft.passenger_capacity ?? 0} onChange={(e) => setEditDraft({ ...editDraft, passenger_capacity: parseInt(e.target.value) || 0 })} />
                  <Button size="sm" onClick={saveEdit}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-[160px]">
                    <div className="font-medium">{x.vehicle_name} <span className="text-muted-foreground">· {x.vehicle_plate}</span></div>
                    <div className="text-xs text-muted-foreground">{x.vehicle_type ?? "—"} · {x.passenger_capacity}p</div>
                  </div>
                  <Badge variant="secondary" className={statusColor(isActive ? "completed" : "cancelled")}>{isActive ? "Active" : "Inactive"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => toggle(x.id, x.vehicle_status)}>{isActive ? "Deactivate" : "Activate"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(x)}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(x.id)}>Remove</Button>
                </>
              )}
            </div>
          );
        })}
        {vehicles.length === 0 && <div className="p-3 text-sm text-muted-foreground">No vehicles yet.</div>}
      </div>
    </Card>
  );
}
