/* =========================================================
   データの出入り口（Supabase／デモを切り替える）
   画面側はこのファイルの関数だけを使う。
   ========================================================= */
import { DEMO, CONFIG as _CFG } from './config.js';
import { supabase } from './supabase.js';
import * as demo from './demo.js';
import { hhmm } from './util.js';

export { DEMO };

const ERROR_TEXT = {
  PEOPLE_LIMIT: 'Webでのご予約は4名様までです。5名様以上はお電話でご予約ください',
  INVALID_INPUT: '入力内容に誤りがあります。お名前・電話番号・メールアドレスをご確認ください',
  INVALID_SLOT: 'この日時はWebでのご予約を受け付けていません',
  CLOSED: 'この日は休業日のため、ご予約を受け付けていません',
  DEADLINE: 'Web予約の受付時間を過ぎました',
  FULL: '申し訳ありません、先ほど満席になりました',
  INVALID_LOGIN: 'メールアドレスまたはパスワードが違います',
  NOT_ADMIN: 'このアカウントには管理画面の権限がありません',
  NOT_FOUND: 'データが見つかりません',
  DUPLICATE: 'すでに登録されています',
  NETWORK: '通信できませんでした。電波の良いところで、もう一度お試しください',
};
/** エラーを日本語に */
export function errorText(e) {
  const code = e?.code && ERROR_TEXT[e.code] ? e.code : Object.keys(ERROR_TEXT).find(k => String(e?.message || '').includes(k));
  if (code) return ERROR_TEXT[code];
  if (/fetch|network/i.test(String(e?.message))) return ERROR_TEXT.NETWORK;
  return 'エラーが発生しました' + (e?.message ? `（${e.message}）` : '');
}
const coded = (e) => {
  const err = new Error(e.message || String(e));
  err.code = Object.keys(ERROR_TEXT).find(k => String(e.message).includes(k)) || e.code;
  return err;
};
const unwrap = ({ data, error }) => { if (error) throw coded(error); return data; };

const normSettings = s => ({
  ...s,
  lunch_slots: (s.lunch_slots || []).map(hhmm),
  dinner_slots: (s.dinner_slots || []).map(hhmm),
});
const normResv = r => ({ ...r, slot: hhmm(r.slot) });

/* ---------- 公開側 ---------- */
let settingsCache = null;
export async function getSettings({ fresh = false } = {}) {
  if (settingsCache && !fresh) return settingsCache;
  settingsCache = DEMO ? await demo.getSettings()
    : normSettings(unwrap(await supabase.from('settings').select('*').eq('id', 1).single()));
  return settingsCache;
}

/** [{ day, service, slot, remaining, is_closed, bookable }] */
export async function getAvailability(from, to) {
  if (DEMO) return demo.getAvailability(from, to);
  const rows = unwrap(await supabase.rpc('get_availability', { p_from: from, p_to: to })) || [];
  return rows.map(r => ({ ...r, slot: r.slot ? hhmm(r.slot) : null }));
}

/** 予約番号を返す */
export async function createReservation(p) {
  if (DEMO) return demo.createReservation(p);
  return unwrap(await supabase.rpc('create_reservation', {
    p_day: p.day, p_service: p.service, p_time: p.time, p_people: p.people, p_course: p.course,
    p_name: p.name, p_tel: p.tel, p_email: p.email, p_note: p.note || '',
  }));
}

export async function listNews(limit) {
  if (DEMO) return demo.listNews(limit);
  let q = supabase.from('news').select('id,published_on,tag,title,body').eq('is_published', true)
    .order('published_on', { ascending: false }).order('id', { ascending: false });
  if (limit) q = q.limit(limit);
  return unwrap(await q);
}

