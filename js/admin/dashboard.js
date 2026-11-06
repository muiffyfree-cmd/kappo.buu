/* admin/index.html：今日・明日の予約（昼／夜）と残席 */
import { $, jpDate, todayKey, addDays } from '../util.js';
import { listReservations, listClosedDays, getSettings, errorText } from '../api.js';
import { guard, isClosedDay } from './common.js';
import { dayHtml } from './list.js';

await guard('dashboard');

async function load() {
  const t = todayKey(), tm = addDays(t, 1);
  $('#todayDate').textContent = jpDate(t);
  $('#tomDate').textContent = jpDate(tm);
  try {
    const [settings, resvs, closedDays] = await Promise.all([getSettings({ fresh: true }), listReservations(t, tm), listClosedDays()]);
    for (const [id, day] of [['#today', t], ['#tomorrow', tm]]) {
      const c = closedDays.find(x => x.day === day);
      $(id).classList.remove('loading');
      $(id).innerHTML = dayHtml({ day, resvs, settings, closed: isClosedDay(settings, closedDays, day), closedReason: c?.reason || (c ? '' : '定休日') });
    }
  } catch (e) {
    $('#today').textContent = errorText(e);
    $('#tomorrow').textContent = '';
  }
}
$('#reload').addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
load();
