# 割烹 舞ぅ 公式サイト＋予約管理（v2.2）

## 起動

```bash
npm install
cp .env.example .env      # Supabase につなぐときだけ。空のままならデモモード
npm run dev               # → http://localhost:3100（ポート固定）
```

### デモモード（`.env` が未設定のとき）
- 空き状況・予約・お知らせ・お品書きはブラウザの localStorage に入ったダミーデータで動きます（`js/demo.js`。計算とエラーは SQL と同じ）
- 管理画面のログイン：管理者 `demo@kappo-buu.jp` / `demo1234`、権限なしの確認用 `guest@kappo-buu.jp` / `guest1234`
- 管理画面で登録・キャンセルした予約は、同じブラウザの公開カレンダーに反映されます
- データを初期化したいときは、開発者ツールで `localStorage.removeItem('buu-demo-v4')`
- デモでお品書きに入れた写真は縮小した画像をそのまま localStorage に保存します（容量に限りがあるため数枚程度まで）

## Supabase の設定

| # | 作業 |
|---|---|
| 1 | `supabase/migrations/0001_init.sql` → `0002_menu.sql` の順に適用（`supabase db push`、または SQL Editor に貼り付け）。0002 でお品書きの表・`menu_public` ビュー・Storage の `menu` バケット（公開読み取り・管理者だけ書き込み）が作られ、初期のお品書きが入ります |
| 2 | Authentication → Providers で Email を有効化し、**Sign up（新規登録）を無効化** |
| 3 | Authentication → Users から店のユーザーを招待 → SQL Editor で `insert into admin_users(user_id) values ('<ユーザーのuuid>');` |
| 4 | Authentication → URL Configuration の Redirect URLs に `http://localhost:3100/admin/reset-password.html` と `https://<ドメイン>/admin/reset-password.html` を追加。Email Templates の「Reset Password」のリンクを `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` にする（パスワード再設定用） |
| 5 | `supabase functions deploy reservation-mail --no-verify-jwt` |
| 6 | `supabase secrets set RESEND_API_KEY=... MAIL_FROM="割烹 舞ぅ <yoyaku@ドメイン>" SHOP_EMAIL=... SHOP_TEL=095-823-8510 WEBHOOK_SECRET=<長いランダム文字列>` |
| 7 | Database → Webhooks：`reservations` の INSERT → Edge Function `reservation-mail`、HTTP ヘッダー `x-webhook-secret` に 6 と同じ値 |
| 8 | `.env` に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY`（anon キー）を書く。**service_role キーは書かない** |

- 公開側は RPC（`get_availability` / `create_reservation`）だけを使い、予約テーブルは読めません（RLS）
- 予約・休業日・お知らせ・お品書き・設定は Table Editor から直接編集しても、そのまま画面に反映されます
- メールは、お客様にはメールアドレスがある予約すべて、店には Web 予約のときに送ります

### お品書き（管理画面 → お品書き）
- 区分ごとの一覧で ↑↓ の並べ替え、「お休みに／提供する」の切り替え、編集・追加・削除ができます。保存するとすぐトップと menu.html に反映されます
- 公開側は `menu_public`（提供中かつ期間内のものだけ）を読みます。味彩御膳は初期状態でお休み（おでんくんの期間が終わったら「提供する」に）
- 写真は長辺1600pxに縮小して Storage の `menu` バケットへ。`image_path` が `/` で始まるものはサイト内の画像（`/assets/img/...`）として扱います
- 「予約フォームのコースに出す」にした夜のコースが、予約フォームのコース選択肢になります（＋「当日決める」）。昼は「当日決める」のみ
- 夜のコースの下の注記（`settings.course_service_note`）と最後の共通の注記（`settings.menu_note`）も同じ画面で編集します

### 残席の計算
`settings.capacity`（17席）から、その時間と**滞在時間が重なる**予約（予約中・来店済）の人数を引いたもの。初期値の滞在時間は昼 90 分・夜 150 分なので、夜は実質「1晩17席」の計算になります。カレンダーの記号は、その部の受付中の時間枠のうち**いちばん空いている枠**の残席で決めます（0 → ×、3以下 → △、それ以外 → ○、締切後・期間外 → －）。

## 仮ドメインで公開する間（Google の検索に出さない）

| 仕組み | 場所 | 内容 |
|---|---|---|
| `<meta name="robots" content="noindex, nofollow">` | `vite.config.js`（ビルド時に全ページへ入れる） | 環境変数 **`VITE_NOINDEX=true`** のときだけ。`.env` かホスティングの環境変数に設定してビルドする |
| `X-Robots-Tag: noindex, nofollow` | `public/_headers`（Cloudflare Pages / Netlify）、`vercel.json`（Vercel） | 全ページ・全ファイルに付く。使うホスティングの方だけ効く（もう片方は無視される） |
| `robots.txt` | `public/robots.txt` | **Disallow しない**（クロールを止めると noindex が読まれず、URL だけ検索に出ることがあるため）。`sitemap.xml` も出さない |

- 管理画面（`/admin/`）は `VITE_NOINDEX` に関係なく、いつも noindex です
- すでに検索に出てしまった場合は、Google Search Console の「削除」で一時的に隠せます

### 本番公開時
1. **`VITE_NOINDEX=false` にする**（ホスティングの環境変数を変えて、ビルドし直す）
2. **`public/_headers` の X-Robots-Tag を削除する**（Vercel の場合は `vercel.json` の `headers` を削除）
3. 必要なら `sitemap.xml` を追加し、`robots.txt` に `Sitemap: https://<ドメイン>/sitemap.xml` を書く
4. 公開後、ページのソースに noindex がないこと、`curl -I https://<ドメイン>/` に `X-Robots-Tag` が出ないことを確認する

