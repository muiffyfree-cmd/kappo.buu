/* お品書きの描画（トップの要約カード／menu.html の全体）。データは menu_public */
import { esc } from './util.js';
import { menuImageUrl, priceText, priceNote, MENU_CATEGORY } from './api.js';

const img = (m, cls) => m.image_path
  ? `<div class="${cls}"><img src="${esc(menuImageUrl(m.image_path))}" alt="${esc(m.name)}" loading="lazy"></div>` : '';
const priceHtml = (m, from) => {
  const p = priceText(m, { from });
  // TODO しゃぶしゃぶコースなど価格が未確認のものは「お問い合わせください」
  if (!p) return '<span class="price-note">価格はお問い合わせください</span>';
  const n = priceNote(m);
  return `${esc(p)}${n ? `<span class="price-note">（${esc(n)}）</span>` : ''}`;
};

/** トップ：夜のコース2つ＋昼の定食2つ（menu_public の並び順で先頭から） */
export function topCardsHtml(items) {
  const pick = [...items.filter(m => m.category === 'dinner').slice(0, 2), ...items.filter(m => m.category === 'lunch').slice(0, 2)];
  if (!pick.length) return '<p class="mcards-empty">お品書きは準備中です。</p>';
  return pick.map(m => `
    <article class="mcard">
      ${img(m, 'mcard__ph')}
      <div class="mcard__body">
        <span class="cat-en">${m.category === 'dinner' ? '夜のコース' : 'お昼の定食'}</span>
        ${m.badge ? `<span class="badge badge--fill">${esc(m.badge)}</span>` : ''}
        <h3>${esc(m.name)}</h3>
        ${m.subtitle ? `<span class="sub">${esc(m.subtitle)}</span>` : ''}
        <p class="price">${priceHtml(m, true)}</p>
        ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}
      </div>
    </article>`).join('');
}

/** menu.html：「夜のコース」「お昼の定食」「お昼のお得なセット・オプション」 */
export function fullMenuHtml(items, settings) {
  const block = (cat, id, en, inner, after = '') => `
    <section class="mblock" id="${id}" aria-labelledby="${id}Title">
      <div class="mblock__head"><span class="cat-en" lang="en">${en}</span><h2 id="${id}Title">${MENU_CATEGORY[cat]}</h2></div>
      ${inner}${after}
    </section>`;
  const list = cat => {
    const rows = items.filter(m => m.category === cat);
    if (!rows.length) return '<p class="mcards-empty">現在ご用意しているものはありません。</p>';
    return `<div class="mlist">${rows.map(m => `
      <article class="mitem${m.image_path ? '' : ' mitem--noimg'}">
        ${img(m, 'mitem__ph')}
        <div>
          ${m.badge ? `<span class="badge badge--fill">${esc(m.badge)}</span>` : ''}
          <h3>${esc(m.name)}${m.subtitle ? `<small>${esc(m.subtitle)}</small>` : ''}</h3>
          <p class="price">${priceHtml(m, false)}</p>
          ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}
          ${m.examples?.length ? `<div class="ex"><b>${esc(m.examples_note || '日替わり・半月替わりの品（例）')}</b><ul>${m.examples.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        </div>
      </article>`).join('')}</div>`;
  };
  const opts = items.filter(m => m.category === 'option' || m.category === 'drink');
  const optHtml = opts.length ? `<ul class="mopts">${opts.map(m => `
    <li><span class="n">${esc(m.name)}${m.subtitle ? `<small>${esc(m.subtitle)}</small>` : ''}</span>
      <span class="p">${priceHtml(m, false)}</span>
      ${m.description ? `<span class="d">${esc(m.description)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="mcards-empty">現在ご用意しているものはありません。</p>';

  return block('dinner', 'dinner', 'DINNER COURSE', list('dinner'),
      settings?.course_service_note ? `<p class="mnote">※ ${esc(settings.course_service_note)}</p>` : '')
    + block('lunch', 'lunch', 'LUNCH', list('lunch'))
    + block('option', 'option', 'SET & OPTION', optHtml)
    + (settings?.menu_note ? `<p class="menu-foot">${esc(settings.menu_note)}</p>` : '');
}
