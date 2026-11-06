/* menu.html：お品書きを menu_public から表示（管理画面で保存するとすぐ反映） */
import { CONFIG } from './config.js';
import { $ } from './util.js';
import { listMenu, getSettings } from './api.js';
import { fullMenuHtml } from './menu-render.js';

const box = $('#menuAll');
async function load() {
  try {
    const [items, s] = await Promise.all([listMenu(), getSettings({ fresh: true })]);
    box.innerHTML = fullMenuHtml(items, s);
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch {
    box.innerHTML = `<p class="mcards-empty">お品書きを読み込めませんでした。お電話（<a href="tel:${CONFIG.TEL.replace(/-/g, '')}">${CONFIG.TEL}</a>）でお問い合わせください。</p>`;
  } finally { box.removeAttribute('aria-busy'); }
}
load();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
