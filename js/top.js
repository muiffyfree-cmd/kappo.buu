/* トップページ：お知らせ3件・今月の空き状況（表示のみ） */
import { CONFIG } from './config.js';
import { $, $$, ymd, esc, dotDate } from './util.js';
import { DEMO, listNews, listMenu, getAvailability, getSettings, summarize } from './api.js';
import { topCardsHtml } from './menu-render.js';
import { monthHtml } from './calendar.js';

const telLink = `<a href="tel:${CONFIG.TEL.replace(/-/g, '')}">${CONFIG.TEL}</a>`;

/* ---------- お知らせ（最新3件） ---------- */
const newsList = $('#newsList');
listNews(3).then(items => {
  newsList.innerHTML = items.length
    ? items.map(n => `<li><a class="news-row" href="/news.html#n${n.id}" style="text-decoration:none">
        <time datetime="${n.published_on}">${dotDate(n.published_on)}</time>
        <span><span class="tag">${esc(n.tag)}</span></span>
        <span class="ttl">${esc(n.title)}</span></a></li>`).join('')
    : '<li class="news-empty">現在お知らせはありません。</li>';
}).catch(() => {
  newsList.innerHTML = `<li class="news-empty">お知らせを読み込めませんでした。最新情報は <a href="${CONFIG.INSTAGRAM}" target="_blank" rel="noopener">Instagram</a> をご覧ください。</li>`;
}).finally(() => newsList.removeAttribute('aria-busy'));

/* ---------- お品書き（夜のコース2つ＋昼の定食2つ） ---------- */
const topMenu = $('#topMenu');
async function loadMenu() {
  try {
    const [items, s] = await Promise.all([listMenu(), getSettings({ fresh: true })]);
    topMenu.innerHTML = topCardsHtml(items);
    $('#topMenuNote').textContent = s.menu_note || '';
  } catch {
    topMenu.innerHTML = '<p class="mcards-empty">お品書きを読み込めませんでした。</p>';
  } finally { topMenu.removeAttribute('aria-busy'); }
}
loadMenu();

/* ---------- 今月の空き状況 ---------- */
let part = 'dinner';
let summary = null;
const now = new Date();
const y = now.getFullYear(), m = now.getMonth();

function render() {
  $('#calTitle').textContent = `${y}年${m + 1}月`;
  $('#cal').innerHTML = monthHtml({ year: y, month: m, summary, part, mode: 'link' });
  $('#calMsg').textContent = `○△の日付を押すと、${part === 'lunch' ? '昼' : '夜'}の時間を選べます`;
}
$$('#partSwitch button').forEach(b => b.addEventListener('click', () => {
  part = b.dataset.part;
  $$('#partSwitch button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  if (summary) render();
}));

async function load() {
  try {
    const [rows, s] = await Promise.all([getAvailability(ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))), getSettings()]);
    summary = summarize(rows, s);
    $('#demoFlag').hidden = !DEMO;
    render();
  } catch {
    $('#calMsg').innerHTML = `空き状況を読み込めませんでした。お電話（${telLink}）でお問い合わせください。`;
  }
}
load();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { load(); loadMenu(); } });