## ファイル

| ファイル | 内容 |
|---|---|
| `index.html` `news.html` `concept.html` `menu.html` `reserve.html` `privacy.html` | 公開ページ |
| `admin/*.html` | 管理画面（login／今日・明日／カレンダー／予約の詳細・登録／臨時休業／お品書き／お知らせ／設定） |
| `partials/*.html` | 共通のヘッダー・フッター。`<!-- @include header -->` を `vite.config.js` のプラグインが差し込む（出力は静的 HTML） |
| `css/style.css` / `css/admin.css` | 公開側（`reference/buu-design.css` v2 ＋ `backgrounds.css`（生成り＋金の粒／和紙＋金箔）＋ `concept-section.css` ＋ページ固有）／管理画面 |
| `js/menu-render.js` | お品書きの HTML（トップの要約カードと menu.html の3区分） |
| `js/api.js` | データの出入り口（Supabase ／デモを切り替え）。エラーコード → 日本語 |
| `js/config.js` | 電話番号・受付時間・キャンセル規定など（コースは `menu_items` で管理） |
| `supabase/migrations/0001_init.sql` | テーブル・RLS・関数（予約まわり） |
| `supabase/migrations/0002_menu.sql` | お品書き・`menu_public`・Storage `menu` |
| `supabase/functions/reservation-mail/index.ts` | 確認メール（Resend） |
| `reference/` | デザインの元（`concept-section.*` `backgrounds.css` など）。`reference/zip-v2.2/` は zip に入っていたが採用しなかった `0001_init.sql` と `reservation-mail`（下記）。`reference/v1/` は v1 の指示書と GAS |

### zip の `0001_init.sql` を使っていない理由
zip の 0001 は列名（`start_time`・`seats_total`）や状態名が違い、`slot_remaining` に実行権限がない（管理画面の満席チェックが失敗する）・`bookable`（締切）を返さない・締切後の予約を止めない、という違いがあったため、テスト済みの 0001 をそのまま使い、その上に zip の 0002 を適用しています（0002 は `settings`・`is_admin()`・`touch_updated_at()` だけに依存）。指示書の「PostgreSQL 16 で動作確認済み」に対し、こちらは PGlite（PostgreSQL 18）で確認しています。

## 確認したこと（2026-11-05）

### v2.2
- SQL：0001＋0002 を PGlite で適用。anon は `menu_public` を読める（味彩御膳は出ない）・`menu_items` に書けない、管理者は編集でき公開側に反映される
- 画面：背景（お知らせ・こだわり・空き状況＝生成り＋金の粒／ご挨拶・お品書き・店舗情報・menu.html 本文＝和紙＋金箔）、金色がボタン・リンクに使われていないこと、こだわりの曲線が `non-scaling-stroke`、トップのカード（9,000円〜 など）、menu.html の3区分、管理画面で味彩を提供・おでんくんをお休み・花麗の価格変更・並べ替え → トップと menu.html と予約フォームのコースに反映、を Playwright で確認（55項目すべて通過）

### v2

- `npm run build` が通る
- SQL：PGlite（PostgreSQL 18 の WASM 版）＋ Supabase の `auth` を模したスキーマで、予約登録・各エラー（PEOPLE_LIMIT / INVALID_INPUT / INVALID_SLOT / CLOSED / DEADLINE / FULL）・RLS（anon は予約を読めない／管理者以外は0件）・キャンセルで残席が戻る・臨時休業を確認
- 画面：Playwright（Chrome）で PC 1280px／スマホ 390px のスクショ、コンソールエラーなし、白黒グレー以外の色がないこと、4つの「詳細はこちらから」の遷移、デモでの予約完了・満席エラー表示・5名以上は電話・日曜/満席は選べない・未ログイン/権限なしの締め出し・電話予約の登録とキャンセルで公開側の残席が変わる、を確認
- **未確認**：実際の Supabase プロジェクトへの接続、Edge Function と Resend でのメール送信（接続先がないため）。Figma（MCP の利用上限で読めなかったため、指示書の文面どおりに実装）

## TODO（未確定の情報）

| 項目 | 場所 | 今の仮の値 |
|---|---|---|
| しゃぶしゃぶコースの価格 | 管理画面 → お品書き | 未入力（「価格はお問い合わせください」と表示） |
| 夜のコースは税込か税別か | 管理画面 → お品書き（価格の注記） | 「サービス料10%別」とだけ表示 |
| サービス料 | 管理画面 → お品書き（共通の注記） | コースのみ10%（v2 の「なし」を訂正済み） |
| お品書きの写真 | 管理画面 → お品書き | しゃぶしゃぶコース以外は写真なし |
| 17席の内訳 | `index.html` `concept.html` | 未記載（計算も合計17席で行う） |
| 電話の受付時間 | `js/config.js` `partials/header.html` | 10:00–22:00（日曜休） |
| キャンセル規定 | `js/config.js` `reserve.html` `reservation-mail/index.ts` | 前日50%／当日100% |
| ご挨拶文・店主名 | `index.html` | 試作の文章・「〇〇 〇〇」 |
| こだわりの本文 | `concept.html` | 仮の文章 |
| 店内・カウンターの写真 | `concept.html`（其の三は今は外観） | 外観写真・「写真準備中」の枠 |
| 写真の差し替え | `assets/img/` | Instagram のスクショ（同じファイル名で元データに） |
| 独自ドメイン | `index.html`（canonical・og:url・og:image を絶対URLに）、Resend の送信元 | 未定 |
| 個人情報の保管期間 | `privacy.html` | ご来店日から1年 |
| プライバシーポリシーの制定日 | `privacy.html` | 2026年11月1日 |
| 開店日 | — | 看板と投稿で日付が違うため載せない |
