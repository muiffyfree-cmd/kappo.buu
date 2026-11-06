-- =========================================================
-- 割烹 舞ぅ：Supabase の SQL Editor に「まるごと貼り付けて Run」する初期設定
--   中身は migrations/0001_init.sql と 0002_menu.sql をこの順につないだもの
--   （元のファイルを直したら、このファイルも作り直すこと）
--   ・全体を1つのトランザクションで実行。途中でエラーが出たら何も作られない
--   ・実行は1回だけ。2回目は「already exists」のエラーになる（その場合は何も変わらない）
-- =========================================================
begin;

-- =========================================================
-- 割烹 舞ぅ 予約管理  初期スキーマ
--   テーブル：settings / closed_days / reservations / news / admin_users
--   RPC   ：get_availability / create_reservation / slot_remaining / is_admin
--   公開側（anon）は個人情報を一切読めない。予約は RPC 経由で登録だけできる。
-- =========================================================

-- ---------- 設定（1行だけ） ----------
create table public.settings (
  id               int primary key default 1 check (id = 1),
  capacity         int     not null default 17 check (capacity between 1 and 200),       -- 席数（TODO 内訳が決まれば卓単位に）
  max_web_people   int     not null default 4  check (max_web_people between 1 and 20),  -- Web予約の上限人数
  closed_dows      int[]   not null default '{0}',                                        -- 定休曜日（0=日 … 6=土）
  lunch_slots      time[]  not null default '{11:00,11:30,12:00,12:30,13:00}',
  dinner_slots     time[]  not null default '{18:00,18:30,19:00,19:30,20:00}',
  lunch_stay_min   int     not null default 90  check (lunch_stay_min between 15 and 600),  -- 滞在時間（分）
  dinner_stay_min  int     not null default 150 check (dinner_stay_min between 15 and 600),
  cutoff_hours     int     not null default 3  check (cutoff_hours between 0 and 168),     -- 受付締切（来店の何時間前まで）
  booking_days     int     not null default 60 check (booking_days between 1 and 366),     -- 受付期間（今日から何日先まで）
  few_threshold    int     not null default 3  check (few_threshold between 0 and 200),    -- 残席がこれ以下なら △
  updated_at       timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------- 臨時休業日 ----------
create table public.closed_days (
  day        date primary key,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- 予約 ----------
create or replace function public.gen_reservation_code() returns text
language sql volatile as $$
  -- 例：B1105-7KQ3（紛らわしい 0/O/1/I は使わない）
  select 'B' || to_char(now() at time zone 'Asia/Tokyo', 'MMDD') || '-' ||
         string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 4);
$$;

create table public.reservations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default public.gen_reservation_code(),
  day         date not null,
  service     text not null check (service in ('lunch', 'dinner')),
  slot        time not null,
  people      int  not null check (people between 1 and 40),
  course      text not null default '',
  name        text not null check (length(name) between 1 and 100),
  tel         text not null default '' check (length(tel) <= 30),
  email       text not null default '' check (length(email) <= 200),
  note        text not null default '' check (length(note) <= 1000),
  status      text not null default 'booked' check (status in ('booked', 'visited', 'cancelled', 'no_show')),
  source      text not null default 'web' check (source in ('web', 'phone', 'dm', 'walkin', 'other')),
  staff_memo  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index reservations_day_idx on public.reservations (day, service);

-- ---------- お知らせ ----------
create table public.news (
  id            bigint generated always as identity primary key,
  published_on  date not null default (now() at time zone 'Asia/Tokyo')::date,
  tag           text not null default 'お知らせ',   -- お知らせ／休業／メニュー など
  title         text not null,
  body          text not null default '',
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index news_published_idx on public.news (is_published, published_on desc);

-- ---------- 管理者 ----------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- updated_at を自動更新 ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger settings_touch     before update on public.settings     for each row execute function public.touch_updated_at();
create trigger reservations_touch before update on public.reservations for each row execute function public.touch_updated_at();
create trigger news_touch         before update on public.news         for each row execute function public.touch_updated_at();

-- =========================================================
-- 関数
-- =========================================================

-- 管理者かどうか
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- 休業日か（定休曜日 or 臨時休業）
create or replace function public._is_closed(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(dow from p_day)::int = any (s.closed_dows)
      or exists (select 1 from public.closed_days c where c.day = p_day)
  from public.settings s where s.id = 1;
$$;

-- ある時間枠の残席
--   その時間から滞在時間の間に重なる予約（予約中・来店済）の人数を引く
create or replace function public._remaining(p_day date, p_service text, p_slot time, p_exclude uuid default null)
returns int
language sql stable security definer set search_path = public as $$
  select s.capacity - coalesce((
    select sum(r.people)::int
    from public.reservations r
    where r.day = p_day
      and r.service = p_service
      and r.status in ('booked', 'visited')
      and (p_exclude is null or r.id <> p_exclude)
      and r.slot < p_slot + make_interval(mins => case when p_service = 'lunch' then s.lunch_stay_min else s.dinner_stay_min end)
      and p_slot < r.slot + make_interval(mins => case when p_service = 'lunch' then s.lunch_stay_min else s.dinner_stay_min end)
  ), 0)
  from public.settings s where s.id = 1;
$$;

-- 空き状況（公開）
--   返り値：休業日は service/slot が null・is_closed=true の1行。
--   それ以外は時間枠ごとに remaining（残席）と bookable（締切・受付期間内か）。
create or replace function public.get_availability(p_from date, p_to date)
returns table (day date, service text, slot time, remaining int, is_closed boolean, bookable boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  s        public.settings;
  v_today  date := (now() at time zone 'Asia/Tokyo')::date;
  v_from   date;
  v_to     date;
begin
  select * into s from public.settings where id = 1;
  v_from := greatest(p_from, v_today);
  v_to   := least(p_to, v_today + s.booking_days, v_from + 400);
  if v_to < v_from then return; end if;

  return query
  with days as (
    select d::date as day from generate_series(v_from, v_to, interval '1 day') d
  )
  select dd.day, null::text, null::time, 0, true, false
  from days dd where public._is_closed(dd.day)
  union all
  select dd.day, sv.service, sl.slot,
         greatest(public._remaining(dd.day, sv.service, sl.slot), 0),
         false,
         ((dd.day + sl.slot) at time zone 'Asia/Tokyo') - make_interval(hours => s.cutoff_hours) > now()
  from days dd
  cross join (values ('lunch'), ('dinner')) sv(service)
  cross join lateral unnest(case when sv.service = 'lunch' then s.lunch_slots else s.dinner_slots end) sl(slot)
  where not public._is_closed(dd.day)
  order by 1, 2 nulls first, 3;
end $$;

-- 残席の確認（管理画面で保存前に使う）
create or replace function public.slot_remaining(p_day date, p_service text, p_slot time, p_exclude uuid default null)
returns int
language sql stable security definer set search_path = public as $$
  select public._remaining(p_day, p_service, p_slot, p_exclude);
$$;

-- Web予約の登録（公開）。排他制御つき。予約番号を返す。
--   エラー：PEOPLE_LIMIT / INVALID_INPUT / INVALID_SLOT / CLOSED / DEADLINE / FULL
create or replace function public.create_reservation(
  p_day date, p_service text, p_time time, p_people int, p_course text,
  p_name text, p_tel text, p_email text, p_note text
) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  s       public.settings;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_code  text;
  v_left  int;
begin
  select * into s from public.settings where id = 1;

  if p_people is null or p_people < 1 or p_people > s.max_web_people then
    raise exception 'PEOPLE_LIMIT';
  end if;
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 100
     or coalesce(p_tel, '') !~ '^[0-9０-９+()（） \-－ー]{10,20}$'
     or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200
     or length(coalesce(p_note, '')) > 1000 or length(coalesce(p_course, '')) > 100 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_day is null or p_service not in ('lunch', 'dinner')
     or p_time is null
     or not (p_time = any (case when p_service = 'lunch' then s.lunch_slots else s.dinner_slots end))
     or p_day < v_today or p_day > v_today + s.booking_days then
    raise exception 'INVALID_SLOT';
  end if;
  if public._is_closed(p_day) then
    raise exception 'CLOSED';
  end if;
  if ((p_day + p_time) at time zone 'Asia/Tokyo') - make_interval(hours => s.cutoff_hours) <= now() then
    raise exception 'DEADLINE';
  end if;

  -- 同じ日・同じ部の予約を直列化（同時に押されても二重に取らない）
  perform pg_advisory_xact_lock(hashtext('buu:' || p_day::text || ':' || p_service));

  v_left := public._remaining(p_day, p_service, p_time);
  if v_left < p_people then
    raise exception 'FULL';
  end if;

  loop
    begin
      insert into public.reservations (day, service, slot, people, course, name, tel, email, note, source)
      values (p_day, p_service, p_time, p_people, coalesce(p_course, ''), btrim(p_name), btrim(p_tel), btrim(p_email), coalesce(btrim(p_note), ''), 'web')
      returning code into v_code;
      exit;
    exception when unique_violation then
      -- 予約番号がまれに重複したら引き直す
    end;
  end loop;
  return v_code;
end $$;

-- =========================================================
-- 権限・RLS
-- =========================================================
alter table public.settings     enable row level security;
alter table public.closed_days  enable row level security;
alter table public.reservations enable row level security;
alter table public.news         enable row level security;
alter table public.admin_users  enable row level security;

-- settings：だれでも閲覧、管理者だけ更新
create policy settings_read   on public.settings for select using (true);
create policy settings_update on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- closed_days：だれでも閲覧、管理者だけ編集
create policy closed_read  on public.closed_days for select using (true);
create policy closed_write on public.closed_days for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- reservations：管理者だけ（公開側は RPC 経由で登録のみ）
create policy resv_admin on public.reservations for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- news：公開分はだれでも、管理者は全部
create policy news_read  on public.news for select using (is_published or public.is_admin());
create policy news_write on public.news for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- admin_users：ポリシーなし（is_admin() 経由でのみ参照）

-- テーブル権限（RLS と二重で守る）
revoke all on public.reservations, public.admin_users from anon;
grant select on public.settings, public.closed_days, public.news to anon, authenticated;
grant update on public.settings to authenticated;
grant select, insert, update, delete on public.closed_days, public.news, public.reservations to authenticated;

-- 関数の実行権限
revoke execute on function public._is_closed(date), public._remaining(date, text, time, uuid), public.gen_reservation_code() from public, anon, authenticated;
revoke execute on function public.get_availability(date, date), public.create_reservation(date, text, time, int, text, text, text, text, text),
                           public.slot_remaining(date, text, time, uuid), public.is_admin() from public;
grant execute on function public.get_availability(date, date) to anon, authenticated;
grant execute on function public.create_reservation(date, text, time, int, text, text, text, text, text) to anon, authenticated;
grant execute on function public.slot_remaining(date, text, time, uuid) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
-- 予約番号の既定値（管理画面からの登録で使う）
grant execute on function public.gen_reservation_code() to authenticated;


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

commit;
