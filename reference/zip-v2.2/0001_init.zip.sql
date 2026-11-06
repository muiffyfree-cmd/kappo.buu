-- =========================================================
-- 割烹 舞ぅ 予約システム 初期スキーマ（Supabase / PostgreSQL）
-- =========================================================
create extension if not exists pgcrypto;

-- ---------- 型 ----------
create type service_type       as enum ('lunch', 'dinner');                      -- 昼 / 夜
create type reservation_status as enum ('confirmed', 'cancelled', 'visited', 'no_show');
create type reservation_source as enum ('web', 'phone', 'instagram', 'other');

-- ---------- 設定（1行だけ） ----------
create table public.settings (
  id               int primary key default 1 check (id = 1),
  seats_total      int    not null default 17,      -- 同時に入れる最大人数
  max_web_people   int    not null default 4,       -- Web予約の上限（5名以上は電話）
  closed_dows      int[]  not null default '{0}',   -- 定休曜日 0=日 … 6=土
  cutoff_hours     int    not null default 3,       -- 来店の何時間前までWeb予約可
  booking_days     int    not null default 60,      -- 何日先まで予約可
  lunch_slots      time[] not null default '{11:00,11:30,12:00,12:30,13:00}',
  dinner_slots     time[] not null default '{18:00,18:30,19:00,19:30,20:00}',
  lunch_stay_min   int    not null default 90,      -- 昼の滞在時間（分）
  dinner_stay_min  int    not null default 120,     -- 夜の滞在時間（分）
  updated_at       timestamptz not null default now()
);
insert into public.settings default values;

-- ---------- 臨時休業日 ----------
create table public.closed_days (
  day  date primary key,
  note text
);

