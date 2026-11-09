/* =========================================================
   管理画面の共通処理
   - 全ページの先頭で guard()：未ログイン → login.html、管理者でない → ログアウトして login.html
   ========================================================= */
import { $, $$, hhmm } from '../util.js';
import { DEMO, getSession, isAdmin, signOut } from '../api.js';

export const STATUS = { booked: '予約', visited: '来店済', cancelled: 'キャンセル', no_show: '無断キャンセル' };
export const SOURCE = { web: 'Web', phone: '電話', dm: 'Instagram DM', walkin: '来店', other: 'その他' };
export const MAIL_STATUS = { sending: '送信中', sent: '送信済み', failed: '失敗' };
export const MAIL_TEMPLATE = { customer_confirmed: '予約完了', customer_cancelled: 'キャンセル完了', shop_new: '店への通知' };
export const ACTIVE = s => s === 'booked' || s === 'visited';

/** ログインと権限を確認してからページを表示する */
export async function guard(navKey) {
  const back = encodeURIComponent(location.pathname + location.search);
  const session = await getSession().catch(() => null);
  if (!session) { location.replace(`/admin/login.html?next=${back}`); return new Promise(() => {}); }
  const ok = await isAdmin().catch(() => false);
  if (!ok) { await signOut(); location.replace('/admin/login.html?denied=1'); return new Promise(() => {}); }

  $('#demoBadge').hidden = !DEMO;
  $$('.a-nav a').forEach(a => { if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); });
  $('#logoutBtn').addEventListener('click', async () => { await signOut(); location.replace('/admin/login.html'); });
  $('#main').hidden = false;
  const pending = sessionStorage.getItem('buu-toast');
  if (pending) { sessionStorage.removeItem('buu-toast'); setTimeout(() => toast(pending), 100); }
  return session;
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
}

/* 予約の配列から残席を計算（SQL の _remaining と同じ考え方） */
const toMin = t => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m; };
export function remainingOf(resvs, settings, day, service, slot) {
  const stay = service === 'lunch' ? settings.lunch_stay_min : settings.dinner_stay_min;
  const p = toMin(slot);
  const used = resvs.filter(r => r.day === day && r.service === service && ACTIVE(r.status))
    .filter(r => { const q = toMin(r.slot); return q < p + stay && p < q + stay; })
    .reduce((a, r) => a + r.people, 0);
  return settings.capacity - used;
}
/** その部の「いちばん空いている枠」の残席 */
export function maxRemaining(resvs, settings, day, service) {
  const slots = settings[service + '_slots'];
  return slots.length ? Math.max(...slots.map(s => remainingOf(resvs, settings, day, service, s))) : 0;
}
export const isClosedDay = (settings, closedDays, day) => {
  const [y, m, d] = day.split('-').map(Number);
  return settings.closed_dows.includes(new Date(y, m - 1, d).getDay()) || closedDays.some(c => c.day === day);
};
