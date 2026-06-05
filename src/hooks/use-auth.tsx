import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "general_user" | "trade_manager" | "transport_hub" | "driver" | "worker";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role | null;
  profileName: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  role: null,
  profileName: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = async (sess: Session | null) => {
    if (!sess?.user) {
      setSession(null);
      setRole(null);
      setProfileName(null);
      return;
    }
    // Validate profile existence & active status — if missing or disabled, force sign out
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email, is_active")
      .eq("id", sess.user.id)
      .maybeSingle();

    if (!profile) {
      await supabase.auth.signOut();
      setSession(null);
      setRole(null);
      setProfileName(null);
      return;
    }

    if (profile.is_active === false) {
      await supabase.auth.signOut();
      setSession(null);
      setRole(null);
      setProfileName(null);
      if (typeof window !== "undefined") {
        const { toast } = await import("sonner");
        toast.error("Your account has been disabled. Please contact your administrator.");
      }
      return;
    }


    setSession(sess);
    setProfileName(profile.full_name ?? profile.email ?? sess.user.email ?? null);

    const { data: r } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", sess.user.id)
      .maybeSingle();
    setRole((r?.role as Role) ?? "general_user");
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setTimeout(() => { hydrate(sess); }, 0);
    });

    supabase.auth.getSession().then(async ({ data }) => {
      await hydrate(data.session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        role,
        profileName,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
