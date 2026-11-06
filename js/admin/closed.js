/* admin/closed.html：臨時休業日の追加・削除 */
import { $, $$, esc, jpDate, todayKey } from '../util.js';
import { listClosedDays, addClosedDay, deleteClosedDay, listReservations, errorText } from '../api.js';
import { guard, toast, ACTIVE } from './common.js';

await guard('closed');
const f = $('#f');
f.elements.day.min = todayKey();

async function load() {
  try {
    const days = await listClosedDays();
    const t = todayKey();
    const row = c => `<li><div class="main"><b>${jpDate(c.day)}</b><span>${esc(c.reason || '理由なし')}</span></div>
      <button type="button" class="b b--sm b--line" data-del="${c.day}" aria-label="${jpDate(c.day)}の休業を取り消す">取り消す</button></li>`;
    const up = days.filter(c => c.day >= t), past = days.filter(c => c.day < t).reverse();
    $('#list').innerHTML = up.length ? up.map(row).join('') : '<li class="empty">登録されている休業日はありません</li>';
    $('#past').innerHTML = past.length ? past.map(row).join('') : '<li class="empty">なし</li>';
    $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
      try { await deleteClosedDay(b.dataset.del); toast(`${jpDate(b.dataset.del)}の休業を取り消しました`); load(); }
      catch (e) { toast(errorText(e)); }
    }));
  } catch (e) { $('#list').innerHTML = `<li class="empty">${esc(errorText(e))}</li>`; }
}

f.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#msg'); msg.textContent = '';
  const day = f.elements.day.value;
  if (!day) { msg.textContent = '日付を選んでください'; return; }
  try {
    await addClosedDay(day, f.elements.reason.value.trim());
    // すでに入っている予約があれば知らせる（予約は自動では消さない）
    const rs = (await listReservations(day, day)).filter(r => ACTIVE(r.status));
    msg.innerHTML = rs.length
      ? `${jpDate(day)}を休業日にしました。<b>この日には予約が${rs.length}件あります。</b><a href="/admin/calendar.html?m=${day.slice(0, 7)}&day=${day}">予約を確認する</a>`
      : '';
    toast(`${jpDate(day)}を休業日にしました`);
    f.reset();
    load();
  } catch (err) { msg.textContent = errorText(err); }
});
load();
