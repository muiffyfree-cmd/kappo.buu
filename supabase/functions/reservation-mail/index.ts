// =========================================================
// 予約メールの自動送信（Supabase Edge Function）
//
// 呼び出し元
//   Database Webhook（reservations の INSERT と UPDATE）。ヘッダー x-webhook-secret が WEBHOOK_SECRET と一致したときだけ動く
//     INSERT                           → お客様へ「予約完了」＋ お店へ「新しい予約」（Web予約のときだけ）
//     UPDATE（状態がキャンセルに変化）   → お客様へ「キャンセル完了」
//   管理画面の「テスト送信」：POST { type: "TEST", template_key, template?, to }（管理者のJWTが必要）
//
// 文面は mail_templates、店の情報は settings、店の通知先は mail_settings（どれも管理画面の「メール」で編集）
// 同じ予約・同じ文面は二度送らない（mail_log）。送信結果はすべて mail_log に残る
//
// シークレット（supabase secrets set）：RESEND_API_KEY / MAIL_FROM / WEBHOOK_SECRET
// ※ SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Edge Function に自動で入る
// デプロイ：supabase functions deploy reservation-mail --no-verify-jwt
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildVars, isUndecidedCourse, render, sampleReservation, unknownKeys } from '../_shared/mail-render.js';

type Reservation = {
  id: string; code: string; day: string; service: 'lunch' | 'dinner'; slot: string; people: number;
  course: string; name: string; tel: string; email: string; note: string; source: string; status: string;
  notify_customer?: boolean;
};
type Template = { key: string; label: string; enabled: boolean; subject: string; body: string };

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// 管理画面（ブラウザ）からのテスト送信のため
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function sendResend(to: string, subject: string, text: string, html: string, replyTo?: string) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('MAIL_FROM'), to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true as const, id: String(body.id ?? '') } : { ok: false as const, error: `${res.status} ${JSON.stringify(body)}` };
  } catch (e) {
    return { ok: false as const, error: String(e) };
  }
}

async function loadContext(r: Reservation) {
  const [s, ms, tpls, menu, same, remaining] = await Promise.all([
    db.from('settings').select('*').eq('id', 1).single(),
    db.from('mail_settings').select('shop_email').eq('id', 1).single(),
    db.from('mail_templates').select('*'),
    db.from('menu_items').select('name').eq('category', 'dinner'),
    // その日・その部の予約人数
    db.from('reservations').select('people').eq('day', r.day).eq('service', r.service).in('status', ['booked', 'visited']),
    // その時間の残席
    db.rpc('slot_remaining', { p_day: r.day, p_service: r.service, p_slot: r.slot, p_exclude: null }),
  ]);
  if (s.error) throw new Error(`settings: ${s.error.message}`);
  if (tpls.error) throw new Error(`mail_templates: ${tpls.error.message}`);
  const course = String(r.course ?? '').trim();
  const isCourse = r.service === 'dinner' && !isUndecidedCourse(course)
    && !!menu.data?.some((m: { name: string }) => course.includes(m.name));
  const vars = buildVars(r, s.data, {
    isCourse,
    bookedPeople: (same.data ?? []).reduce((a: number, x: { people: number }) => a + x.people, 0),
    remaining: typeof remaining.data === 'number' ? Math.max(remaining.data, 0) : undefined,
  });
  return {
    shopEmail: String(ms.data?.shop_email ?? ''),
    templates: new Map<string, Template>((tpls.data ?? []).map((t: Template) => [t.key, t])),
    vars,
  };
}
type Ctx = Awaited<ReturnType<typeof loadContext>>;

