-- =========================================================
-- 確認用（何も変更しない）。01・02 のあとに Run して結果を見る
-- =========================================================
select '① お品書き（全部）' as 確認, count(*)::text as 結果 from public.menu_items                              -- 9
union all select '② サイトに出る品', string_agg(name, '、' order by category, sort_order) from public.menu_public   -- 味彩御膳が入っていない
union all select '③ 写真の保存先', coalesce((select 'menu（公開=' || public || '）' from storage.buckets where id = 'menu'), 'なし')
union all select '④ 管理者の人数', count(*)::text from public.admin_users                                            -- 1以上
union all select '⑤ 席数・定休曜日', capacity || '席・' || closed_dows::text from public.settings                    -- 17席・{0}
union all select '⑥ RLS が無効の表', coalesce(string_agg(relname, '、'), 'なし（OK）')
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity
union all select '⑦ 今日から3日分の空き', count(*)::text || '枠'
  from public.get_availability((now() at time zone 'Asia/Tokyo')::date, (now() at time zone 'Asia/Tokyo')::date + 2);
