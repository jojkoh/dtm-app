import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Copy, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useModulePermissions } from "@/hooks/use-module-permissions";
import {
  listUsers, setUserActive, setUserRole, deleteUser,
  inviteUsers, setModuleLive, generateWorkerAccounts,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: UsersPage,
});

const ROLES = ["admin", "general_user", "trade_manager", "transport_hub", "driver", "worker"] as const;
type RoleValue = typeof ROLES[number];

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  role: string;
};

const MODULE_LABELS: Record<string, string> = {
  daily_work_matters: "Daily Work Matters",
  quantify_ai: "Quantify AI",
  workforce_dispatch: "Workforce Dispatch",
};

function UsersPage() {
  const { role, loading: authLoading, user } = useAuth();
  const navigate = useNavigate();
  const list = useServerFn(listUsers);
  const toggleActive = useServerFn(setUserActive);
  const changeRole = useServerFn(setUserRole);
  const removeUser = useServerFn(deleteUser);
  const invite = useServerFn(inviteUsers);
  const toggleModule = useServerFn(setModuleLive);
  const genWorkers = useServerFn(generateWorkerAccounts);
  const { modules, refresh: refreshModules } = useModulePermissions();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState<RoleValue>("general_user");
  const [invBusy, setInvBusy] = useState(false);

  // Generate worker accounts
  const [genOpen, setGenOpen] = useState(false);
  const [genPrefix, setGenPrefix] = useState("worker");
  const [genDomain, setGenDomain] = useState("dtm.local");
  const [genCount, setGenCount] = useState(10);
  const [genPassword, setGenPassword] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genResults, setGenResults] = useState<Array<{ email: string; password: string; ok: boolean; error?: string }>>([]);
  const [genSharedPwd, setGenSharedPwd] = useState("");

  useEffect(() => {
    if (!authLoading && role && role !== "admin") {
      toast.error("Admin only.");
      navigate({ to: "/" });
    }
  }, [role, authLoading, navigate]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await list();
      setUsers(data as UserRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (role === "admin") loadUsers(); }, [role]);

  const onToggleActive = async (u: UserRow, next: boolean) => {
    try {
      await toggleActive({ data: { user_id: u.id, is_active: next } });
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, is_active: next } : x));
      toast.success(next ? "User enabled" : "User disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onRoleChange = async (u: UserRow, next: RoleValue) => {
    try {
      await changeRole({ data: { user_id: u.id, role: next } });
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, role: next } : x));
      toast.success("Role updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onDelete = async (u: UserRow) => {
    try {
      await removeUser({ data: { user_id: u.id } });
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      toast.success("User deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onInvite = async () => {
    if (!invEmail) { toast.error("Email required"); return; }
    setInvBusy(true);
    try {
      const res = await invite({
        data: {
          redirectTo: `${window.location.origin}/setup-password`,
          invites: [{
            email: invEmail,
            full_name: invName || invEmail.split("@")[0],
            role: invRole,
          }],
        },
      });
      if (!res.ok) {
        toast.error(`Invite failed: ${res.error}`);
      } else if (res.results[0].ok) {
        toast.success(`Invite sent to ${invEmail}`);
        setInviteOpen(false);
        setInvEmail(""); setInvName(""); setInvRole("general_user");
        loadUsers();
      } else {
        toast.error(`Invite failed: ${res.results[0].error || "unknown error"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setInvBusy(false);
    }
  };

  const onToggleModule = async (name: string, next: boolean) => {
    try {
      await toggleModule({ data: { module_name: name, is_live: next } });
      await refreshModules();
      toast.success(`${MODULE_LABELS[name] ?? name} is now ${next ? "live" : "offline"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onGenerateWorkers = async () => {
    setGenBusy(true);
    setGenResults([]);
    try {
      const res = await genWorkers({
        data: {
          prefix: genPrefix.trim(),
          domain: genDomain.trim(),
          count: genCount,
          shared_password: genPassword.trim() ? genPassword.trim() : undefined,
        },
      });
      setGenResults(res.results);
      setGenSharedPwd(res.shared_password);
      const okCount = res.results.filter((r) => r.ok).length;
      toast.success(`Created ${okCount} of ${res.results.length} worker account(s)`);
      loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setGenBusy(false);
    }
  };

  const copyAllCredentials = () => {
    if (!genResults.length) return;
    const text = genResults
      .filter((r) => r.ok)
      .map((r) => `${r.email}\t${r.password}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Credentials copied to clipboard");
  };


  return (
    <div className="min-h-screen">
      <WorkspaceHeader subtitle="Admin · User & module management" />
      <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" /> Back to workspace
        </Link>

        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">User Management</h1>
            <p className="text-sm text-muted-foreground">Manage accounts, roles, and module access.</p>
          </div>
        </div>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Users</h2>
            <div className="flex items-center gap-2">

              <Dialog open={genOpen} onOpenChange={setGenOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline"><Users className="size-4" /> Generate Worker Accounts</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Generate worker accounts</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Creates auto-confirmed worker accounts with sequential emails (e.g. worker01@dtm.local, worker02@…). All accounts share one password unless you set one explicitly. No emails are sent — copy the credentials and hand them out.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Email prefix</Label>
                        <Input value={genPrefix} onChange={(e) => setGenPrefix(e.target.value)} placeholder="worker" />
                      </div>
                      <div className="space-y-2">
                        <Label>Domain</Label>
                        <Input value={genDomain} onChange={(e) => setGenDomain(e.target.value)} placeholder="dtm.local" />
                      </div>
                      <div className="space-y-2">
                        <Label>Count</Label>
                        <Input type="number" min={1} max={50} value={genCount}
                          onChange={(e) => setGenCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Shared password (optional)</Label>
                        <Input value={genPassword} onChange={(e) => setGenPassword(e.target.value)} placeholder="Auto-generate if blank" />
                      </div>
                    </div>

                    {genResults.length > 0 && (
                      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">
                            Shared password: <code className="bg-background px-2 py-0.5 rounded">{genSharedPwd}</code>
                          </p>
                          <Button size="sm" variant="ghost" onClick={copyAllCredentials}>
                            <Copy className="size-3" /> Copy all
                          </Button>
                        </div>
                        <div className="max-h-48 overflow-auto text-xs font-mono space-y-1">
                          {genResults.map((r) => (
                            <div key={r.email} className={r.ok ? "" : "text-destructive"}>
                              {r.email} — {r.ok ? "✓ created" : `✗ ${r.error}`}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => { setGenOpen(false); setGenResults([]); }}>Close</Button>
                    <Button onClick={onGenerateWorkers} disabled={genBusy}>
                      {genBusy ? "Creating…" : `Create ${genCount} accounts`}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>

              <DialogTrigger asChild>
                <Button><UserPlus className="size-4" /> Invite User</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Invite a new user</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Email *</Label>
                    <Input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name</Label>
                    <Input value={invName} onChange={(e) => setInvName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={invRole} onValueChange={(v) => setInvRole(v as RoleValue)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  <Button onClick={onInvite} disabled={invBusy}>
                    {invBusy ? "Sending…" : "Send invite"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </div>


          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.full_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          onValueChange={(v) => onRoleChange(u, v as RoleValue)}
                          disabled={u.id === user?.id}
                        >
                          <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={u.is_active}
                            onCheckedChange={(v) => onToggleActive(u, v)}
                            disabled={u.id === user?.id}
                          />
                          <span className="text-xs text-muted-foreground">
                            {u.is_active ? "Active" : "Disabled"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" disabled={u.id === user?.id}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this user?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {u.email} will be permanently removed from the workspace and authentication system. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDelete(u)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No users.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Module Settings</h2>
          <div className="space-y-3">
            {Object.keys(MODULE_LABELS).map((name) => {
              const live = modules[name] !== false;
              return (
                <div key={name} className="flex items-center justify-between border rounded-md px-4 py-3">
                  <div>
                    <p className="font-medium">{MODULE_LABELS[name]}</p>
                    <p className="text-xs text-muted-foreground">{live ? "Live — visible to all users" : "Offline — hidden from navigation"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={live} onCheckedChange={(v) => onToggleModule(name, v)} />
                    <span className="text-xs text-muted-foreground w-14">{live ? "Live" : "Offline"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </main>
    </div>
  );
}
