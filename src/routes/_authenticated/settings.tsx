import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, LogOut, KeyRound } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({ component: Page });

function Page() {
  const { user, signOut } = useAuth();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Use at least 8 characters.");
    if (pw !== confirm) return toast.error("Passwords don't match.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Password updated.");
      setPw(""); setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen">
      <WorkspaceHeader subtitle="User Settings" />
      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" /> Back to workspace
        </Link>

        <Card className="p-6">
          <h2 className="text-lg font-semibold">Account</h2>
          <div className="mt-4 space-y-2 text-sm">
            <div><span className="text-muted-foreground">Email: </span>{user?.email}</div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2"><KeyRound className="size-4" /> Change password</h2>
          <form onSubmit={change} className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</Button>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold">Session</h2>
          <p className="text-sm text-muted-foreground mt-1">Sign out of this device.</p>
          <Button variant="outline" className="mt-4" onClick={signOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </Card>
      </main>
    </div>
  );
}
