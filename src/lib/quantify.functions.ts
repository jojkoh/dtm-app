import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ExtractInput = z.object({ drawingId: z.string().uuid() });

interface ExtractedItem {
  description: string;
  trade: string;
  system?: string;
  specification?: string;
  unit: string;
  quantity: number;
  confidence: number;
  remarks?: string;
}

export const extractDrawing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExtractInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "LOVABLE_API_KEY not configured" };
    }

    const { data: drawing, error: drawErr } = await supabase
      .from("uploaded_drawings")
      .select("id, file_name, storage_path, trade, drawing_type, scale, project_id")
      .eq("id", data.drawingId)
      .single();
    if (drawErr || !drawing) {
      return { ok: false as const, error: "Drawing not found" };
    }

    await supabase
      .from("uploaded_drawings")
      .update({ ai_status: "running" })
      .eq("id", drawing.id);

    // Download the PDF and inline as base64 for Gemini
    const { data: file, error: dlErr } = await supabase.storage
      .from("drawings")
      .download(drawing.storage_path);
    if (dlErr || !file) {
      await supabase.from("uploaded_drawings").update({ ai_status: "error", ai_result: { error: "download failed" } }).eq("id", drawing.id);
      return { ok: false as const, error: "Could not download drawing" };
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString("base64");
    const mimeType = "application/pdf";

    const systemPrompt = `You are an MEP engineering quantity surveyor. You will be shown an engineering PDF drawing.
Your job: extract VISIBLE elements ONLY (symbols, annotations, equipment, pipe/duct/cable runs with sizes if labeled).
Do NOT invent hidden fittings (elbows, tees, supports). Those are derived later by rule engine.
Return STRICT JSON only matching the schema. No prose.`;

    const userPrompt = `Drawing: ${drawing.file_name}
Trade: ${drawing.trade ?? "unknown"} | Type: ${drawing.drawing_type ?? "unknown"} | Scale: ${drawing.scale ?? "unknown"}

Return JSON:
{
  "drawing_classification": "string",
  "items": [
    { "description": "string", "trade": "Electrical|HVAC|Plumbing", "system": "string", "specification": "string", "unit": "no|m|m2|set", "quantity": number, "confidence": 0..1, "remarks": "string" }
  ]
}`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        await supabase.from("uploaded_drawings").update({ ai_status: "error", ai_result: { error: text.slice(0, 500) } }).eq("id", drawing.id);
        if (res.status === 429) return { ok: false as const, error: "AI rate limit. Please wait and retry." };
        if (res.status === 402) return { ok: false as const, error: "AI credits exhausted. Add credits to the workspace." };
        return { ok: false as const, error: `AI error: ${res.status}` };
      }

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content ?? "{}";
      let parsed: { drawing_classification?: string; items?: ExtractedItem[] } = {};
      try { parsed = JSON.parse(content); } catch { parsed = { items: [] }; }

      const items = (parsed.items ?? []).slice(0, 200);

      // Insert as draft BOQ items
      if (items.length) {
        const rows = items.map((it) => ({
          project_id: drawing.project_id,
          drawing_id: drawing.id,
          description: it.description ?? "Unnamed item",
          trade: it.trade ?? drawing.trade ?? null,
          system: it.system ?? null,
          specification: it.specification ?? null,
          unit: it.unit ?? "no",
          quantity: Number(it.quantity ?? 0),
          confidence: Number(it.confidence ?? 0.5),
          remarks: it.remarks ?? null,
          source: "ai_draft",
          approval_status: "draft",
        }));
        const { error: insErr } = await supabase.from("boq_items").insert(rows);
        if (insErr) console.error("BOQ insert error", insErr);
      }

      await supabase
        .from("uploaded_drawings")
        .update({
          ai_status: "done",
          ai_result: JSON.parse(JSON.stringify(parsed)),
          drawing_type: parsed.drawing_classification ?? drawing.drawing_type,
        })
        .eq("id", drawing.id);

      return { ok: true as const, itemCount: items.length, classification: parsed.drawing_classification };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      await supabase.from("uploaded_drawings").update({ ai_status: "error", ai_result: { error: msg } }).eq("id", drawing.id);
      return { ok: false as const, error: msg };
    } finally {
      void userId;
    }
  });
