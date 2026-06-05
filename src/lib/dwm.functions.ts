import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SubmitSchema = z.object({
  work_update: z.string().trim().min(1).max(4000),
});

async function summarize(text: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Summarise a daily work update in 10-15 words. Focus on concrete actions and outcomes. Plain text, no quotes." },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const out = json?.choices?.[0]?.message?.content?.trim();
    return typeof out === "string" && out.length > 0 ? out.slice(0, 300) : null;
  } catch {
    return null;
  }
}

async function getProfileName(supabase: any, userId: string, fallbackEmail: string | null): Promise<string> {
  const { data } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return (data?.full_name as string) ?? (data?.email as string) ?? fallbackEmail ?? "Unknown";
}

async function getCutoff(supabase: any): Promise<string> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "dwm_cutoff_time").maybeSingle();
  const v = data?.value;
  if (typeof v === "string") return v;
  return "17:30";
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isBeforeCutoff(createdAt: string, cutoff: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  if (created.toDateString() !== now.toDateString()) return false;
  const [h, m] = cutoff.split(":").map((n) => parseInt(n, 10));
  const cut = new Date();
  cut.setHours(h || 17, m || 30, 0, 0);
  return now.getTime() < cut.getTime();
}

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admins only");
}

export const submitDailyUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubmitSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context as any;

    const dayStart = startOfToday().toISOString();
    const { data: existing } = await supabase
      .from("daily_submissions")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", dayStart)
      .maybeSingle();
    if (existing) {
      return { ok: false as const, error: "You have already submitted today. Edit your existing submission instead." };
    }

    const name = await getProfileName(supabase, userId, (claims?.email as string) ?? null);
    const ai_summary = await summarize(data.work_update);
    const { data: row, error } = await supabase
      .from("daily_submissions")
      .insert({ user_id: userId, name, work_update: data.work_update, ai_summary })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, submission: row };
  });

const UpdateSchema = z.object({
  id: z.string().uuid(),
  work_update: z.string().trim().min(1).max(4000),
});

export const updateDailyUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: existing, error: fetchErr } = await supabase
      .from("daily_submissions")
      .select("id, user_id, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) return { ok: false as const, error: "Not found" };
    if (existing.user_id !== userId) return { ok: false as const, error: "Not allowed" };

    const cutoff = await getCutoff(supabase);
    if (!isBeforeCutoff(existing.created_at, cutoff)) {
      return { ok: false as const, error: `Edit window closed (after ${cutoff}).` };
    }

    const ai_summary = await summarize(data.work_update);
    const { data: row, error } = await supabase
      .from("daily_submissions")
      .update({ work_update: data.work_update, ai_summary, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, submission: row };
  });

// Admin: overwrite/edit any submission
export const adminUpdateSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const ai_summary = await summarize(data.work_update);
    const { error } = await supabaseAdmin
      .from("daily_submissions")
      .update({ work_update: data.work_update, ai_summary, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// Admin: delete any submission
export const adminDeleteSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { error } = await supabaseAdmin.from("daily_submissions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// Today board — only operational users + today's availability
export const getTodayBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const dayStart = startOfToday().toISOString();
    const date = todayDateStr();
    const [profilesRes, subsRes, availRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email").eq("is_active", true).eq("is_operational", true),
      supabaseAdmin
        .from("daily_submissions")
        .select("id, user_id, name, work_update, ai_summary, created_at, updated_at")
        .gte("created_at", dayStart)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("daily_availability")
        .select("user_id, status, note")
        .eq("date", date),
    ]);
    return {
      activeUsers: (profilesRes.data ?? []).map((p: any) => ({
        id: p.id,
        name: p.full_name ?? p.email ?? "Unknown",
      })),
      submissions: subsRes.data ?? [],
      availability: availRes.data ?? [],
    };
  });

