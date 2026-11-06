-- =========================================================
-- 管理者の登録（01_setup.sql のあと）
--   先に Authentication → Users → Add user で店のユーザーを作っておく
--   下の 'shop@example.com' を、そのユーザーのメールアドレスに書き換えて Run
-- =========================================================
insert into public.admin_users (user_id)
select id from auth.users where email = 'shop@example.com'
on conflict (user_id) do nothing
returning user_id;   -- 1行出れば登録成功。0行ならメールアドレスが違う（Users の一覧と見比べる）

-- 登録されている管理者の一覧
select u.email, a.created_at
from public.admin_users a join auth.users u on u.id = a.user_id
order by a.created_at;

-- 管理者から外すとき（ユーザー自体は残る）
-- delete from public.admin_users where user_id = (select id from auth.users where email = 'shop@example.com');
