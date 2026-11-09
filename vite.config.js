import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const root = __dirname;

/* <!-- @include header --> を partials/header.html の中身に置き換える（全ページ共通のヘッダー・フッター） */
function includePartials() {
  return {
    name: 'buu-include-partials',
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace(/<!--\s*@include\s+([\w-]+)\s*-->/g, (_, name) =>
        readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8')),
    },
    handleHotUpdate({ file, server }) {
      if (file.replace(/\\/g, '/').includes('/partials/')) server.ws.send({ type: 'full-reload' });
    },
  };
}

/* VITE_NOINDEX=true のとき、全ページの <head> に noindex を入れる（仮ドメインで検索に出さない）
   管理画面は元から noindex なので重ねない */
function noindex(on) {
  return {
    name: 'buu-noindex',
    transformIndexHtml: {
      order: 'post',
      handler: html => (on && !/<meta\s+name="robots"/i.test(html)
        ? html.replace(/<head>/i, '<head>\n<meta name="robots" content="noindex, nofollow">')
        : html),
    },
  };
}

const pages = {
  main: 'index.html', news: 'news.html', concept: 'concept.html', menu: 'menu.html',
  reserve: 'reserve.html', privacy: 'privacy.html',
  'admin/login': 'admin/login.html', 'admin/reset-password': 'admin/reset-password.html', 'admin/index': 'admin/index.html', 'admin/calendar': 'admin/calendar.html',
  'admin/reservation': 'admin/reservation.html', 'admin/closed': 'admin/closed.html', 'admin/menu': 'admin/menu.html',
  'admin/mail': 'admin/mail.html', 'admin/news': 'admin/news.html', 'admin/settings': 'admin/settings.html',
};

export default defineConfig(({ mode }) => ({
  appType: 'mpa',
  // .env と、ホスティングの環境変数（ビルド時）の両方から読む
  plugins: [includePartials(), noindex(loadEnv(mode, root, 'VITE_').VITE_NOINDEX === 'true')],
  server: { port: 3100, strictPort: true },
  preview: { port: 3100, strictPort: true },
  build: {
    target: 'es2022',   // 管理画面でトップレベル await を使う
    rollupOptions: {
      input: Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, resolve(root, v)])),
    },
  },
}));
