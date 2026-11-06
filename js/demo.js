/* =========================================================
   デモ用のデータ置き場（.env 未設定のとき）
   supabase/migrations/0001_init.sql と同じ計算・同じエラーを返す。
   localStorage に保存するので、管理画面での変更が公開側のカレンダーにも反映される。
   ========================================================= */
import { addDays, parseDay, todayKey } from './util.js';

const KEY = 'buu-demo-v4';
const SESSION = 'buu-demo-session';
// デモのログイン情報（login.html に表示する）
export const DEMO_USERS = [
  { email: 'demo@kappo-buu.jp', password: 'demo1234', admin: true },
  { email: 'guest@kappo-buu.jp', password: 'guest1234', admin: false },
];

/* お品書きの初期データ（supabase/migrations/0002_menu.sql と同じ） */
const M = (category, name, subtitle, price, price_note, description, examples, examples_note, badge, is_available, available_from, reservable, sort_order, image_path = null) =>
  ({ id: uid(), category, name, subtitle, price, price_note, description, examples, examples_note, badge, is_available, available_from, available_until: null, reservable, sort_order, image_path });
const seedMenu = () => [
  M('dinner', '花麗', '11品', 9000, 'サービス料10%別', null, [], null, null, true, null, true, 10),
  M('dinner', 'せせらぎ', '9品', 7500, 'サービス料10%別', null, [], null, null, true, null, true, 20),
  M('dinner', 'しゃぶしゃぶコース', null, null, null, 'こだわりの薬味とともに', [], null, null, true, null, true, 30, '/assets/img/shabushabu.jpg'),
  M('lunch', '舞ぅのおでんくん', null, 2480, '税込', '季節のおでん、季節の鮮魚、ご飯、〆豆めし', [], null, '冬季限定', true, '2026-11-05', false, 10),
  M('lunch', '舞ぅのたまて箱', null, 2480, '税込', '御飯、お味噌汁、お出汁、香の物',
    ['茶碗蒸し', '旬のお造り2種', '鯛の胡麻掛け', '絶品豚の角煮', '鮮魚のあら炊き', '小松菜と海老のお浸し'], '以下メニューは半月に一度変更（例）', null, true, null, false, 20),
  M('lunch', '舞ぅの味彩御膳', null, 2280, '税込', '御飯、お味噌汁、香の物',
    ['茶碗蒸し', '銀鱈の塩麹蒸し', '鶏のきゃべつ蒸し', '季節の野菜4種', '巾着ハンバーグの和出汁煮', '酔っ払い海老'], '以下メニューは半月に一度変更（例）', null, false, null, false, 30),
  M('option', 'ご飯大盛り', 'お昼のお得なセット', 120, '＋', null, [], null, null, true, null, false, 10),
  M('option', '自家製甘味＋お飲物', 'お昼のお得なセット', 500, '＋', 'コーヒー／烏龍茶／オレンジジュース／コーラ／炭酸水', [], null, null, true, null, false, 20),
  M('option', '記念日プレート（お花付き）', '昼・夜とも記念日のお祝い承ります', 700, '＋', null, [], null, null, true, null, false, 30),
];

const DEFAULT_SETTINGS = {
  capacity: 17, max_web_people: 4, closed_dows: [0],
  lunch_slots: ['11:00', '11:30', '12:00', '12:30', '13:00'],
  dinner_slots: ['18:00', '18:30', '19:00', '19:30', '20:00'],
  lunch_stay_min: 90, dinner_stay_min: 150, cutoff_hours: 3, booking_days: 60, few_threshold: 3,
  menu_note: '※ 昼・夜・甘味メニューは仕入れ状況によりお品書きを変更する場合がございます。',
  course_service_note: 'コース料理はコース金額の10%のサービス料金を頂戴します。',
};

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));
const nowIso = () => new Date().toISOString();
function genCode() {
  const c = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const d = new Date();
  let s = '';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  return `B${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${s}`;
}
const fail = code => { const e = new Error(code); e.code = code; throw e; };
const wait = (ms = 250) => new Promise(r => setTimeout(r, ms));

