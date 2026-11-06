/* サイドバー：本日・明日の空き（○△×休） */
import { PART, addDays, todayKey } from './util.js';
import { getAvailability, getSettings, summarize, MARK, WORD } from './api.js';

export function renderRail(summary) {
  const box = document.getElementById('railToday');
  if (!box) return;
  const t = todayKey();
  const row = (label, k) => {
    const d = summary.get(k);
    if (!d || d.closed) {
      const st = d?.closed ? 'closed' : 'past';
      return `<span class="lbl">${label}</span><span class="row" aria-label="${label} ${WORD[st]}"><b class="none">${MARK[st]}</b></span>`;
    }
    return `<span class="lbl">${label}</span>` + ['lunch', 'dinner'].map(p => {
      const st = d[p].status;
      const off = st === 'full' || st === 'past';
      return `<span class="row" aria-label="${label}の${PART[p]} ${WORD[st]}">${PART[p]}<b class="${off ? 'none' : ''}">${MARK[st]}</b></span>`;
    }).join('');
  };
  box.innerHTML = row('本日', t) + row('明日', addDays(t, 1));
}

export async function loadRail() {
  if (!document.getElementById('railToday')) return;
  try {
    const t = todayKey();
    const [rows, s] = await Promise.all([getAvailability(t, addDays(t, 1)), getSettings()]);
    renderRail(summarize(rows, s));
  } catch {
    document.getElementById('railToday').textContent = '';
  }
}
