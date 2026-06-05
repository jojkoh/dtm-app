import { Link } from "@tanstack/react-router";
import { Building2, LogOut, ShieldCheck, User2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function WorkspaceHeader({ subtitle }: { subtitle?: string }) {
  const { user, role, signOut } = useAuth();
  return (
    <header className="border-b bg-card">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="size-9 rounded-md bg-primary text-primary-foreground grid place-items-center">
            <Building2 className="size-4" />
          </div>
          <div>
            <div className="font-semibold leading-tight">DTM Workspace</div>
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          </div>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            {role === "admin" ? <ShieldCheck className="size-4 text-primary" /> : <User2 className="size-4" />}
            <span>{user?.email}</span>
            <span className="text-xs rounded-full bg-secondary px-2 py-0.5">
              {role === "admin" ? "Admin" : "User"}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