/* ---------- 認証 ---------- */
export async function signIn(email, password) {
  if (DEMO) return demo.signIn(email, password);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { const e = new Error(error.message); e.code = /invalid/i.test(error.message) ? 'INVALID_LOGIN' : undefined; throw e; }
  return data.user;
}
export async function signOut() { return DEMO ? demo.signOut() : supabase.auth.signOut(); }
export async function getSession() {
  if (DEMO) return demo.getSession();
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export async function isAdmin() {
  if (DEMO) return demo.isAdmin();
  return !!unwrap(await supabase.rpc('is_admin'));
}
export async function resetPassword(email, redirectTo) {
  if (DEMO) return demo.resetPassword(email);
  unwrap(await supabase.auth.resetPasswordForEmail(email, { redirectTo }));
}
/* 再設定メールのリンク（?token_hash=...&type=recovery）を確かめてログイン状態にする
   デモでは token_hash=demo のときだけ成功（画面の確認用） */
export async function verifyRecovery(token_hash) {
  if (DEMO) { if (token_hash === 'demo') return; const e = new Error('expired'); e.code = 'LINK_EXPIRED'; throw e; }
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' });
  if (error) { const e = new Error(error.message); e.code = 'LINK_EXPIRED'; throw e; }
}
export async function updatePassword(password) {
  if (DEMO) return;
  unwrap(await supabase.auth.updateUser({ password }));
}

/* ---------- 管理画面 ---------- */
export async function listReservations(from, to) {
  if (DEMO) return demo.listReservations(from, to);
  return unwrap(await supabase.from('reservations').select('*').gte('day', from).lte('day', to)
    .order('day').order('service').order('slot')).map(normResv);
}
export async function getReservation(id) {
  if (DEMO) return demo.getReservation(id);
  return normResv(unwrap(await supabase.from('reservations').select('*').eq('id', id).single()));
}
export async function saveReservation(r) {
  if (DEMO) return demo.saveReservation(r);
  const { id, code, created_at, updated_at, ...body } = r;
  const q = id ? supabase.from('reservations').update(body).eq('id', id) : supabase.from('reservations').insert(body);
  return normResv(unwrap(await q.select().single()));
}
export async function slotRemaining(day, service, slot, excludeId) {
  if (DEMO) return demo.slotRemaining(day, service, slot, excludeId);
  return unwrap(await supabase.rpc('slot_remaining', { p_day: day, p_service: service, p_slot: slot, p_exclude: excludeId || null }));
}

export async function listClosedDays() {
  if (DEMO) return demo.listClosedDays();
  return unwrap(await supabase.from('closed_days').select('*').order('day'));
}
export async function addClosedDay(day, reason) {
  if (DEMO) return demo.addClosedDay(day, reason);
  const { error } = await supabase.from('closed_days').insert({ day, reason: reason || '' });
  if (error) { const e = coded(error); if (error.code === '23505') e.code = 'DUPLICATE'; throw e; }
}
export async function deleteClosedDay(day) {
  if (DEMO) return demo.deleteClosedDay(day);
  unwrap(await supabase.from('closed_days').delete().eq('day', day));
}

export async function listAllNews() {
  if (DEMO) return demo.listAllNews();
  return unwrap(await supabase.from('news').select('*').order('published_on', { ascending: false }).order('id', { ascending: false }));
}
export async function saveNews(n) {
  if (DEMO) return demo.saveNews(n);
  const { id, created_at, updated_at, ...body } = n;
  unwrap(await (id ? supabase.from('news').update(body).eq('id', id) : supabase.from('news').insert(body)));
}
export async function deleteNews(id) {
  if (DEMO) return demo.deleteNews(id);
  unwrap(await supabase.from('news').delete().eq('id', id));
}
export async function saveSettings(v) {
  settingsCache = null;
  if (DEMO) return demo.saveSettings(v);
  const { id, updated_at, ...body } = v;
  unwrap(await supabase.from('settings').update(body).eq('id', 1));
}

/* ---------- 空き状況のまとめ ----------
   日ごと・部ごとに ○△×休－ を決める
   ×：受付中の枠の残席の最大値が 0／△：最大値 ≤ few_threshold／○：それ以外
   休：休業日／past：締切後・期間外（－） */
export function summarize(rows, settings) {
  const few = settings?.few_threshold ?? 3;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.day)) map.set(r.day, { closed: false, lunch: { slots: {} }, dinner: { slots: {} } });
    const d = map.get(r.day);
    if (r.is_closed) { d.closed = true; continue; }
    d[r.service].slots[r.slot] = { remaining: r.remaining, bookable: r.bookable };
  }
  for (const d of map.values()) {
    for (const p of ['lunch', 'dinner']) {
      const sv = d[p];
      if (d.closed) { sv.status = 'closed'; sv.max = 0; continue; }
      const open = Object.values(sv.slots).filter(x => x.bookable);
      sv.max = open.length ? Math.max(...open.map(x => x.remaining)) : 0;
      sv.status = !open.length ? 'past' : sv.max <= 0 ? 'full' : sv.max <= few ? 'few' : 'ok';
    }
  }
  return map;
}
export const MARK = { ok: '○', few: '△', full: '×', closed: '休', past: '－' };
export const WORD = { ok: '空きあり', few: '残りわずか', full: '満席', closed: '休業日', past: '受付外' };

