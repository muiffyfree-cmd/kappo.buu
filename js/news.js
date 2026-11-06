/* news.html：全件（新しい順）・タグで絞り込み・本文は開閉式 */
import { CONFIG } from './config.js';
import { $, $$, esc, dotDate } from './util.js';
import { listNews } from './api.js';

const list = $('#newsAll');
const filter = $('#filter');
let items = [];
let tag = '';

function render() {
  const shown = tag ? items.filter(n => n.tag === tag) : items;
  list.innerHTML = shown.length
    ? shown.map(n => `<li id="n${n.id}"><details${location.hash === '#n' + n.id ? ' open' : ''}>
        <summary class="news-row"><time datetime="${n.published_on}">${dotDate(n.published_on)}</time>
          <span><span class="tag">${esc(n.tag)}</span></span><span class="ttl">${esc(n.title)}</span></summary>
        <div class="news-body">${esc(n.body || '詳しくはお電話でお問い合わせください。')}</div></details></li>`).join('')
    : '<li class="news-empty">該当するお知らせはありません。</li>';
}

function renderFilter() {
  const tags = [...new Set(items.map(n => n.tag))];
  if (tags.length < 2) { filter.hidden = true; return; }
  filter.innerHTML = ['', ...tags].map(t => `<button type="button" data-tag="${esc(t)}" aria-pressed="${t === tag}">${esc(t || 'すべて')}</button>`).join('');
  $$('button', filter).forEach(b => b.addEventListener('click', () => {
    tag = b.dataset.tag;
    $$('button', filter).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }));
}

listNews().then(rows => {
  items = rows;
  renderFilter();
  render();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}).catch(() => {
  list.innerHTML = `<li class="news-empty">お知らせを読み込めませんでした。最新情報は <a href="${CONFIG.INSTAGRAM}" target="_blank" rel="noopener">Instagram</a> をご覧ください。</li>`;
}).finally(() => list.removeAttribute('aria-busy'));
