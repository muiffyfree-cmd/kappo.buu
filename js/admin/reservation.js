/* admin/reservation.html：予約の詳細・編集・電話/DM予約の新規登録 */
import { $, $$, esc, todayKey, jpDate, PART } from '../util.js';
import { getSettings, getReservation, saveReservation, slotRemaining, errorText, courseOptions } from '../api.js';
import { guard, toast, STATUS, SOURCE, ACTIVE } from './common.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');
await guard(id ? '' : 'new');

const f = $('#f');
const S = await getSettings({ fresh: true });
const COURSES = { lunch: await courseOptions('lunch'), dinner: await courseOptions('dinner') };
let R = null;            // 編集中の予約（新規は null）
let override = false;    // 満席でも店の判断で保存する

const val = name => f.elements[name].value;
const radio = (name, v) => { const el = f.querySelector(`[name=${name}][value="${v}"]`); if (el) el.checked = true; };
const radioVal = name => f.querySelector(`[name=${name}]:checked`)?.value;

function fillSlots(selectedSlot) {
  const service = radioVal('service');
  const slots = [...S[service + '_slots']];
  if (selectedSlot && !slots.includes(selectedSlot)) slots.push(selectedSlot);
  slots.sort();
  f.elements.slot.innerHTML = slots.map(s => `<option ${s === selectedSlot ? 'selected' : ''}>${s}</option>`).join('');
  $('#courseList').innerHTML = COURSES[service].map(c => `<option value="${esc(c)}">`).join('');
}

async function updateLeft() {
  override = false;
  $('#warn').hidden = true;
  const day = val('day'), service = radioVal('service'), slot = val('slot');
  if (!day || !service || !slot) { $('#leftText').textContent = ''; return null; }
  try {
    const left = await slotRemaining(day, service, slot, R?.id);
    $('#leftText').textContent = `${jpDate(day)} ${PART[service]} ${slot} の残席：${Math.max(left, 0)}席（この予約を除く・全${S.capacity}席）`;
    return left;
  } catch (e) { $('#leftText').textContent = errorText(e); return null; }
}

/* ---------- 画面を作る ---------- */
if (id) {
  try { R = await getReservation(id); }
  catch (e) { $('#main').innerHTML = `<p class="msg">${esc(errorText(e))}</p><p class="btns"><a class="b" href="/admin/">戻る</a></p>`; throw e; }
  $('#pageTitle').textContent = `${R.name} 様の予約`;
  $('#codeText').textContent = `予約番号 ${R.code}`;
  $('#statusPanel').hidden = false;
  $('#metaText').textContent = `経路：${SOURCE[R.source] || R.source}／登録：${new Date(R.created_at).toLocaleString('ja-JP')}`;
  radio('source', R.source); f.elements.day.value = R.day; radio('service', R.service); fillSlots(R.slot);
  for (const k of ['people', 'course', 'name', 'tel', 'email', 'note', 'staff_memo']) f.elements[k].value = R[k] ?? '';
  renderStatus();
} else {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : todayKey();
  radio('source', 'phone'); f.elements.day.value = day; radio('service', params.get('service') === 'lunch' ? 'lunch' : 'dinner');
  fillSlots(S[radioVal('service') + '_slots'][0]);
  f.elements.people.value = 2;
  f.elements.course.value = COURSES[radioVal('service')][0];
}
$('#backLink').href = `/admin/calendar.html?m=${val('day').slice(0, 7)}&day=${val('day')}`;
updateLeft();

f.querySelectorAll('[name=service]').forEach(r => r.addEventListener('change', () => { fillSlots(null); updateLeft(); }));
['day', 'slot', 'people'].forEach(n => f.elements[n].addEventListener('change', updateLeft));

/* ---------- 状態の変更（ボタン1つで保存） ---------- */
function renderStatus() {
  $('#statusBtns').innerHTML = Object.entries(STATUS).map(([k, label]) =>
    `<button type="button" class="b b--sm${R.status === k ? ' b--black' : ' b--line'}" data-st="${k}" aria-pressed="${R.status === k}">${label}</button>`).join('');
  $$('#statusBtns [data-st]').forEach(b => b.addEventListener('click', async () => {
    const st = b.dataset.st;
    if (st === R.status) return;
    if (ACTIVE(st) && !ACTIVE(R.status)) {
      const left = await slotRemaining(R.day, R.service, R.slot, R.id);
      if (left < R.people && !confirmInline(`この時間は残り${Math.max(left, 0)}席です。予約に戻すと定員を超えます。`, () => setStatus(st))) return;
    }
    setStatus(st);
  }));
}
async function setStatus(st) {
  try {
    R = await saveReservation({ id: R.id, status: st });
    renderStatus();
    $('#warn').hidden = true;
    toast(`「${STATUS[st]}」にしました`);
    updateLeft();
  } catch (e) { $('#msg').textContent = errorText(e); }
}
/* 満席の警告（ブラウザの confirm は使わず、画面内で確認） */
function confirmInline(text, onYes) {
  const w = $('#warn');
  w.innerHTML = `<p>${esc(text)}</p><div class="btns"><button type="button" class="b b--line" data-no>やめる</button><button type="button" class="b b--black" data-yes>それでも保存する</button></div>`;
  w.hidden = false;
  w.querySelector('[data-no]').addEventListener('click', () => { w.hidden = true; });
  w.querySelector('[data-yes]').addEventListener('click', () => { w.hidden = true; onYes(); });
  w.querySelector('[data-yes]').focus();
  return false;
}

/* ---------- 保存 ---------- */
f.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#msg'); msg.textContent = '';
  const data = {
    source: radioVal('source'), day: val('day'), service: radioVal('service'), slot: val('slot'),
    people: Number(val('people')), course: val('course').trim(), name: val('name').trim(), tel: val('tel').trim(),
    email: val('email').trim(), note: val('note').trim(), staff_memo: val('staff_memo').trim(),
  };
  const er = [];
  if (!data.day) er.push('日付');
  if (!data.slot) er.push('時間');
  if (!(data.people >= 1 && data.people <= 40)) er.push('人数（1〜40）');
  if (!data.name) er.push('お名前');
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) er.push('メールアドレス');
  if (er.length) { msg.textContent = er.join('・') + 'を確認してください'; return; }

  // 保存前に残席を確認（満席なら警告。店の判断で上書きできる）
  const active = R ? ACTIVE(R.status) : true;
  if (active && !override) {
    const left = await slotRemaining(data.day, data.service, data.slot, R?.id).catch(() => null);
    if (left !== null && left < data.people) {
      confirmInline(`この時間は残り${Math.max(left, 0)}席です（${data.people}名で登録すると定員を超えます）。`, () => { override = true; f.requestSubmit(); });
      return;
    }
  }
  const btn = $('#saveBtn'); btn.disabled = true;
  try {
    const saved = await saveReservation(R ? { id: R.id, ...data } : data);
    override = false;
    if (!R) {
      sessionStorage.setItem('buu-toast', `${saved.name} 様の予約を登録しました（${saved.code}）`);
      location.href = `/admin/calendar.html?m=${saved.day.slice(0, 7)}&day=${saved.day}`;
      return;
    }
    R = saved;
    $('#pageTitle').textContent = `${R.name} 様の予約`;
    toast('保存しました');
    updateLeft();
  } catch (err) { msg.textContent = errorText(err); }
  finally { btn.disabled = false; }
});