/** 1通送る。先に「送信中」の行を入れて取り合うので、同じ予約・同じ文面は二度送らない */
async function sendOnce(r: Reservation, key: string, to: string, ctx: Ctx, replyTo?: string) {
  const tpl = ctx.templates.get(key);
  if (!tpl || !tpl.enabled) return { key, status: 'skipped', reason: 'disabled' };
  if (!to) return { key, status: 'skipped', reason: 'no address' };

  const claim = await db.from('mail_log')
    .insert({ reservation_id: r.id, template_key: key, to_email: to, status: 'sending' })
    .select('id').single();
  if (claim.error) {
    if (claim.error.code === '23505') return { key, status: 'skipped', reason: 'already sent' };
    throw new Error(`mail_log: ${claim.error.message}`);
  }

  const unknown = unknownKeys(tpl.subject + tpl.body, ctx.vars);
  if (unknown.length) console.warn(`未定義の差し込み：${unknown.join(', ')}（${key}）`);

  const m = render(tpl, ctx.vars);
  const res = await sendResend(to, m.subject, m.text, m.html, replyTo);
  await db.from('mail_log').update(res.ok
    ? { status: 'sent', provider_id: res.id, error: null }
    : { status: 'failed', error: res.error.slice(0, 2000) }).eq('id', claim.data.id);
  if (!res.ok) console.error(`送信失敗（${key} → ${to}）：${res.error}`);
  return { key, status: res.ok ? 'sent' : 'failed' };
}

async function handleTest(req: Request, payload: Record<string, unknown>) {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const { data: admin } = u?.user
    ? await db.from('admin_users').select('user_id').eq('user_id', u.user.id).maybeSingle()
    : { data: null };
  if (!admin) return json({ ok: false, error: 'forbidden' }, 403);

  const to = String(payload.to ?? '').trim();
  if (!EMAIL_RE.test(to)) return json({ ok: false, error: 'invalid address' }, 400);

  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 日本時間の今日
  const ctx = await loadContext(sampleReservation(today, to));
  // 保存前の文面も試せる（template があればそれを使う）
  const given = payload.template as { subject?: unknown; body?: unknown } | undefined;
  const tpl = given && typeof given.subject === 'string' && typeof given.body === 'string'
    ? { subject: given.subject, body: given.body }
    : ctx.templates.get(String(payload.template_key));
  if (!tpl) return json({ ok: false, error: 'template not found' }, 404);

  const m = render(tpl, ctx.vars);
  const res = await sendResend(to, `[テスト] ${m.subject}`, m.text, m.html, ctx.shopEmail || undefined);
  return json({ ...res, unknown: unknownKeys(tpl.subject + tpl.body, ctx.vars) }, res.ok ? 200 : 502);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return json({ error: 'bad json' }, 400);

  try {
    // ---------- 管理画面からのテスト送信 ----------
    if (payload.type === 'TEST') return await handleTest(req, payload);

    // ---------- Database Webhook ----------
    const secret = env('WEBHOOK_SECRET');
    if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'forbidden' }, 401);
    const { type, table, record, old_record } = payload as { type: string; table: string; record?: Reservation; old_record?: Reservation };
    if (table !== 'reservations' || !record) return json({ skipped: 'not a reservation' });

    const isNew = type === 'INSERT' && record.status === 'booked';
    const isCancel = type === 'UPDATE' && record.status === 'cancelled' && old_record?.status !== 'cancelled';
    if (!isNew && !isCancel) return json({ skipped: 'nothing to send' }); // それ以外の更新では何もしない

    const ctx = await loadContext(record);
    const shop = ctx.shopEmail;
    const toCustomer = record.notify_customer !== false && !!record.email;
    const results = [];
    if (isNew) {
      if (toCustomer) results.push(await sendOnce(record, 'customer_confirmed', record.email, ctx, shop || undefined));
      // 店が管理画面で登録した予約（電話・DMなど）は店に通知しない
      if (record.source === 'web' && shop) results.push(await sendOnce(record, 'shop_new', shop, ctx, record.email || undefined));
    }
    if (isCancel && toCustomer) {
      results.push(await sendOnce(record, 'customer_cancelled', record.email, ctx, shop || undefined));
    }
    return json({ results }, results.some((x) => x.status === 'failed') ? 500 : 200);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
