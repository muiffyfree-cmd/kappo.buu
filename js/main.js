/* =========================================================
   全ページ共通：ヘッダー・メニュー・スライド・スクロール表示・タブ・サイドバー
   ========================================================= */
import { CONFIG } from './config.js';
import { $, $$ } from './util.js';
import { loadRail } from './rail.js';

/* ---------- 保険：パスワード再設定メールのリンクがトップなどに戻ってきたら再設定画面へ ----------
   （Redirect URLs に登録がないと、Supabase は Site URL＝トップに戻すため） */
{
  const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
  if ((q.has('token_hash') || h.get('type') === 'recovery' || h.has('error_code'))
      && !location.pathname.endsWith('/admin/reset-password.html')) {
    location.replace('/admin/reset-password.html' + location.search + location.hash);
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

/* ---------- 電話・Instagram のリンクを設定値で統一 ---------- */
const telHref = 'tel:' + CONFIG.TEL.replace(/-/g, '');
$$('[data-tel]').forEach(a => { a.href = telHref; });
$$('[data-tel-text]').forEach(el => { el.textContent = CONFIG.TEL; });
$$('[data-tel-hours]').forEach(el => { el.textContent = CONFIG.TEL_HOURS; });
$$('[data-ig]').forEach(a => { a.href = CONFIG.INSTAGRAM; });
$$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

/* ---------- ヘッダー：スクロールで黒にする ---------- */
const header = $('.site-header');
const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 40);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- 今いるページのナビに aria-current ---------- */
const here = location.pathname.replace(/\/index\.html$/, '/');
$$('.site-nav a').forEach(a => {
  const u = new URL(a.href, location.href);
  if (!u.hash && u.pathname === here) a.setAttribute('aria-current', 'page');
});

/* ---------- スマホのメニュー ---------- */
const menuBtn = $('.site-header__menu');
const nav = $('.site-nav');
if (menuBtn && nav) {
  const setOpen = open => {
    nav.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    if (open) header.classList.add('is-scrolled'); else onScroll();
  };
  menuBtn.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  $$('a', nav).forEach(a => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); menuBtn.focus(); } });
}

/* ---------- ヒーローのスライド（5秒ごとにフェード） ---------- */
const slides = $$('.hero__slide');
if (slides.length > 1 && !reduceMotion) {
  let i = 0;
  setInterval(() => {
    slides[i].classList.remove('is-on');
    i = (i + 1) % slides.length;
    slides[i].classList.add('is-on');
  }, 5000);
}

/* ---------- スクロールで下からフェードイン ---------- */
const rv = $$('.rv');
if (reduceMotion || !('IntersectionObserver' in window)) {
  rv.forEach(el => el.classList.add('in'));
} else {
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: .08 });
  rv.forEach(el => io.observe(el));
}

/* ---------- タブ（menu.html の昼／夜） ---------- */
const tabs = $$('[role="tab"]');
const selectTab = (tab, push) => {
  tabs.forEach(t => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
  if (push && tab.dataset.hash) history.replaceState(null, '', '#' + tab.dataset.hash);
};
tabs.forEach((t, idx) => {
  t.addEventListener('click', () => selectTab(t, true));
  t.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next, true); next.focus();
  });
});
const hashTab = tabs.find(t => t.dataset.hash && '#' + t.dataset.hash === location.hash);
if (hashTab) selectTab(hashTab);

/* ---------- サイドバー：本日・明日の空き（reserve.html は自前で更新） ---------- */
if (!document.body.dataset.page?.startsWith('reserve')) loadRail();