/* ---------- 初期データ ---------- */
function seed() {
  const NAMES = ['山田', '佐藤', '田中', '中村', '小林', '松尾', '林', '井上', '森', '池田', '前田', '岩永'];
  const SRC = ['web', 'phone', 'web', 'dm', 'phone'];
  const t = todayKey();
  const reservations = [];
  let n = 0;
  const add = (day, service, slot, people) => {
    const nm = NAMES[n % NAMES.length];
    reservations.push({
      id: uid(), code: genCode(), day, service, slot, people,
      course: service === 'lunch' ? '当日決める' : ['花麗', 'せせらぎ', 'しゃぶしゃぶコース'][n % 3],
      name: `${nm} ${['太郎', '花子', '一郎', '美咲'][n % 4]}`, tel: `090-${String(1000 + n * 37).slice(-4)}-${String(5000 + n * 91).slice(-4)}`,
      email: n % 4 === 1 ? '' : `guest${n}@example.com`, note: n % 5 === 0 ? 'えびアレルギーがあります' : '',
      status: 'booked', source: SRC[n % SRC.length], staff_memo: '', created_at: nowIso(), updated_at: nowIso(),
    });
    n++;
  };
  // 臨時休業（3週間ほど先の水曜）
  const closed_days = [{ day: addDays(t, 17 + ((7 - parseDay(addDays(t, 17)).getDay() + 3) % 7)), reason: '仕入れのため', created_at: nowIso() }];
  for (let i = 0; i < 62; i++) {
    const day = addDays(t, i);
    if (parseDay(day).getDay() === 0 || closed_days.some(c => c.day === day)) continue;
    // 夜：日によって 0〜17 席を埋める（i%9==4 は満席）
    let din = i % 9 === 4 ? 17 : (i * 7) % 19;
    if (i % 5 === 2) din = Math.max(din, 14);                       // 残りわずかの日
    const dSlots = ['18:00', '18:30', '19:00', '19:30'];
    for (let k = 0; din > 0; k++) { const p = Math.min(din, 2 + (k % 3)); add(day, 'dinner', dSlots[k % dSlots.length], p); din -= p; }
    // 昼
    let lun = i % 11 === 6 ? 17 : (i * 5) % 13;
    for (let k = 0; lun > 0; k++) { const p = Math.min(lun, 1 + (k % 4)); add(day, 'lunch', ['11:00', '11:30', '12:00'][k % 3], p); lun -= p; }
  }
  const news = [
    { id: 3, published_on: t, tag: 'お知らせ', title: 'Webからのご予約を始めました', body: '空き状況の確認とご予約が、24時間Webからできるようになりました。\n5名様以上・貸切はお電話でご相談ください。', is_published: true },
    { id: 2, published_on: addDays(t, -6), tag: 'メニュー', title: '冬季限定「舞ぅのおでんくん」はじめます', body: '11月5日のランチより、冬季限定の「舞ぅのおでんくん」をご案内します。\n※ 期間中、舞ぅの味彩御膳はお休みです。', is_published: true },
    { id: 1, published_on: addDays(t, -20), tag: '休業', title: '臨時休業のお知らせ', body: '仕入れのため、臨時休業をいただく日があります。空き状況のカレンダーでご確認ください。', is_published: true },
    { id: 4, published_on: addDays(t, 1), tag: 'お知らせ', title: '（下書き）年末年始の営業について', body: '', is_published: false },
  ];
  return { settings: { ...DEFAULT_SETTINGS }, closed_days, reservations, news, newsSeq: 5, menu: seedMenu(), seededOn: t };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings) return s;
  } catch { /* 壊れていたら作り直す */ }
  const s = seed();
  save(s);
  return s;
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 容量オーバーなどは無視 */ } }
export function resetDemo() { localStorage.removeItem(KEY); }

/* ---------- 空き計算（SQL の _is_closed / _remaining と同じ） ---------- */
function isClosed(s, day) {
  return s.settings.closed_dows.includes(parseDay(day).getDay()) || s.closed_days.some(c => c.day === day);
}
function remaining(s, day, service, slot, exclude = null) {
  const stay = service === 'lunch' ? s.settings.lunch_stay_min : s.settings.dinner_stay_min;
  const p = toMin(slot);
  const used = s.reservations
    .filter(r => r.day === day && r.service === service && (r.status === 'booked' || r.status === 'visited') && r.id !== exclude)
    .filter(r => { const q = toMin(r.slot); return q < p + stay && p < q + stay; })
    .reduce((a, r) => a + r.people, 0);
  return s.settings.capacity - used;
}
const bookableAt = (s, day, slot) => new Date(`${day}T${slot}:00`).getTime() - s.settings.cutoff_hours * 3600e3 > Date.now();

/* ---------- 公開側 ---------- */
export async function getSettings() { return structuredClone(load().settings); }

export async function getAvailability(from, to) {
  const s = load();
  const today = todayKey();
  const f = from > today ? from : today;
  const maxTo = addDays(today, s.settings.booking_days);
  const t = to < maxTo ? to : maxTo;
  const rows = [];
  for (let d = f; d <= t; d = addDays(d, 1)) {
    if (isClosed(s, d)) { rows.push({ day: d, service: null, slot: null, remaining: 0, is_closed: true, bookable: false }); continue; }
    for (const service of ['lunch', 'dinner']) {
      for (const slot of s.settings[service + '_slots']) {
        rows.push({ day: d, service, slot, remaining: Math.max(0, remaining(s, d, service, slot)), is_closed: false, bookable: bookableAt(s, d, slot) });
      }
    }
  }
  return rows;
}

