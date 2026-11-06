// =========================================================
// 予約確認メール（Supabase Edge Function）
//   Database Webhook：reservations の INSERT → この関数
//   ヘッダー x-webhook-secret が WEBHOOK_SECRET と一致したときだけ動く
//   お客様：メールがあれば確認メール／店：Web予約のときに通知
//
//   secrets：RESEND_API_KEY / MAIL_FROM / SHOP_EMAIL / SHOP_TEL / WEBHOOK_SECRET
// =========================================================

type Reservation = {
  id: string; code: string; day: string; service: 'lunch' | 'dinner'; slot: string;
  people: number; course: string; name: string; tel: string; email: string; note: string;
  status: string; source: string; created_at: string;
};

const env = (k: string) => Deno.env.get(k) ?? '';
const PART = { lunch: '昼', dinner: '夜' } as const;
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const SOURCE: Record<string, string> = { web: 'Web', phone: '電話', dm: 'Instagram DM', walkin: '来店', other: 'その他' };

function jpDate(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}年${m}月${d}日（${DOW[dow]}）`;
}
const hhmm = (t: string) => t.slice(0, 5);

function detail(r: Reservation) {
  return [
    `予約番号：${r.code}`,
    `日時　　：${jpDate(r.day)} ${PART[r.service]} ${hhmm(r.slot)}〜`,
    `人数　　：${r.people}名様`,
    `コース　：${r.course || '当日決める'}`,
    `お名前　：${r.name} 様`,
    `電話　　：${r.tel || '—'}`,
    `ご要望　：${r.note || 'なし'}`,
  ].join('\n');
}

function customerMail(r: Reservation) {
  const tel = env('SHOP_TEL') || '095-823-8510';
  return {
    subject: `【割烹 舞ぅ】ご予約を承りました（${jpDate(r.day)} ${PART[r.service]} ${hhmm(r.slot)}〜）`,
    text: `${r.name} 様

このたびは割烹 舞ぅにご予約いただき、ありがとうございます。
以下の内容でご予約を承りました。

${detail(r)}

■ ご変更・キャンセルについて
お電話（${tel}）でご連絡ください。
キャンセル料：前日 コース料金の50%／当日 コース料金の100%
（TODO キャンセル規定は仮）

■ 店舗
割烹 舞ぅ
長崎県長崎市銅座町3-28（西浜町電停・新地中華街電停 徒歩1分）
TEL ${tel}

ご来店を心よりお待ちしております。

※ このメールは送信専用です。ご返信いただいてもお答えできません。
`,
  };
}

function shopMail(r: Reservation) {
  return {
    subject: `【Web予約】${jpDate(r.day)} ${PART[r.service]} ${hhmm(r.slot)} ${r.people}名 ${r.name}様`,
    text: `Webから新しい予約が入りました。

${detail(r)}
メール　：${r.email || '—'}
経路　　：${SOURCE[r.source] ?? r.source}

管理画面で確認・変更できます。
`,
  };
}

async function send(to: string, mail: { subject: string; text: string }, replyTo?: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to: [to], subject: mail.subject, text: mail.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const secret = env('WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return new Response('Unauthorized', { status: 401 });

  let payload: { type?: string; table?: string; record?: Reservation };
  try { payload = await req.json(); } catch { return new Response('Bad Request', { status: 400 }); }
  const r = payload.record;
  if (payload.type !== 'INSERT' || payload.table !== 'reservations' || !r) return new Response('ignored', { status: 200 });

  const results: string[] = [];
  const errors: string[] = [];
  if (r.email) {
    try { await send(r.email, customerMail(r), env('SHOP_EMAIL') || undefined); results.push('customer'); }
    catch (e) { errors.push(String(e)); }
  }
  if (r.source === 'web' && env('SHOP_EMAIL')) {
    try { await send(env('SHOP_EMAIL'), shopMail(r), r.email || undefined); results.push('shop'); }
    catch (e) { errors.push(String(e)); }
  }
  if (errors.length) console.error(errors.join('\n'));
  return new Response(JSON.stringify({ sent: results, errors }), {
    status: errors.length ? 500 : 200, headers: { 'Content-Type': 'application/json' },
  });
});
