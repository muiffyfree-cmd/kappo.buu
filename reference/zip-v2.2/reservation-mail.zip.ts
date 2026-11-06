// 予約が登録されたら確認メールを送る Edge Function
// Supabase の Database Webhook（reservations テーブルの INSERT）から呼び出す。
//
// 必要なシークレット（supabase secrets set で登録。コードに書かない）
//   RESEND_API_KEY  … Resend の APIキー（Sending access）
//   MAIL_FROM       … 例）割烹 舞ぅ <yoyaku@kappo-buu.jp>（Resendで認証済みのドメイン）
//   SHOP_EMAIL      … 店への通知先
//   SHOP_TEL        … 095-823-8510
//   WEBHOOK_SECRET  … Webhook のヘッダー x-webhook-secret と同じ値

type Reservation = {
  code: string; day: string; service: "lunch" | "dinner"; start_time: string;
  people: number; course: string | null; name: string; tel: string;
  email: string | null; note: string | null; source: string;
};

const env = (k: string) => Deno.env.get(k) ?? "";
const DOW = "日月火水木金土";

function jpDate(day: string) {
  const d = new Date(`${day}T12:00:00Z`); // 日付だけを扱うので正午UTCで固定
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${DOW[d.getUTCDay()]}）`;
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
  const { type, record } = (await req.json()) as { type: string; record: Reservation };
  if (type !== "INSERT" || !record) return new Response("skip");

  const when = `${jpDate(record.day)} ${record.service === "lunch" ? "昼" : "夜"} ${record.start_time.slice(0, 5)}〜`;
  const detail =
`━━━━━━━━━━━━━━━━
予約番号：${record.code}
日時　　：${when}
人数　　：${record.people}名様
コース　：${record.course ?? "当日決める"}
ご要望　：${record.note || "なし"}
━━━━━━━━━━━━━━━━`;

  // お客様へ（Web予約でメールがある場合のみ）
  if (record.source === "web" && record.email) {
    await send(record.email, `【割烹 舞ぅ】ご予約を承りました（${when}）`,
`${record.name} 様

このたびは割烹 舞ぅをご予約いただき、誠にありがとうございます。
以下の内容で承りました。

${detail}

ご変更・キャンセルはお電話（${env("SHOP_TEL")}）にてご連絡ください。
ご来店を心よりお待ちしております。

割烹 舞ぅ
長崎県長崎市銅座町3-28　TEL ${env("SHOP_TEL")}
※このメールは送信専用です。`, env("SHOP_EMAIL"));
  }

  // 店へ通知
  if (env("SHOP_EMAIL")) {
    await send(env("SHOP_EMAIL"), `【${record.source === "web" ? "Web予約" : "予約登録"}】${when} ${record.people}名 ${record.name}様`,
`${detail}
お名前：${record.name} 様
電話　：${record.tel}
メール：${record.email ?? "-"}
経路　：${record.source}

管理画面：/admin/`);
  }
  return new Response("ok");
});
