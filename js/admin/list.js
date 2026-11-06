/* 1日分の予約一覧（昼／夜に分けて表示）。ダッシュボードとカレンダーで共通 */
import { esc, PART } from '../util.js';
import { STATUS, SOURCE, ACTIVE, maxRemaining } from './common.js';

export function dayHtml({ day, resvs, settings, closed, closedReason }) {
  const list = resvs.filter(r => r.day === day);
  if (closed) {
    return `<p class="msg">休業日です${closedReason ? `（${esc(closedReason)}）` : ''}。</p>`
      + (list.length ? svcHtml('lunch') + svcHtml('dinner') : '');
  }
  return svcHtml('lunch') + svcHtml('dinner');

  function svcHtml(service) {
    const rs = list.filter(r => r.service === service);
    const people = rs.filter(r => ACTIVE(r.status)).reduce((a, r) => a + r.people, 0);
    const left = closed ? null : maxRemaining(resvs, settings, day, service);
    const items = rs.length ? rs.map(r => `
      <li class="${ACTIVE(r.status) ? '' : 'is-off'}">
        <a class="rcard" href="/admin/reservation.html?id=${encodeURIComponent(r.id)}">
          <span class="t">${esc(r.slot)}</span>
          <span class="n">${esc(r.name)}<small>様</small></span>
          <span class="p">${r.people}名</span>
          <span class="meta">
            <span>${esc(r.course || 'コース未定')}</span>
            <span>${esc(r.tel || '電話なし')}</span>
            <span class="badge${r.source === 'web' ? ' badge--fill' : ''}">${SOURCE[r.source] || esc(r.source)}</span>
            ${r.status !== 'booked' ? `<span class="badge">${STATUS[r.status]}</span>` : ''}
          </span>
          ${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}
        </a>
      </li>`).join('') : '<li class="empty">予約はありません</li>';
    return `<section class="svc" aria-label="${PART[service]}の部">
      <h3><span class="pill">${PART[service]}</span>${people}名・${rs.filter(r => ACTIVE(r.status)).length}組<span class="sp"></span>
        ${left === null ? '' : `<span class="left">残席 ${Math.max(left, 0)} / ${settings.capacity}</span>`}</h3>
      <ul class="rlist">${items}</ul>
      <p style="margin-top:8px"><a class="b b--sm b--line" href="/admin/reservation.html?day=${day}&service=${service}">＋ ${PART[service]}に予約を登録</a></p>
    </section>`;
  }
}
