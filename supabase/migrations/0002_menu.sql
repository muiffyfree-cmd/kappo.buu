-- =========================================================
-- 0002 お品書き（管理画面から編集）
-- =========================================================
create type menu_category as enum ('lunch', 'dinner', 'option', 'drink');

create table public.menu_items (
  id              uuid primary key default gen_random_uuid(),
  category        menu_category not null,              -- 昼の定食 / 夜のコース / オプション / 飲み物
  name            text not null,                       -- 例）花麗
  subtitle        text,                                -- 例）11品
  price           int,                                 -- 円。null なら価格を出さない（時価など）
  price_note      text,                                -- 例）税込 ／ 税込・サービス料10%別
  description     text,                                -- 例）御飯、お味噌汁、香の物
  examples        text[] not null default '{}',        -- 例）茶碗蒸し / 銀鱈の塩麹蒸し …（半月ごとに変更）
  examples_note   text,                                -- 例）以下メニューは半月に一度変更
  image_path      text,                                -- Storage「menu」バケット内のパス（「/」で始まる場合はサイト内の画像）
  badge           text,                                -- 例）冬季限定 / おすすめ
  is_available    boolean not null default true,       -- 提供中か（false：お休み）
  available_from  date,                                -- 期間限定の開始（null＝制限なし）
  available_until date,                                -- 期間限定の終了
  reservable      boolean not null default false,      -- 予約フォームの「コース」選択肢に出すか
  sort_order      int not null default 100,
  updated_at      timestamptz not null default now()
);
create index menu_items_cat_idx on public.menu_items (category, sort_order);
create trigger menu_items_touch before update on public.menu_items
  for each row execute function public.touch_updated_at();

-- 共通の注記（1行）
alter table public.settings
  add column menu_note text not null default '※ 昼・夜・甘味メニューは仕入れ状況によりお品書きを変更する場合がございます。',
  add column course_service_note text not null default 'コース料理はコース金額の10%のサービス料金を頂戴します。';

-- 公開ページで表示してよいものだけを返すビュー
create view public.menu_public
with (security_invoker = true) as
  select id, category, name, subtitle, price, price_note, description, examples, examples_note,
         image_path, badge, reservable, sort_order
  from public.menu_items
  where is_available
    and (available_from  is null or available_from  <= (now() at time zone 'Asia/Tokyo')::date)
    and (available_until is null or available_until >= (now() at time zone 'Asia/Tokyo')::date);

alter table public.menu_items enable row level security;
create policy menu_read  on public.menu_items for select using (true);
create policy menu_admin on public.menu_items for all    using (public.is_admin()) with check (public.is_admin());
grant select on public.menu_public to anon, authenticated;
-- テーブル権限（Supabase の既定の権限に頼らず明示する）
grant select on public.menu_items to anon, authenticated;
grant insert, update, delete on public.menu_items to authenticated;

-- ---------- 初期データ（Instagramのお品書き 2026年10月・11月の投稿より） ----------
insert into public.menu_items
  (category, name, subtitle, price, price_note, description, examples, examples_note, badge, is_available, available_from, reservable, sort_order, image_path) values
  ('dinner', '花麗',   '11品', 9000, 'サービス料10%別', null, '{}', null, null, true, null, true, 10, null),
  ('dinner', 'せせらぎ', '9品', 7500, 'サービス料10%別', null, '{}', null, null, true, null, true, 20, null),
  ('dinner', 'しゃぶしゃぶコース', null, null, null, 'こだわりの薬味とともに', '{}', null, null, true, null, true, 30, '/assets/img/shabushabu.jpg'),
  ('lunch', '舞ぅのおでんくん', null, 2480, '税込', '季節のおでん、季節の鮮魚、ご飯、〆豆めし', '{}', null, '冬季限定', true, '2026-11-05', false, 10, null),
  ('lunch', '舞ぅのたまて箱', null, 2480, '税込', '御飯、お味噌汁、お出汁、香の物',
     '{茶碗蒸し,旬のお造り2種,鯛の胡麻掛け,絶品豚の角煮,鮮魚のあら炊き,小松菜と海老のお浸し}', '以下メニューは半月に一度変更（例）', null, true, null, false, 20, null),
  ('lunch', '舞ぅの味彩御膳', null, 2280, '税込', '御飯、お味噌汁、香の物',
     '{茶碗蒸し,銀鱈の塩麹蒸し,鶏のきゃべつ蒸し,季節の野菜4種,巾着ハンバーグの和出汁煮,酔っ払い海老}', '以下メニューは半月に一度変更（例）', null, false, null, false, 30, null),
  ('option', 'ご飯大盛り', 'お昼のお得なセット', 120, '＋', null, '{}', null, null, true, null, false, 10, null),
  ('option', '自家製甘味＋お飲物', 'お昼のお得なセット', 500, '＋', 'コーヒー／烏龍茶／オレンジジュース／コーラ／炭酸水', '{}', null, null, true, null, false, 20, null),
  ('option', '記念日プレート（お花付き）', '昼・夜とも記念日のお祝い承ります', 700, '＋', null, '{}', null, null, true, null, false, 30, null);

-- ---------- 画像の保存先（Supabase Storage） ----------
insert into storage.buckets (id, name, public) values ('menu', 'menu', true)
  on conflict (id) do nothing;
create policy menu_images_read  on storage.objects for select using (bucket_id = 'menu');
create policy menu_images_write on storage.objects for insert with check (bucket_id = 'menu' and public.is_admin());
create policy menu_images_edit  on storage.objects for update using (bucket_id = 'menu' and public.is_admin());
create policy menu_images_del   on storage.objects for delete using (bucket_id = 'menu' and public.is_admin());
