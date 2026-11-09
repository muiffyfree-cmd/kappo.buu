// 予約メールの自動送信（Supabase Edge Function）
//
// 呼び出し元：Database Webhook（reservations テーブルの INSERT と UPDATE）
//   INSERT                         → お客様へ「予約完了」＋ お店へ「新しい予約」
//   UPDATE（状態がキャンセルに変化） → お客様へ「キャンセル完了」
// 管理画面の「テスト送信」：POST { "type": "TEST", "template_key": "...", "to": "..." }（管理者のJWTが必要）
//
// シークレット（supabase secrets set）
//   RESEND_API_KEY  … Resend の APIキー
//   MAIL_FROM       … 例）割烹 舞ぅ <yoyaku@認証済みドメイン>
//   WEBHOOK_SECRET  … Database Webhook のヘッダー x-webhook-secret と同じ値
// ※ SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Edge Function に自動で入る

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildVars, render, unknownKeys, type Reservation, type Settings } from "./render.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function sendResend(to: string, subject: string, text: string, html: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("MAIL_FROM"), to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true as const, id: body.id as string } : { ok: false as const, error: `${res.status} ${JSON.stringify(body)}` };
}

async function loadContext(r: Reservation) {
  const [{ data: s }, { data: tpls }, { data: menu }] = await Promise.all([
    db.from("settings").select("*").eq("id", 1).single(),
    db.from("mail_templates").select("*"),
    db.from("menu_items").select("name,category").eq("category", "dinner"),
  ]);
  // その日・その部の予約人数と、その時間の残席
  const { data: same } = await db.from("reservations").select("people")
    .eq("day", r.day).eq("service", r.service).in("status", ["confirmed", "visited"]);
  const { data: remaining } = await db.rpc("slot_remaining", { p_day: r.day, p_service: r.service, p_slot: r.start_time });
  const isCourse = r.service === "dinner" && !!menu?.some((m) => r.course?.includes(m.name));
  const vars = buildVars(r, s as Settings, {
    isCourse,
    bookedPeople: (same ?? []).reduce((a, x) => a + x.people, 0),
    remaining: typeof remaining === "number" ? remaining : undefined,
  });
  return { settings: s as Settings & { shop_email: string }, templates: new Map((tpls ?? []).map((t) => [t.key, t])), vars };
}

/** 1通送る。同じ予約・同じ文面は二度送らない（mail_log で確認） */
async function sendOnce(r: Reservation, key: string, to: string, ctx: Awaited<ReturnType<typeof loadContext>>, replyTo?: string) {
  const tpl = ctx.templates.get(key);
  if (!tpl || !tpl.enabled) return { key, status: "skipped", reason: "disabled" };
  if (!to) return { key, status: "skipped", reason: "no address" };

  const { data: already } = await db.from("mail_log").select("id")
    .eq("reservation_id", r.id).eq("template_key", key).eq("status", "sent").maybeSingle();
  if (already) return { key, status: "skipped", reason: "already sent" };

  const unknown = unknownKeys(tpl.subject + tpl.body, ctx.vars);
  if (unknown.length) console.warn(`未定義の差し込み：${unknown.join(", ")}（${key}）`);

  const m = render(tpl, ctx.vars);
  const res = await sendResend(to, m.subject, m.text, m.html, replyTo);
  await db.from("mail_log").insert({
    reservation_id: r.id, template_key: key, to_email: to,
    status: res.ok ? "sent" : "failed", provider_id: res.ok ? res.id : null, error: res.ok ? null : res.error,
  });
  return { key, status: res.ok ? "sent" : "failed" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const payload = await req.json().catch(() => null);
  if (!payload) return json({ error: "bad json" }, 400);

  // ---------- 管理画面からのテスト送信 ----------
  if (payload.type === "TEST") {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(jwt);
    const { data: admin } = u?.user
      ? await db.from("admin_users").select("user_id").eq("user_id", u.user.id).maybeSingle()
      : { data: null };
    if (!admin) return json({ error: "forbidden" }, 403);

    const sample: Reservation = {
      id: "00000000-0000-0000-0000-000000000000", code: "TEST01", day: new Date().toISOString().slice(0, 10),
      service: "dinner", start_time: "18:30:00", people: 2, course: "花麗（11品）", name: "長崎 太郎",
      tel: "090-0000-0000", email: payload.to, note: "結婚記念日です", source: "web", status: "confirmed",
    };
    const ctx = await loadContext(sample);
    const tpl = payload.template ?? ctx.templates.get(payload.template_key); // 保存前の文面も試せる
    if (!tpl) return json({ error: "template not found" }, 404);
    const m = render(tpl, ctx.vars);
    const res = await sendResend(payload.to, `[テスト] ${m.subject}`, m.text, m.html, ctx.settings.shop_email || undefined);
    return json({ ...res, unknown: unknownKeys(tpl.subject + tpl.body, ctx.vars) }, res.ok ? 200 : 502);
  }

  // ---------- Database Webhook ----------
  if (req.headers.get("x-webhook-secret") !== env("WEBHOOK_SECRET")) return json({ error: "forbidden" }, 403);
  const { type, record, old_record } = payload as { type: string; record: Reservation & { notify_customer: boolean }; old_record?: Reservation };
  if (!record) return json({ skipped: "no record" });

  const ctx = await loadContext(record);
  const shop = ctx.settings.shop_email;
  const results = [];

  if (type === "INSERT" && record.status === "confirmed") {
    if (record.notify_customer && record.email) {
      results.push(await sendOnce(record, "customer_confirmed", record.email, ctx, shop || undefined));
    }
    // 店が管理画面で登録した予約（電話・DM）は店に通知しない
    if (record.source === "web" && shop) {
      results.push(await sendOnce(record, "shop_new", shop, ctx, record.email || undefined));
    }
  }

  if (type === "UPDATE" && old_record?.status !== "cancelled" && record.status === "cancelled") {
    if (record.notify_customer && record.email) {
      results.push(await sendOnce(record, "customer_cancelled", record.email, ctx, shop || undefined));
    }
  }

  return json({ results });
});