/* ---------- お品書き（menu_items ／ 公開は menu_public） ---------- */
const MENU_COLS = 'id,category,name,subtitle,price,price_note,description,examples,examples_note,image_path,badge,reservable,sort_order';

/** 公開：提供中かつ期間内のもの（区分・並び順） */
export async function listMenu() {
  if (DEMO) return demo.listMenu();
  return unwrap(await supabase.from('menu_public').select(MENU_COLS).order('category').order('sort_order'));
}
/** 管理：すべて */
export async function listAllMenu() {
  if (DEMO) return demo.listAllMenu();
  return unwrap(await supabase.from('menu_items').select('*').order('category').order('sort_order'));
}
export async function saveMenuItem(item) {
  if (DEMO) return demo.saveMenuItem(item);
  const { id, updated_at, ...body } = item;
  const q = id ? supabase.from('menu_items').update(body).eq('id', id) : supabase.from('menu_items').insert(body);
  return unwrap(await q.select().single());
}
export async function deleteMenuItem(id) {
  if (DEMO) return demo.deleteMenuItem(id);
  unwrap(await supabase.from('menu_items').delete().eq('id', id));
}
/** 写真をアップロードして image_path を返す（縮小は呼び出し側で済ませておく） */
export async function uploadMenuImage(blob) {
  if (DEMO) return demo.uploadMenuImage(blob);
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
  unwrap(await supabase.storage.from('menu').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }));
  return path;
}
/** image_path → 表示用 URL（「/」「http」「data:」はそのまま。それ以外は Storage の公開URL） */
export function menuImageUrl(path) {
  if (!path) return '';
  if (/^(\/|https?:|data:)/.test(path)) return path;
  return `${_CFG.SUPABASE_URL}/storage/v1/object/public/menu/${path.split('/').map(encodeURIComponent).join('/')}`;
}
/** 価格の表示：「9,000円（サービス料10%別）」「2,480円（税込）」「＋120円」「価格はお問い合わせください」 */
export function priceText(m, { from = false } = {}) {
  if (m.price == null) return '';
  const yen = m.price.toLocaleString('ja-JP');
  if (m.price_note === '＋' || m.price_note === '+') return `＋${yen}円`;
  return `${yen}円${from ? '〜' : ''}`;
}
export const priceNote = m => (m.price != null && m.price_note && !['＋', '+'].includes(m.price_note) ? m.price_note : '');
export const MENU_CATEGORY = { dinner: '夜のコース', lunch: 'お昼の定食', option: 'お昼のお得なセット・オプション', drink: 'お飲み物' };
/** 予約フォームのコースの選択肢（夜：reservable なもの＋当日決める／昼：当日決める） */
export async function courseOptions(service) {
  const base = ['当日決める'];
  if (service !== 'dinner') return base;
  try {
    const m = await listMenu();
    return [...m.filter(x => x.category === 'dinner' && x.reservable).map(x => x.name), ...base];
  } catch { return base; }
}
