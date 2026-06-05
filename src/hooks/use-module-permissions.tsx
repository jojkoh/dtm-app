import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ModuleName = "daily_work_matters" | "quantify_ai" | "workforce_dispatch";

type ModuleMap = Record<string, boolean>;

let cache: ModuleMap | null = null;
const listeners = new Set<(m: ModuleMap) => void>();

async function load() {
  const { data } = await supabase.from("module_permissions").select("module_name, is_live");
  const map: ModuleMap = {};
  (data ?? []).forEach((r: any) => { map[r.module_name] = !!r.is_live; });
  cache = map;
  listeners.forEach((cb) => cb(map));
}

export function useModulePermissions() {
  const [modules, setModules] = useState<ModuleMap>(cache ?? {});
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    const cb = (m: ModuleMap) => { setModules(m); setLoading(false); };
    listeners.add(cb);
    if (cache === null) load();
    else cb(cache);

    const channel = supabase
      .channel("module_permissions_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "module_permissions" }, () => load())
      .subscribe();

    return () => {
      listeners.delete(cb);
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    modules,
    loading,
    isLive: (name: ModuleName) => modules[name] !== false, // default live until loaded
    refresh: load,
  };
}
export function ModuleUnavailable() {
  return (
    <div className="min-h-[60vh] grid place-items-center px-6 text-center">
      <div>
        <h2 className="text-xl font-semibold">This module is currently unavailable.</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Please check back later or contact your administrator.
        </p>
      </div>
    </div>
  );
}

export function ModuleGate({ name, children }: { name: ModuleName; children: React.ReactNode }) {
  const { isLive, loading } = useModulePermissions();
  if (loading) return null;
  if (!isLive(name)) return <ModuleUnavailable />;
  return <>{children}</>;
}

