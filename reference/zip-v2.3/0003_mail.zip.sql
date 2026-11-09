-- =========================================================
-- 0003 予約メール（文面を管理画面から編集・送信履歴）
-- =========================================================

-- ---------- 店の情報（メールに差し込む） ----------
alter table public.settings
  add column shop_email     text not null default '',                                   -- 店への通知先
  add column shop_tel       text not null default '095-823-8510',
  add column tel_hours      text not null default '10:00〜22:00・日曜定休',          -- TODO 要確認
  add column shop_address   text not null default '長崎県長崎市銅座町3-28',
  add column shop_access    text not null default '西浜町電停・新地中華街電停より徒歩1分',
  add column site_url       text not null default 'http://localhost:3100',               -- 本番ドメインに変更
  add column cancel_policy  text not null default 'キャンセル・人数の変更は、前日までにお電話でご連絡ください。'; -- TODO 規定が決まったら差し替え

-- 予約ごとに「お客様へメールを送るか」（電話予約で管理画面から登録するときに選べる）
alter table public.reservations
  add column notify_customer boolean not null default true;

-- ---------- メールの文面 ----------
create table public.mail_templates (
  key         text primary key,          -- customer_confirmed / customer_cancelled / shop_new
  label       text not null,             -- 管理画面での表示名
  enabled     boolean not null default true,
  subject     text not null,
  body        text not null,             -- {{name}} などの差し込み可。「■」で始まる行は見出しになる
  updated_at  timestamptz not null default now()
);
create trigger mail_templates_touch before update on public.mail_templates
  for each row execute function public.touch_updated_at();

-- ---------- 送信履歴（二重送信の防止・管理画面での確認） ----------
create table public.mail_log (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid references public.reservations (id) on delete set null,
  template_key    text not null,
  to_email        text not null,
  status          text not null,          -- sent / failed / skipped
  provider_id     text,                   -- Resend のメールID
  error           text,
  created_at      timestamptz not null default now()
);
create unique index mail_log_once on public.mail_log (reservation_id, template_key) where status = 'sent';
create index mail_log_res_idx on public.mail_log (reservation_id);

alter table public.mail_templates enable row level security;
alter table public.mail_log       enable row level security;
create policy mail_templates_admin on public.mail_templates for all    using (public.is_admin()) with check (public.is_admin());
create policy mail_log_admin       on public.mail_log       for select using (public.is_admin());

-- ---------- 文面の初期値 ----------
insert into public.mail_templates (key, label, subject, body) values
(
'customer_confirmed', 'お客様へ：予約完了',
'【割烹 舞ぅ】ご予約を承りました（{{date}} {{service}} {{time}}）',
$body${{name}} 様

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
{{site_url}}$body$
),
(
'customer_cancelled', 'お客様へ：キャンセル完了',
'【割烹 舞ぅ】ご予約のキャンセルを承りました（{{date}} {{service}} {{time}}）',
$body${{name}} 様

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
TEL {{shop_tel}}$body$
),
(
'shop_new', 'お店へ：新しい予約の通知',
'【新規予約・{{source}}】{{date}} {{service}} {{time}}　{{people}}名　{{name}}様',
$body$新しい予約が入りました。

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

管理画面で確認する：{{admin_url}}$body$
);

-- Edge Function（service_role）から残席を計算できるようにする
grant execute on function public.slot_remaining(date, service_type, time) to service_role;
