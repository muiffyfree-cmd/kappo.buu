/* admin/calendar.html：月表示 → 日をクリックで予約一覧 */
import { $, $$, DOW, pad, ymd, jpDate, todayKey } from '../util.js';
import { listReservations, listClosedDays, getSettings, errorText } from '../api.js';
import { guard, ACTIVE, maxRemaining, isClosedDay } from './common.js';
import { dayHtml } from './list.js';

await guard('calendar');

const params = new URLSearchParams(location.search);
const view = new Date(); view.setDate(1);
if (/^\d{4}-\d{2}$/.test(params.get('m') || '')) { const [y, m] = params.get('m').split('-').map(Number); view.setFullYear(y, m - 1, 1); }
let selected = params.get('day') || null;
let S, R = [], C = [];

async function load() {
  const y = view.getFullYear(), m = view.getMonth();
  $('#mTitle').textContent = `${y}年${m + 1}月`;
  try {
    [S, R, C] = await Promise.all([getSettings({ fresh: true }), listReservations(ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))), listClosedDays()]);
    render();
  } catch (e) { $('#acal').textContent = errorText(e); }
}

function render() {
  const y = view.getFullYear(), m = view.getMonth();
  const t = todayKey();
  let h = DOW.map((d, i) => `<div class="dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" aria-hidden="true">${d}</div>`).join('');
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) h += '<div class="aday empty" aria-hidden="true"></div>';
  const last = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const closed = isClosedDay(S, C, k);
    const ppl = sv => R.filter(r => r.day === k && r.service === sv && ACTIVE(r.status)).reduce((a, r) => a + r.people, 0);
    const lines = closed
      ? `<span class="l">休</span>${ppl('lunch') + ppl('dinner') ? `<span class="l">予約 ${ppl('lunch') + ppl('dinner')}名</span>` : ''}`
      : ['lunch', 'dinner'].map(sv => `<span class="l">${sv === 'lunch' ? '昼' : '夜'} <b>${ppl(sv)}</b>名<span class="r">／残${Math.max(0, maxRemaining(R, S, k, sv))}</span></span>`).join('');
    const label = `${jpDate(k)} ${closed ? '休業日' : `昼${ppl('lunch')}名 残${Math.max(0, maxRemaining(R, S, k, 'lunch'))}席、夜${ppl('dinner')}名 残${Math.max(0, maxRemaining(R, S, k, 'dinner'))}席`}`;
    h += `<button type="button" class="aday${closed ? ' closed' : ''}${k === t ? ' today' : ''}" data-k="${k}" aria-pressed="${k === selected}" aria-label="${label}"><span class="d" aria-hidden="true">${d}</span><span aria-hidden="true">${lines}</span></button>`;
  }
  $('#acal').innerHTML = h;
  $$('#acal [data-k]').forEach(b => b.addEventListener('click', () => select(b.dataset.k, true)));
  if (selected && selected.startsWith(`${y}-${pad(m + 1)}`)) select(selected, false); else $('#dayPanel').hidden = true;
}

function select(k, focus) {
  selected = k;
  $$('#acal [data-k]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  const c = C.find(x => x.day === k);
  $('#dayTitle').textContent = jpDate(k);
  $('#dayList').innerHTML = dayHtml({ day: k, resvs: R, settings: S, closed: isClosedDay(S, C, k), closedReason: c?.reason || (c ? '' : '定休日') });
  $('#dayPanel').hidden = false;
  history.replaceState(null, '', `?m=${k.slice(0, 7)}&day=${k}`);
  if (focus) { $('#dayTitle').focus(); $('#dayPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

$('#prevM').addEventListener('click', () => { view.setMonth(view.getMonth() - 1); load(); });
$('#nextM').addEventListener('click', () => { view.setMonth(view.getMonth() + 1); load(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
load();
