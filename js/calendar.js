/* 月のカレンダー（トップ：表示のみ／reserve.html：選択） */
import { DOW, PART, pad, todayKey } from './util.js';
import { MARK, WORD } from './api.js';

/**
 * @param {object} o
 * @param {number} o.year
 * @param {number} o.month 0-11
 * @param {Map} o.summary  summarize() の結果
 * @param {'lunch'|'dinner'} o.part
 * @param {'link'|'button'} o.mode  link：reserve.html#日付 へ／button：data-k を持つボタン
 */
export function monthHtml({ year, month, summary, part, mode }) {
  const todayK = todayKey();
  let h = DOW.map((d, i) => `<div class="dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" aria-hidden="true">${d}</div>`).join('');
  const first = new Date(year, month, 1).getDay();
  const last = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < first; i++) h += '<div class="day empty" aria-hidden="true"></div>';
  for (let d = 1; d <= last; d++) {
    const k = `${year}-${pad(month + 1)}-${pad(d)}`;
    const st = summary.get(k)?.[part]?.status || 'past';
    const can = st === 'ok' || st === 'few';
    const label = `${month + 1}月${d}日（${DOW[new Date(year, month, d).getDay()]}）${PART[part]} ${WORD[st]}`;
    const cls = `day ${st}${k === todayK ? ' today' : ''}`;
    const inner = `<span aria-hidden="true">${d}</span><span class="st" aria-hidden="true">${MARK[st]}</span>`;
    if (mode === 'link') {
      h += can
        ? `<a class="${cls}" href="/reserve.html?part=${part}#${k}" aria-label="${label}（予約へ）">${inner}</a>`
        : `<div class="${cls}" role="img" aria-label="${label}">${inner}</div>`;
    } else {
      h += `<button type="button" class="${cls}" ${can ? `data-k="${k}"` : 'disabled'} aria-label="${label}">${inner}</button>`;
    }
  }
  return h;
}
