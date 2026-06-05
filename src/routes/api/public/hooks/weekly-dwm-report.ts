import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Public cron-triggered endpoint. Generates the weekly DWM summary and
// (best-effort) sends an email to active recipients. Email delivery only
// activates after the workspace's email domain is set up; until then this
// endpoint returns the rendered report payload for inspection.
async function buildReport() {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const { data: subs } = await supabaseAdmin
    .from("daily_submissions")
    .select("name, work_update, ai_summary, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true });

  const lines = (subs ?? []).map((s) => {
    const day = new Date(s.created_at).toISOString().slice(0, 10);
    return `- [${day}] ${s.name}: ${s.ai_summary ?? s.work_update}`;
  });
  const corpus = lines.join("\n");

  let summary = "No submissions this week.";
  let highlights: string[] = [];

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
              { role: "system", content: "You are an engineering ops assistant. Write a brief weekly progress summary (under 200 words) and a short bullet list of key highlights." },
              { role: "user", content: `Submissions:\n${corpus}\n\nReturn JSON: {"summary": "...", "highlights": ["...","..."]}` },
            ],
          }),
        });
        if (res.ok) {
          const j = await res.json();
          const raw = j?.choices?.[0]?.message?.content ?? "";
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            if (typeof parsed.summary === "string") summary = parsed.summary;
            if (Array.isArray(parsed.highlights)) highlights = parsed.highlights;
          }
        }
      } catch { /* ignore */ }
    } else {
      summary = `${(subs ?? []).length} submissions this week.`;
    }
  }

  const { data: recipients } = await supabaseAdmin
    .from("report_recipients").select("email").eq("is_active", true);

  return {
    submissionsCount: subs?.length ?? 0,
    summary,
    highlights,
    corpus,
    recipients: (recipients ?? []).map((r) => r.email),
  };
}

export const Route = createFileRoute("/api/public/hooks/weekly-dwm-report")({
  server: {
    handlers: {
      POST: async () => {
        const report = await buildReport();
        return new Response(JSON.stringify({ ok: true, ...report }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () => {
        const report = await buildReport();
        return new Response(JSON.stringify({ ok: true, ...report }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