-- ---------- 予約 ----------
create table public.reservations (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  day         date not null,
  service     service_type not null,
  start_time  time not null,
  people      int  not null check (people between 1 and 20),
  course      text,
  name        text not null,
  tel         text not null,
  email       text,
  note        text,                                   -- アレルギー・ご要望
  status      reservation_status not null default 'confirmed',
  source      reservation_source not null default 'web',
  staff_memo  text,                                   -- 店用メモ（お客様には見えない）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index reservations_day_idx on public.reservations (day, service);

-- ---------- お知らせ ----------
create table public.news (
  id            uuid primary key default gen_random_uuid(),
  published_on  date not null default current_date,
  tag           text not null default 'お知らせ',      -- お知らせ / 臨時休業 / 新メニュー
  title         text not null,
  body          text,
  is_published  boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- 管理者（Supabase Auth のユーザーのうち、ここに登録された人だけが管理画面に入れる） ----------
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------- updated_at 自動更新 ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger reservations_touch before update on public.reservations
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- =========================================================
-- 空き状況の計算
-- =========================================================
-- 指定した日・部・時間枠の残席数
-- 滞在時間が重なる予約（開始時刻の差が滞在時間未満）の人数を合計して引く。
-- ※ 前後両方向で数えるため安全側（二重予約は起きないが、空きを少なめに出す場合がある）
create or replace function public.slot_remaining(p_day date, p_service service_type, p_slot time)
returns int
language sql stable security definer set search_path = public as $$
  select case
    when ((p_day + p_slot) at time zone 'Asia/Tokyo') < now() + make_interval(hours => s.cutoff_hours) then 0
    when p_day > (now() at time zone 'Asia/Tokyo')::date + s.booking_days then 0
    else greatest(0, s.seats_total - coalesce((
      select sum(r.people)
      from public.reservations r
      where r.day = p_day
        and r.service = p_service
        and r.status in ('confirmed', 'visited')
        and abs(extract(epoch from (r.start_time - p_slot))) / 60
            < case when p_service = 'lunch' then s.lunch_stay_min else s.dinner_stay_min end
    ), 0))::int
  end
  from public.settings s where s.id = 1;
$$;

-- 公開用：期間内の空き状況（個人情報は返さない）
create or replace function public.get_availability(p_from date, p_to date)
returns table (day date, service service_type, slot time, remaining int, is_closed boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  s  public.settings;
  d  date;
  sl time;
begin
  if p_to < p_from or p_to - p_from > 92 then
    raise exception 'RANGE_INVALID';
  end if;
  select * into s from public.settings where id = 1;

  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    if extract(dow from d)::int = any (s.closed_dows)
       or exists (select 1 from public.closed_days c where c.day = d) then
      day := d; service := null; slot := null; remaining := 0; is_closed := true;
      return next;
      continue;
    end if;

    foreach sl in array s.lunch_slots loop
      day := d; service := 'lunch'; slot := sl; is_closed := false;
      remaining := public.slot_remaining(d, 'lunch', sl);
      return next;
    end loop;

    foreach sl in array s.dinner_slots loop
      day := d; service := 'dinner'; slot := sl; is_closed := false;
      remaining := public.slot_remaining(d, 'dinner', sl);
      return next;
    end loop;
  end loop;
end $$;

-- 公開用：Web予約の登録（空きの再確認と排他制御つき）。予約番号を返す
create or replace function public.create_reservation(
  p_day date, p_service service_type, p_time time, p_people int,
  p_course text, p_name text, p_tel text, p_email text, p_note text
) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  s      public.settings;
  v_code text;
begin
  select * into s from public.settings where id = 1;

  if p_people is null or p_people < 1 or p_people > s.max_web_people then
    raise exception 'PEOPLE_LIMIT';
  end if;
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 50
     or length(regexp_replace(coalesce(p_tel, ''), '[^0-9]', '', 'g')) < 10
     or coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_INPUT';
  end if;
  if not ((p_service = 'lunch'  and p_time = any (s.lunch_slots))
       or (p_service = 'dinner' and p_time = any (s.dinner_slots))) then
    raise exception 'INVALID_SLOT';
  end if;
  if extract(dow from p_day)::int = any (s.closed_dows)
     or exists (select 1 from public.closed_days c where c.day = p_day) then
    raise exception 'CLOSED';
  end if;

  -- 同じ日の予約を直列化（同時予約による二重予約を防ぐ）
  perform pg_advisory_xact_lock(hashtext('reserve:' || p_day::text));

  if public.slot_remaining(p_day, p_service, p_time) < p_people then
    raise exception 'FULL';
  end if;

  insert into public.reservations (day, service, start_time, people, course, name, tel, email, note, source)
  values (p_day, p_service, p_time, p_people,
          left(p_course, 30), btrim(p_name), left(p_tel, 20), left(p_email, 100), left(p_note, 500), 'web')
  returning code into v_code;

  return v_code;
end $$;

-- =========================================================
-- RLS（行レベルセキュリティ）
-- =========================================================
alter table public.settings     enable row level security;
alter table public.closed_days  enable row level security;
alter table public.reservations enable row level security;
alter table public.news         enable row level security;
alter table public.admin_users  enable row level security;

-- 設定・休業日：誰でも閲覧可、更新は管理者のみ
create policy settings_read  on public.settings    for select using (true);
create policy settings_admin on public.settings    for update using (public.is_admin()) with check (public.is_admin());
create policy closed_read    on public.closed_days for select using (true);
create policy closed_admin   on public.closed_days for all    using (public.is_admin()) with check (public.is_admin());

-- 予約：管理者のみ（お客様は create_reservation 経由でのみ登録できる）
create policy reservations_admin on public.reservations for all using (public.is_admin()) with check (public.is_admin());

-- お知らせ：公開分は誰でも閲覧可、編集は管理者のみ
create policy news_read  on public.news for select using (is_published or public.is_admin());
create policy news_admin on public.news for all    using (public.is_admin()) with check (public.is_admin());

-- 管理者一覧：管理者のみ閲覧（追加は SQL Editor から）
create policy admin_users_read on public.admin_users for select using (public.is_admin());

-- 関数の実行権限
revoke all on function public.slot_remaining(date, service_type, time) from public;
revoke all on function public.get_availability(date, date) from public;
revoke all on function public.create_reservation(date, service_type, time, int, text, text, text, text, text) from public;
grant execute on function public.get_availability(date, date) to anon, authenticated;
grant execute on function public.create_reservation(date, service_type, time, int, text, text, text, text, text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