export async function createReservation(p) {
  await wait(500);
  const s = load();
  const st = s.settings;
  const today = todayKey();
  if (!(p.people >= 1 && p.people <= st.max_web_people)) fail('PEOPLE_LIMIT');
  if (!String(p.name || '').trim() || String(p.name).length > 100
    || !/^[0-9０-９+()（） \-－ー]{10,20}$/.test(p.tel || '')
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email || '') || (p.note || '').length > 1000) fail('INVALID_INPUT');
  if (!p.day || !['lunch', 'dinner'].includes(p.service) || !st[p.service + '_slots'].includes(p.time)
    || p.day < today || p.day > addDays(today, st.booking_days)) fail('INVALID_SLOT');
  if (isClosed(s, p.day)) fail('CLOSED');
  if (!bookableAt(s, p.day, p.time)) fail('DEADLINE');
  if (remaining(s, p.day, p.service, p.time) < p.people) fail('FULL');
  const r = {
    id: uid(), code: genCode(), day: p.day, service: p.service, slot: p.time, people: p.people,
    course: p.course || '', name: p.name.trim(), tel: p.tel.trim(), email: p.email.trim(), note: (p.note || '').trim(),
    status: 'booked', source: 'web', staff_memo: '', created_at: nowIso(), updated_at: nowIso(),
  };
  s.reservations.push(r);
  save(s);
  return r.code;
}

export async function listNews(limit) {
  const items = load().news.filter(n => n.is_published).sort((a, b) => b.published_on.localeCompare(a.published_on) || b.id - a.id);
  return limit ? items.slice(0, limit) : items;
}

/* ---------- 認証 ---------- */
export async function signIn(email, password) {
  await wait(300);
  const u = DEMO_USERS.find(x => x.email === String(email).trim().toLowerCase() && x.password === password);
  if (!u) fail('INVALID_LOGIN');
  sessionStorage.setItem(SESSION, JSON.stringify({ email: u.email, admin: u.admin }));
  return { email: u.email };
}
export async function signOut() { sessionStorage.removeItem(SESSION); }
export async function getSession() {
  try { const s = JSON.parse(sessionStorage.getItem(SESSION)); return s ? { user: { email: s.email } } : null; } catch { return null; }
}
export async function isAdmin() {
  try { return !!JSON.parse(sessionStorage.getItem(SESSION))?.admin; } catch { return false; }
}
export async function resetPassword() { await wait(300); }

/* ---------- 管理画面 ---------- */
export async function listReservations(from, to) {
  return load().reservations.filter(r => r.day >= from && r.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day) || a.service.localeCompare(b.service) || a.slot.localeCompare(b.slot));
}
export async function getReservation(id) {
  const r = load().reservations.find(x => x.id === id);
  if (!r) fail('NOT_FOUND');
  return r;
}
export async function saveReservation(data) {
  const s = load();
  let r;
  if (data.id) {
    r = s.reservations.find(x => x.id === data.id);
    if (!r) fail('NOT_FOUND');
    Object.assign(r, data, { updated_at: nowIso() });
  } else {
    r = { id: uid(), code: genCode(), status: 'booked', staff_memo: '', created_at: nowIso(), updated_at: nowIso(), ...data };
    s.reservations.push(r);
  }
  save(s);
  return r;
}
export async function slotRemaining(day, service, slot, exclude) { return remaining(load(), day, service, slot, exclude || null); }

export async function listClosedDays() { return load().closed_days.slice().sort((a, b) => a.day.localeCompare(b.day)); }
export async function addClosedDay(day, reason) {
  const s = load();
  if (s.closed_days.some(c => c.day === day)) fail('DUPLICATE');
  s.closed_days.push({ day, reason: reason || '', created_at: nowIso() });
  save(s);
}
export async function deleteClosedDay(day) { const s = load(); s.closed_days = s.closed_days.filter(c => c.day !== day); save(s); }

export async function listAllNews() { return load().news.slice().sort((a, b) => b.published_on.localeCompare(a.published_on) || b.id - a.id); }
export async function saveNews(n) {
  const s = load();
  if (n.id) Object.assign(s.news.find(x => x.id === n.id) || {}, n);
  else s.news.push({ ...n, id: s.newsSeq++ });
  save(s);
}
export async function deleteNews(id) { const s = load(); s.news = s.news.filter(n => n.id !== id); save(s); }
export async function saveSettings(v) { const s = load(); s.settings = { ...s.settings, ...v }; save(s); }


/* ---------- お品書き ---------- */
const inPeriod = m => { const t = todayKey(); return (!m.available_from || m.available_from <= t) && (!m.available_until || m.available_until >= t); };
const byOrder = (a, b) => a.category.localeCompare(b.category) || a.sort_order - b.sort_order;
/** menu_public と同じ：提供中かつ期間内のもの */
export async function listMenu() { return load().menu.filter(m => m.is_available && inPeriod(m)).sort(byOrder).map(m => structuredClone(m)); }
export async function listAllMenu() { return load().menu.slice().sort(byOrder).map(m => structuredClone(m)); }
export async function saveMenuItem(item) {
  const s = load();
  let m;
  if (item.id) { m = s.menu.find(x => x.id === item.id); if (!m) fail('NOT_FOUND'); Object.assign(m, item); }
  else { m = { id: uid(), examples: [], is_available: true, reservable: false, sort_order: 100, ...item }; s.menu.push(m); }
  save(s);
  return structuredClone(m);
}
export async function deleteMenuItem(id) { const s = load(); s.menu = s.menu.filter(m => m.id !== id); save(s); }
/** デモでは画像を data URL のまま保存する（本番は Storage） */
export async function uploadMenuImage(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
