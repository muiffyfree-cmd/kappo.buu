// =========================================================
// 予約メールの差し込みとHTML化（外部依存なし・純粋関数）
//   Edge Function（Deno）と管理画面のプレビュー（Vite）の両方がこのファイルを読む。
//   管理画面からは js/mail-render.js 経由で import する。
// =========================================================

/**
 * @typedef {{ id: string, code: string, day: string, service: 'lunch'|'dinner', slot: string, people: number,
 *   course: string, name: string, tel: string, email: string, note: string, source: string, status: string }} Reservation
 * @typedef {{ shop_tel: string, tel_hours: string, shop_address: string, shop_access: string, site_url: string,
 *   cancel_policy: string, course_service_note?: string }} MailSettings
 * @typedef {{ subject: string, body: string }} Template
 */

const DOW = '日月火水木金土';
export const SOURCE_LABEL = { web: 'Web', phone: '電話', dm: 'Instagram DM', walkin: '来店', other: 'その他' };

/** 「当日決める」・空欄はコース未選択として扱う */
export const isUndecidedCourse = c => !c || !String(c).trim() || String(c).trim() === '当日決める';

export function jpDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${y}年${m}月${d}日（${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

/** 差し込み項目（管理画面の一覧に出す順） */
export const VARS = [
  ['name', 'お名前'], ['code', '予約番号'], ['date', '日付（2026年11月14日（土））'], ['service', '昼の部／夜の部'],
  ['time', '時刻（18:30）'], ['people', '人数'], ['course', 'コース'], ['note', 'ご要望'],
  ['service_charge_line', 'サービス料の1行（夜のコースのときだけ）'],
  ['shop_tel', '店の電話'], ['tel_hours', '電話の受付時間'], ['cancel_policy', 'キャンセル規定'],
  ['address', '住所'], ['access', 'アクセス'], ['map_url', 'Googleマップ'],
  ['site_url', 'サイト'], ['reserve_url', '予約ページ'],
  ['tel', 'お客様の電話（店向け）'], ['email', 'お客様のメール（店向け）'], ['source', '経路（店向け）'],
  ['booked_people', 'その部の予約人数（店向け）'], ['remaining', '残席（店向け）'], ['admin_url', '管理画面の該当予約（店向け）'],
];

/**
 * @param {Reservation} r
 * @param {MailSettings} s
 * @param {{ isCourse?: boolean, bookedPeople?: number, remaining?: number }} [extra]
 * @returns {Record<string, string>}
 */
export function buildVars(r, s, extra = {}) {
  const site = String(s.site_url || '').replace(/\/$/, '');
  return {
    name: r.name,
    code: r.code,
    date: jpDate(r.day),
    service: r.service === 'lunch' ? '昼の部' : '夜の部',
    time: String(r.slot).slice(0, 5),
    people: String(r.people),
    course: isUndecidedCourse(r.course) ? '当日お決めいただけます' : String(r.course).trim(),
    note: r.note?.trim() || 'なし',
    tel: r.tel || '（未登録）',
    email: r.email || '（未登録）',
    source: SOURCE_LABEL[r.source] ?? r.source,
    shop_tel: s.shop_tel,
    tel_hours: s.tel_hours,
    cancel_policy: s.cancel_policy,
    address: s.shop_address,
    access: s.shop_access,
    map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('割烹 舞ぅ ' + s.shop_address)}`,
    site_url: site,
    reserve_url: `${site}/reserve.html`,
    admin_url: `${site}/admin/reservation.html?id=${r.id}`,
    service_charge_line: extra.isCourse
      ? `・${s.course_service_note || 'コース料理はコース金額の10%のサービス料を頂戴いたします。'}\n` : '',
    booked_people: String(extra.bookedPeople ?? '-'),
    remaining: String(extra.remaining ?? '-'),
  };
}

const KEY_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** {{key}} を置き換える。未定義のキーはそのまま残す（文面の書き間違いに気づけるように） */
export function fill(text, vars) {
  return text.replace(KEY_RE, (m, k) => (k in vars ? vars[k] : m));
}

/** 一覧にない {{〇〇}}（重複なし） */
export function unknownKeys(text, vars) {
  return [...new Set([...text.matchAll(KEY_RE)].map(m => m[1]).filter(k => !(k in vars)))];
}

const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 長いURL（地図など）は文字ではなくリンク名で表示する（esc 済みの文字列に対して使う）
const link = s =>
  s.replace(/https?:\/\/[^\s<]+/g, u => {
    const label = u.includes('google.com/maps') ? 'Googleマップで開く' : u.length > 60 ? 'リンクを開く' : u;
    return `<a href="${u}" style="color:#111111;word-break:break-all;">${label}</a>`;
  });

/** 本文（プレーンテキスト）から、白×黒×金のHTMLメールを作る。「■」で始まる行は見出しになる */
export function toHtml(text, preheader = '', footer = '割烹 舞ぅ') {
  const lines = text.split('\n').map(line => {
    if (line.startsWith('■')) {
      return `<tr><td style="padding:22px 0 6px;font-family:'Hiragino Mincho ProN','Yu Mincho',serif;font-size:15px;font-weight:600;letter-spacing:.1em;color:#111111;border-bottom:1px solid #bca369;">${esc(line.replace(/^■\s*/, ''))}</td></tr>`;
    }
    if (line.trim() === '') return '<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>';
    return `<tr><td style="padding:2px 0;font-size:14px;line-height:1.85;color:#28211c;">${link(esc(line))}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1ea;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fffdf8;border:1px solid #e6dcc6;">
<tr><td style="background:#111111;padding:22px 32px;text-align:center;font-family:'Hiragino Mincho ProN','Yu Mincho',serif;color:#ffffff;font-size:20px;letter-spacing:.3em;">割烹 舞ぅ<div style="font-size:10px;letter-spacing:.4em;color:#d8c08a;margin-top:4px;">KAPPO BUU</div></td></tr>
<tr><td style="height:3px;background:#bca369;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 32px;font-family:'Hiragino Sans','Yu Gothic','Noto Sans JP',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines}</table>
</td></tr>
<tr><td style="padding:18px 32px;background:#111111;color:#cfcfcf;font-size:11px;line-height:1.8;text-align:center;font-family:sans-serif;">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** @param {Template} t @param {Record<string, string>} vars */
export function render(t, vars) {
  const subject = fill(t.subject, vars).replace(/\s*\n\s*/g, ' ');
  const text = fill(t.body, vars);
  const footer = `割烹 舞ぅ｜${vars.address ?? ''}｜TEL ${vars.shop_tel ?? ''}`;
  return { subject, text, html: toHtml(text, subject, footer) };
}

/** テスト送信・プレビューで使うサンプルの予約（夜・コースあり） */
export function sampleReservation(day, email = 'guest@example.com') {
  return {
    id: '00000000-0000-0000-0000-000000000000', code: 'B1114-TEST', day, service: 'dinner', slot: '18:30',
    people: 2, course: '花麗', name: '長崎 太郎', tel: '090-0000-0000', email, note: '結婚記念日です',
    source: 'web', status: 'booked',
  };
}

/** 文面の初期値（supabase/migrations/0003_mail.sql と同じ。デモと「初期の文面に戻す」で使う） */
export const DEFAULT_TEMPLATES = [
  {
    key: 'customer_confirmed', label: 'お客様へ：予約完了', enabled: true,
    subject: '【割烹 舞ぅ】ご予約を承りました（{{date}} {{service}} {{time}}）',
    body: `{{name}} 様

このたびは割烹 舞ぅをご予約いただき、誠にありがとうございます。
下記の内容でご予約を承りました。

■ ご予約内容
予約番号　{{code}}
日時　　　{{date}} {{service}} {{time}}〜
人数　　　{{people}}名様
コース　　{{course}}
ご要望　　{{note}}

■ ご来店にあたって
・ご変更・キャンセルはお電話にて承ります。
　TEL {{shop_tel}}（受付 {{tel_hours}}）
・{{cancel_policy}}
{{service_charge_line}}・5名様以上へのご変更や貸切のご相談も、お電話でお気軽にどうぞ。
・アレルギーや苦手な食材がございましたら、このメールへのご返信でお知らせください。

■ 店舗のご案内
割烹 舞ぅ
{{address}}
{{access}}
地図：{{map_url}}
※専用駐車場はございません。近隣のコインパーキングをご利用ください。

{{name}} 様のご来店を、心よりお待ちしております。

割烹 舞ぅ
{{site_url}}`,
  },
  {
    key: 'customer_cancelled', label: 'お客様へ：キャンセル完了', enabled: true,
    subject: '【割烹 舞ぅ】ご予約のキャンセルを承りました（{{date}} {{service}} {{time}}）',
    body: `{{name}} 様

割烹 舞ぅでございます。
下記のご予約のキャンセルを承りました。

■ キャンセルしたご予約
予約番号　{{code}}
日時　　　{{date}} {{service}} {{time}}〜
人数　　　{{people}}名様

またの機会に、{{name}} 様にお目にかかれますことを楽しみにしております。
空き状況はこちらからご覧いただけます。
{{reserve_url}}

お心当たりのない場合は、お手数ですがお電話（{{shop_tel}}）でご連絡ください。

割烹 舞ぅ
TEL {{shop_tel}}`,
  },
  {
    key: 'shop_new', label: 'お店へ：新しい予約の通知', enabled: true,
    subject: '【新規予約・{{source}}】{{date}} {{service}} {{time}}　{{people}}名　{{name}}様',
    body: `新しい予約が入りました。

■ 予約内容
予約番号　{{code}}
日時　　　{{date}} {{service}} {{time}}〜
人数　　　{{people}}名
コース　　{{course}}
ご要望　　{{note}}

■ お客様
お名前　　{{name}} 様
電話　　　{{tel}}
メール　　{{email}}
経路　　　{{source}}

■ この日の{{service}}の状況
予約済み　{{booked_people}}名 ／ 残り {{remaining}}席（{{time}}時点）

管理画面で確認する：{{admin_url}}`,
  },
];