// My weekly reports — current or previous week only.
const WeekSchema = z.object({ weekOffset: z.union([z.literal(0), z.literal(1)]) });
export const getMyWeeklyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => WeekSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const now = new Date();
    const monday = new Date(now);
    const day = monday.getDay();
    const diff = (day === 0 ? -6 : 1 - day) - data.weekOffset * 7;
    monday.setDate(monday.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(monday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const { data: rows, error } = await supabase
      .from("daily_submissions")
      .select("id, work_update, ai_summary, created_at, updated_at")
      .eq("user_id", userId)
      .gte("created_at", monday.toISOString())
      .lt("created_at", nextMonday.toISOString())
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      weekStart: monday.toISOString(),
      weekEnd: nextMonday.toISOString(),
      rows: rows ?? [],
    };
  });

// Team weekly report — Mon-Fri per operational user + AI weekly summary per user
export const getTeamWeeklyReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    // Compute Monday (start) of current week
    const now = new Date();
    const monday = new Date(now);
    const dow = monday.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    monday.setDate(monday.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(monday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const date = todayDateStr();

    const [profilesRes, subsRes, availRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .eq("is_active", true)
        .eq("is_operational", true)
        .order("full_name"),
      supabaseAdmin
        .from("daily_submissions")
        .select("id, user_id, name, work_update, ai_summary, created_at, updated_at")
        .gte("created_at", monday.toISOString())
        .lt("created_at", nextMonday.toISOString())
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("daily_availability")
        .select("user_id, status, note")
        .eq("date", date),
    ]);

    const profiles = profilesRes.data ?? [];
    const subs = subsRes.data ?? [];
    const avail = availRes.data ?? [];
    const availMap = new Map<string, { status: string; note: string | null }>();
    avail.forEach((a: any) => availMap.set(a.user_id, { status: a.status, note: a.note }));

    // Group submissions per user
    const subsByUser = new Map<string, any[]>();
    for (const s of subs) {
      const arr = subsByUser.get(s.user_id) ?? [];
      arr.push(s);
      subsByUser.set(s.user_id, arr);
    }

    // Build per-user weekly view and AI summary
    const users = await Promise.all(
      profiles.map(async (p: any) => {
        const userSubs = subsByUser.get(p.id) ?? [];
        // Group by day-of-week (0=Mon ... 4=Fri)
        const days: Array<{ dayIndex: number; date: string; entries: any[] }> = [];
        for (let i = 0; i < 5; i++) {
          const d = new Date(monday);
          d.setDate(d.getDate() + i);
          const dStart = new Date(d);
          const dEnd = new Date(d);
          dEnd.setDate(dEnd.getDate() + 1);
          const entries = userSubs.filter((s) => {
            const t = new Date(s.created_at).getTime();
            return t >= dStart.getTime() && t < dEnd.getTime();
          });
          days.push({ dayIndex: i, date: d.toISOString(), entries });
        }

        let weeklySummary: string | null = null;
        if (userSubs.length > 0) {
          const corpus = userSubs
            .map((s) => `[${new Date(s.created_at).toISOString().slice(0, 10)}] ${s.work_update}`)
            .join("\n");
          weeklySummary = await summarizeWeek(p.full_name ?? p.email ?? "User", corpus);
        }

        return {
          id: p.id,
          name: p.full_name ?? p.email ?? "Unknown",
          days,
          weeklySummary,
          todayAvailability: availMap.get(p.id) ?? null,
        };
      })
    );

    return {
      weekStart: monday.toISOString(),
      weekEnd: nextMonday.toISOString(),
      users,
    };
  });

