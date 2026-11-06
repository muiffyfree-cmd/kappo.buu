// 予約が入ったら確認メールを送る（Supabase Edge Function / Deno）
// 呼び出し元：Database Webhook（reservations の INSERT）
// 必要なシークレット：RESEND_API_KEY, MAIL_FROM, SHOP_EMAIL, SHOP_TEL, WEBHOOK_SECRET

const env = (k: string) => Deno.env.get(k) ?? "";
const DOW = "日月火水木金土";

function jpDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日（${DOW[dow]}）`;
}

async function send(to: string, subject: string, text: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("MAIL_FROM"), to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) console.error("Resend error", res.status, await res.text());
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== env("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const { type, record: r } = await req.json();
  if (type !== "INSERT" || !r) return new Response("skip");

  const when = `${jpDate(r.day)} ${String(r.start_time).slice(0, 5)}〜（${r.part === "lunch" ? "昼" : "夜"}）`;
  const detail =
`予約番号：${r.code}
日時　　：${when}
人数　　：${r.people}名様
コース　：${r.course ?? "当日決める"}
ご要望　：${r.note ?? "なし"}`;

  // お客様へ（Web予約でメールがある場合のみ）
  if (r.source === "web" && r.email) {
    await send(r.email, `【割烹 舞ぅ】ご予約を承りました（${when}）`,
`${r.name} 様

このたびは割烹 舞ぅをご予約いただき、誠にありがとうございます。
以下の内容で承りました。

━━━━━━━━━━━━━━━━
${detail}
━━━━━━━━━━━━━━━━

ご変更・キャンセルはお電話（${env("SHOP_TEL")}）にてご連絡ください。
ご来店を心よりお待ちしております。

割烹 舞ぅ
長崎県長崎市銅座町3-28　TEL ${env("SHOP_TEL")}
※このメールは送信専用です。`, env("SHOP_EMAIL"));
  }

  // お店へ（Webからの予約のみ通知）
  if (r.source === "web" && env("SHOP_EMAIL")) {
    await send(env("SHOP_EMAIL"), `【Web予約】${when} ${r.people}名 ${r.name}様`,
`Web予約が入りました。

${detail}
お名前　：${r.name} 様
電話　　：${r.tel}
メール　：${r.email ?? "-"}

管理画面で確認できます。`);
  }
  return new Response("ok");
});
