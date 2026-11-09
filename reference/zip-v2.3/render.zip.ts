// メール文面の差し込みとHTML化（外部依存なし・テスト可能な純粋関数）

export type Reservation = {
  id: string; code: string; day: string; service: "lunch" | "dinner"; start_time: string;
  people: number; course: string | null; name: string; tel: string; email: string | null;
  note: string | null; source: "web" | "phone" | "instagram" | "other"; status: string;
};
export type Settings = {
  shop_tel: string; tel_hours: string; shop_address: string; shop_access: string;
  site_url: string; cancel_policy: string; course_service_note?: string;
};
export type Template = { subject: string; body: string };

const DOW = "日月火水木金土";
const SOURCE: Record<string, string> = { web: "Web", phone: "電話", instagram: "Instagram", other: "その他" };

export function jpDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`); // 日付のみを扱うため正午UTCで固定
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${DOW[d.getUTCDay()]}）`;
}

export function buildVars(
  r: Reservation, s: Settings,
  extra: { isCourse?: boolean; bookedPeople?: number; remaining?: number } = {},
): Record<string, string> {
  const site = s.site_url.replace(/\/$/, "");
  return {
    name: r.name,
    code: r.code,
    date: jpDate(r.day),
    service: r.service === "lunch" ? "昼の部" : "夜の部",
    time: r.start_time.slice(0, 5),
    people: String(r.people),
    course: r.course?.trim() || "当日お決めいただけます",
    note: r.note?.trim() || "なし",
    tel: r.tel,
    email: r.email || "（未登録）",
    source: SOURCE[r.source] ?? r.source,
    shop_tel: s.shop_tel,
    tel_hours: s.tel_hours,
    cancel_policy: s.cancel_policy,
    address: s.shop_address,
    access: s.shop_access,
    map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("割烹 舞ぅ " + s.shop_address)}`,
    site_url: site,
    reserve_url: `${site}/reserve.html`,
    admin_url: `${site}/admin/reservation.html?id=${r.id}`,
    service_charge_line: extra.isCourse ? `・${s.course_service_note ?? "コース料理はコース金額の10%のサービス料を頂戴いたします。"}\n` : "",
    booked_people: String(extra.bookedPeople ?? "-"),
    remaining: String(extra.remaining ?? "-"),
  };
}

/** {{key}} を置き換える。未定義のキーはそのまま残す（文面の書き間違いに気づけるように） */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function unknownKeys(text: string, vars: Record<string, string>): string[] {
  return [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !(k in vars));
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// 長いURL（地図など）は文字ではなくリンク名で表示する
const link = (s: string) =>
  s.replace(/https?:\/\/[^\s<]+/g, (u) => {
    const label = u.includes("google.com/maps") ? "Googleマップで開く" : u.length > 60 ? "リンクを開く" : u;
    return `<a href="${u}" style="color:#111111;word-break:break-all;">${label}</a>`;
  });

/** 本文（プレーンテキスト）から、白×黒×金のHTMLメールを作る */
export function toHtml(text: string, preheader = "", footer = "割烹 舞ぅ"): string {
  const lines = text.split("\n").map((line) => {
    if (line.startsWith("■")) {
      return `<tr><td style="padding:22px 0 6px;font-family:'Hiragino Mincho ProN','Yu Mincho',serif;font-size:15px;font-weight:600;letter-spacing:.1em;color:#111111;border-bottom:1px solid #bca369;">${esc(line.replace(/^■\s*/, ""))}</td></tr>`;
    }
    if (line.trim() === "") return `<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>`;
    return `<tr><td style="padding:2px 0;font-size:14px;line-height:1.85;color:#28211c;">${link(esc(line))}</td></tr>`;
  }).join("");

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

export function render(t: Template, vars: Record<string, string>) {
  const subject = fill(t.subject, vars);
  const text = fill(t.body, vars);
  const footer = `割烹 舞ぅ｜${vars.address ?? ""}｜TEL ${vars.shop_tel ?? ""}`;
  return { subject, text, html: toHtml(text, subject, footer) };
}