async function summarizeWeek(name: string, corpus: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Summarise this person's weekly work in 1-2 short sentences (max 40 words). Plain text. Focus on concrete deliverables and themes." },
          { role: "user", content: `${name}'s entries this week:\n${corpus}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const out = json?.choices?.[0]?.message?.content?.trim();
    return typeof out === "string" && out.length > 0 ? out.slice(0, 500) : null;
  } catch {
    return null;
  }
}

// Admin overview
export const adminDwmOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const dayStart = startOfToday().toISOString();
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const date = todayDateStr();

    const [allProfilesRes, todayRes, weekRes, availRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email, is_active, is_operational").order("full_name"),
      supabaseAdmin.from("daily_submissions").select("id, user_id, name, work_update, ai_summary, created_at, updated_at").gte("created_at", dayStart),
      supabaseAdmin.from("daily_submissions").select("id, user_id, name, work_update, ai_summary, created_at").gte("created_at", weekAgo.toISOString()).order("created_at", { ascending: true }),
      supabaseAdmin.from("daily_availability").select("id, user_id, status, note").eq("date", date),
    ]);
    const allProfiles = allProfilesRes.data ?? [];
    return {
      allProfiles,
      activeUsers: allProfiles.filter((p: any) => p.is_active && p.is_operational),
      today: todayRes.data ?? [],
      week: weekRes.data ?? [],
      availability: availRes.data ?? [],
    };
  });

// Toggle operational roster
export const setUserOperational = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ user_id: z.string().uuid(), is_operational: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin((context as any).supabase, (context as any).userId);
    const { error } = await supabaseAdmin.from("profiles").update({ is_operational: data.is_operational }).eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// Set user availability for today (or specified date)
const AvailSchema = z.object({
  user_id: z.string().uuid(),
  date: z.string().optional(),
  status: z.enum(["on_leave", "mc", "exempted"]),
  note: z.string().max(255).optional(),
});
export const setUserAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AvailSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const date = data.date ?? todayDateStr();
    const { error } = await supabaseAdmin
      .from("daily_availability")
      .upsert(
        { user_id: data.user_id, date, status: data.status, note: data.note ?? null, created_by: userId, updated_at: new Date().toISOString() },
        { onConflict: "user_id,date" }
      );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const clearUserAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ user_id: z.string().uuid(), date: z.string().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const date = data.date ?? todayDateStr();
    const { error } = await supabaseAdmin.from("daily_availability").delete().eq("user_id", data.user_id).eq("date", date);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// Historical archive lookup (admin)
const ArchiveSchema = z.object({
  fromDate: z.string(),
  toDate: z.string(),
});
export const adminDwmArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ArchiveSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const from = new Date(data.fromDate); from.setHours(0, 0, 0, 0);
    const to = new Date(data.toDate); to.setHours(23, 59, 59, 999);
    const { data: rows, error } = await supabaseAdmin
      .from("daily_submissions")
      .select("id, user_id, name, work_update, ai_summary, created_at")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const generateWeeklyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) return { ok: false as const, error: "Admins only." };

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { data: subs, error } = await supabase
      .from("daily_submissions")
      .select("name, work_update, ai_summary, created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const lines = (subs ?? []).map((s: any) => {
      const day = new Date(s.created_at).toISOString().slice(0, 10);
      return `- [${day}] ${s.name}: ${s.ai_summary ?? s.work_update}`;
    });
    const corpus = lines.join("\n");

    let summary = "No submissions this week.";
    let highlights = "";
    if ((subs ?? []).length > 0) {
      const key = process.env.LOVABLE_API_KEY;
      if (key) {
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: "You are an engineering operations manager. Write a brief weekly management summary (under 200 words) and a short bullet list of key highlights and concerns from the team's daily submissions." },
                { role: "user", content: `Submissions (Mon-Sun):\n${corpus}\n\nReturn JSON: {"summary": "...", "highlights": ["...","..."]}` },
              ],
            }),
          });
          if (res.ok) {
            const j = await res.json();
            const raw = j?.choices?.[0]?.message?.content ?? "";
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) {
              const parsed = JSON.parse(m[0]);
              summary = parsed.summary ?? summary;
              highlights = Array.isArray(parsed.highlights) ? parsed.highlights.map((h: string) => `• ${h}`).join("\n") : "";
            }
          }
        } catch { /* fall through */ }
      } else {
        summary = `${(subs ?? []).length} submissions this week.`;
      }
    }

    const { data: recipients } = await supabase
      .from("report_recipients").select("email").eq("is_active", true);

    return {
      ok: true as const,
      submissionsCount: subs?.length ?? 0,
      summary,
      highlights,
      corpus,
      recipients: (recipients ?? []).map((r: any) => r.email),
    };
  });
