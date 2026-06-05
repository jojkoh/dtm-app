import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLES = ["admin", "general_user", "trade_manager", "transport_hub", "driver", "worker"] as const;

const InviteSchema = z.object({
  redirectTo: z.string().url(),
  invites: z
    .array(
      z.object({
        email: z.string().email().max(255),
        full_name: z.string().min(1).max(255),
        role: z.enum(ROLES),
      })
    )
    .min(1)
    .max(50),
});

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Only admins can perform this action.");
}

export const inviteUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try { await assertAdmin(supabase, userId); }
    catch (e) { return { ok: false as const, error: (e as Error).message }; }

    const results: Array<{ email: string; ok: boolean; error?: string }> = [];

    for (const inv of data.invites) {
      try {
        const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(inv.email, {
          redirectTo: data.redirectTo,
          data: { full_name: inv.full_name, role: inv.role },
        });
        if (error) results.push({ email: inv.email, ok: false, error: error.message });
        else results.push({ email: inv.email, ok: true });
      } catch (e) {
        results.push({ email: inv.email, ok: false, error: e instanceof Error ? e.message : "unknown" });
      }
    }

    return { ok: true as const, results };
  });

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const roleMap = new Map<string, string>();
    (roles ?? []).forEach((r: any) => roleMap.set(r.user_id, r.role));

    return (profiles ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      is_active: p.is_active,
      role: roleMap.get(p.id) ?? "general_user",
    }));
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), is_active: z.boolean() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: data.is_active })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), role: z.enum(ROLES) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("You cannot delete your own account.");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    // profiles cascade via auth.users FK
    return { ok: true };
  });

export const setModuleLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ module_name: z.string().min(1).max(64), is_live: z.boolean() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin
      .from("module_permissions")
      .update({ is_live: data.is_live, updated_at: new Date().toISOString() })
      .eq("module_name", data.module_name);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const GenerateWorkersSchema = z.object({
  prefix: z.string().min(1).max(32).regex(/^[a-z0-9._-]+$/i, "Letters, numbers, . _ - only"),
  domain: z.string().min(3).max(100).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain"),
  count: z.number().int().min(1).max(50),
  start_number: z.number().int().min(1).max(9999).optional(),
  shared_password: z.string().min(8).max(72).optional(),
  pad_width: z.number().int().min(1).max(4).optional(),
});

function generatePassword(len = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

export const generateWorkerAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GenerateWorkersSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const padWidth = data.pad_width ?? 2;
    const sharedPassword = data.shared_password ?? generatePassword(12);

    let start = data.start_number ?? 1;
    if (!data.start_number) {
      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .ilike("email", `${data.prefix}%@${data.domain}`);
      const used = new Set<number>();
      const re = new RegExp(`^${data.prefix}(\\d+)@${data.domain.replace(/\./g, "\\.")}$`, "i");
      for (const r of existing ?? []) {
        const m = (r as { email: string | null }).email?.match(re);
        if (m) used.add(parseInt(m[1], 10));
      }
      while (used.has(start)) start++;
    }

    const results: Array<{ email: string; password: string; ok: boolean; error?: string }> = [];
    for (let i = 0; i < data.count; i++) {
      const num = String(start + i).padStart(padWidth, "0");
      const email = `${data.prefix}${num}@${data.domain}`.toLowerCase();
      const fullName = `${data.prefix}${num}`;
      try {
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: sharedPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName, role: "worker" },
        });
        if (error || !created.user) {
          results.push({ email, password: sharedPassword, ok: false, error: error?.message ?? "unknown" });
          continue;
        }
        results.push({ email, password: sharedPassword, ok: true });
      } catch (e) {
        results.push({ email, password: sharedPassword, ok: false, error: e instanceof Error ? e.message : "unknown" });
      }
    }

    return { ok: true as const, shared_password: sharedPassword, results };
  });

