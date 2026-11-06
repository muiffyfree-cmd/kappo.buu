/* 共通の小さな関数 */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const DOW = ['日', '月', '火', '水', '木', '金', '土'];
export const PART = { lunch: '昼', dinner: '夜' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return ymd(d); };
export const jpDate = k => { const d = parseDay(k); return `${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）`; };
export const dotDate = k => k.replace(/-/g, '.');
export const hhmm = t => (t || '').slice(0, 5);
export const todayKey = () => ymd(new Date());
