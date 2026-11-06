-- =========================================================
-- 割烹 舞ぅ 予約システム（Supabase / PostgreSQL）
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行
-- =========================================================
create extension if not exists pgcrypto;

-- ---------- 設定（1行だけ） ----------
create table public.settings (
  id               int primary key default 1 check (id = 1),
  capacity         int  not null default 17,     -- 同時に入れる最大人数（席数）
  max_web_people   int  not null default 4,      -- Web予約の上限人数（5名以上は電話）
  lunch_stay_min   int  not null default 90,     -- 昼の滞在時間（分）
  dinner_stay_min  int  not null default 150,    -- 夜の滞在時間（分）
  closed_weekdays  int[] not null default '{0}', -- 定休曜日 0=日 1=月 … 6=土
  cutoff_hours     int  not null default 3,      -- 来店の何時間前までWeb予約可
  booking_days     int  not null default 60,     -- 何日先まで予約可
  updated_at       timestamptz not null default now()
);
insert into public.settings default values;

-- ---------- 時間枠 ----------
create table public.time_slots (
  id         serial primary key,
  part       text not null check (part in ('lunch','dinner')),
  start_time time not null,
  active     boolean not null default true,
  unique (part, start_time)
);
insert into public.time_slots (part, start_time) values
  ('lunch','11:00'),('lunch','11:30'),('lunch','12:00'),('lunch','12:30'),('lunch','13:00'),
  ('dinner','18:00'),('dinner','18:30'),('dinner','19:00'),('dinner','19:30'),('dinner','20:00');

-- ---------- 臨時休業日 ----------
create table public.closed_days (
  day  date primary key,
  memo text
);

-- ---------- 予約 ----------
create type public.reservation_status as enum ('reserved','visited','cancelled','no_show');

create table public.reservations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  day         date not null,
  part        text not null check (part in ('lunch','dinner')),
  start_time  time not null,
  people      int  not null check (people between 1 and 20),
  course      text,
  name        text not null,
  tel         text not null,
  email       text,
  note        text,
  status      public.reservation_status not null default 'reserved',
  source      text not null default 'web' check (source in ('web','phone','instagram','other')),
  admin_memo  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index reservations_day_idx on public.reservations (day, part);

-- ---------- お知らせ ----------
create table public.news (
  id            bigserial primary key,
  published_on  date not null default current_date,
  title         text not null,
  body          text,
  is_published  boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- 管理者 ----------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- updated_at 自動更新 ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger reservations_touch before update on public.reservations
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- =========================================================
-- RLS（行レベルセキュリティ）
--  ・お客様（anon）は予約表を直接読めない／書けない
--  ・空き状況と予約登録は下の関数経由のみ
--  ・管理者（admins に登録されたユーザー）は全操作可
-- =========================================================
alter table public.settings     enable row level security;
alter table public.time_slots   enable row level security;
alter table public.closed_days  enable row level security;
alter table public.reservations enable row level security;
alter table public.news         enable row level security;
alter table public.admins       enable row level security;

create policy "admin all settings"     on public.settings     for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all time_slots"   on public.time_slots   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all closed_days"  on public.closed_days  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all reservations" on public.reservations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all news"         on public.news         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin read admins"      on public.admins       for select to authenticated using (public.is_admin());

create policy "public read news" on public.news for select to anon, authenticated using (is_published);

-- =========================================================
-- 空き状況（個人情報は返さず、残席数だけ返す）
-- =========================================================
create or replace function public.get_availability(p_from date, p_to date)
returns table (day date, part text, start_time time, remaining int, status text)
language sql stable security definer set search_path = public as $$
with s as (select * from public.settings where id = 1),
d as (
  select g::date as day
  from s, generate_series(greatest(p_from, current_date),
                          least(p_to, current_date + s.booking_days),
                          interval '1 day') g
),
sl as (
  select d.day, t.part, t.start_time
  from d cross join public.time_slots t
  where t.active
),
u as (
  select sl.day, sl.part, sl.start_time, coalesce(sum(r.people), 0)::int as used
  from sl
  cross join s
  left join public.reservations r
    on  r.day  = sl.day
    and r.part = sl.part
    and r.status in ('reserved','visited')
    and abs(extract(epoch from (r.start_time - sl.start_time)))
        < 60 * (case when sl.part = 'lunch' then s.lunch_stay_min else s.dinner_stay_min end)
  group by sl.day, sl.part, sl.start_time
),
x as (
  select u.day, u.part, u.start_time,
         (extract(dow from u.day)::int = any (s.closed_weekdays)
           or exists (select 1 from public.closed_days c where c.day = u.day))            as is_closed,
         ((u.day + u.start_time) at time zone 'Asia/Tokyo')
           < now() + make_interval(hours => s.cutoff_hours)                               as is_past,
         greatest(s.capacity - u.used, 0)                                                 as rem,
         s.max_web_people
  from u cross join s
)
select x.day, x.part, x.start_time,
       case when x.is_closed or x.is_past then 0 else x.rem end,
       case when x.is_closed                   then 'closed'
            when x.is_past or x.rem = 0        then 'full'
            when x.rem <= x.max_web_people     then 'few'
            else 'ok' end
from x
order by 1, 2, 3;
$$;

-- =========================================================
-- Web予約の登録（空きを再確認してから登録・同時予約を防止）
-- =========================================================
create or replace function public.create_reservation(
  p_day date, p_part text, p_start_time time, p_people int, p_course text,
  p_name text, p_tel text, p_email text, p_note text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_max    int;
  v_rem    int;
  v_status text;
  v_code   text;
begin
  select max_web_people into v_max from public.settings where id = 1;

  if p_people is null or p_people < 1 or p_people > v_max then
    raise exception 'PEOPLE_LIMIT';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_tel), '') = ''
     or coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(p_name) > 50 or length(p_tel) > 20 or length(p_email) > 100
     or length(coalesce(p_note, '')) > 500 or length(coalesce(p_course, '')) > 50 then
    raise exception 'INVALID_INPUT';
  end if;

  -- 同じ日の予約処理を1件ずつ実行する
  perform pg_advisory_xact_lock(hashtext('reserve:' || p_day::text));

  select a.remaining, a.status into v_rem, v_status
  from public.get_availability(p_day, p_day) a
  where a.part = p_part and a.start_time = p_start_time;

  if v_status is null      then raise exception 'INVALID_SLOT'; end if;
  if v_status = 'closed'   then raise exception 'CLOSED';       end if;
  if v_rem < p_people      then raise exception 'FULL';         end if;

  insert into public.reservations (day, part, start_time, people, course, name, tel, email, note, source)
  values (p_day, p_part, p_start_time, p_people, nullif(trim(p_course), ''),
          trim(p_name), trim(p_tel), trim(p_email), nullif(trim(p_note), ''), 'web')
  returning code into v_code;

  return v_code;
end $$;

-- 実行権限
revoke all on function public.get_availability(date, date) from public;
revoke all on function public.create_reservation(date, text, time, int, text, text, text, text, text) from public;
grant execute on function public.get_availability(date, date) to anon, authenticated;
grant execute on function public.create_reservation(date, text, time, int, text, text, text, text, text) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- 管理画面のリアルタイム更新
alter publication supabase_realtime add table public.reservations;

-- =========================================================
-- 管理者の登録（ダッシュボード → Authentication → Users で
-- ユーザーを作成したあと、そのメールアドレスで1回だけ実行）
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'shop@example.com';
-- =========================================================
