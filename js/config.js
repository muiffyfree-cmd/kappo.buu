/* =========================================================
   サイトの設定
   Supabase の接続先は .env（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。
   未設定ならデモモード（ダミーデータで最後まで動く）。
   ========================================================= */
export const CONFIG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || '',

  SHOP_NAME: '割烹 舞ぅ',
  TEL: '095-823-8510',
  TEL_HOURS: '10:00–22:00（日曜休）',   // TODO 電話の受付時間は仮
  INSTAGRAM: 'https://www.instagram.com/kappou_buu/',
  MONTHS_AHEAD: 2,                       // 公開カレンダーで表示する月数

  // TODO キャンセル規定は仮
  CANCEL_POLICY: ['前日のキャンセル：コース料金の50%', '当日のキャンセル・連絡なし：コース料金の100%'],
  // コース名・価格は Supabase の menu_items（管理画面の「お品書き」）で管理する
};

export const DEMO = !(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
