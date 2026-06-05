import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { inviteUsers } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/invitations")({
  component: InvitationsPage,
});

type ParsedInvite = { full_name: string; email: string; error?: string };

function parseInvites(raw: string): ParsedInvite[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map<ParsedInvite>((line) => {
      // Supports "Name = email", "Name : email", "Name, email", "Name <email>", or "email"
      const m =
        line.match(/^(.+?)\s*(?:=|:|,|\||\t)\s*([^\s<>]+@[^\s<>]+)$/) ||
        line.match(/^(.+?)\s*<\s*([^\s<>]+@[^\s<>]+)\s*>$/) ||
        line.match(/^([^\s<>]+@[^\s<>]+)$/);
      if (!m) return { full_name: line, email: "", error: "Could not parse" };
      if (m.length === 2) {
        const email = m[1];
        return { full_name: email.split("@")[0], email };
      }
      const full_name = m[1].trim();
      const email = m[2].trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      return valid
        ? { full_name, email }
        : { full_name, email, error: "Invalid email" };
    });
}

function InvitationsPage() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const invite = useServerFn(inviteUsers);

  const [raw, setRaw] = useState(
    "Frank Wang = frank.wang@alric.com.sg\nAdmond Ho = admond.ho@alric.com.sg",
  );
  type InviteRole = "admin" | "general_user" | "trade_manager" | "transport_hub" | "driver" | "worker";
  const [defaultRole, setDefaultRole] = useState<InviteRole>(
    "general_user",
  );
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    Array<{ email: string; ok: boolean; error?: string }>
  >([]);

  useEffect(() => {
    if (!loading && role && role !== "admin") {
      toast.error("Admin only.");
      navigate({ to: "/" });
    }
  }, [role, loading, navigate]);

  const parsed = useMemo(() => parseInvites(raw), [raw]);
  const valid = parsed.filter((p) => !p.error && p.email);

  const submit = async () => {
    if (!valid.length) {
      toast.error("Add at least one valid name + email.");
      return;
    }
    setBusy(true);
    setResults([]);
    try {
      const res = await invite({
        data: {
          redirectTo: `${window.location.origin}/setup-password`,
          invites: valid.map((p) => ({
            full_name: p.full_name,
            email: p.email,
            role: defaultRole,
          })),
        },
      });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        setResults(res.results);
        const ok = res.results.filter((r) => r.ok).length;
        toast.success(`Sent ${ok}/${res.results.length} invitations.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <WorkspaceHeader subtitle="Admin · User invitations" />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Link
          to="/"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4 mr-1" /> Back to workspace
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Invite users</h1>
            <p className="text-sm text-muted-foreground">
              Invitees receive a secure email to set their own password.
            </p>
          </div>
        </div>

        <Card className="p-6 space-y-5">
          <div className="space-y-2">
            <Label>People to invite</Label>
            <Textarea
              rows={8}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="font-mono text-sm"
              placeholder="Frank Wang = frank.wang@alric.com.sg"
            />
            <p className="text-xs text-muted-foreground">
              One per line. Formats: <code>Name = email</code>,{" "}
              <code>Name, email</code>, or <code>Name &lt;email&gt;</code>.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Assign role</Label>
              <Select
                value={defaultRole}
                onValueChange={(v) => setDefaultRole(v as InviteRole)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general_user">General User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="trade_manager">Trade Manager</SelectItem>
                  <SelectItem value="transport_hub">Transport Hub</SelectItem>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="worker">Worker</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Parsed</Label>
              <div className="h-10 px-3 rounded-md border bg-muted/30 grid items-center text-sm">
                {valid.length} valid · {parsed.length - valid.length} invalid
              </div>
            </div>
          </div>

          {parsed.length > 0 && (
            <div className="rounded-md border divide-y max-h-64 overflow-auto">
              {parsed.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{p.full_name}</span>
                    <span className="text-muted-foreground ml-2">{p.email}</span>
                  </div>
                  {p.error ? (
                    <span className="text-xs text-destructive">{p.error}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">ok</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <Button onClick={submit} disabled={busy || !valid.length}>
            <UserPlus className="size-4" />
            {busy ? "Sending…" : `Send ${valid.length} invitation${valid.length === 1 ? "" : "s"}`}
          </Button>
        </Card>

        {results.length > 0 && (
          <Card className="p-6 mt-6">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Mail className="size-4" /> Results
            </h2>
            <div className="divide-y border rounded-md">
              {results.map((r) => (
                <div
                  key={r.email}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span>{r.email}</span>
                  {r.ok ? (
                    <span className="text-xs text-emerald-600">Invitation sent</span>
                  ) : (
                    <span className="text-xs text-destructive">{r.error}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
