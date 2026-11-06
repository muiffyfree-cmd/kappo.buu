/* admin/settings.html：席数・Web予約の上限・定休曜日・時間枠・滞在時間・締切・受付期間 */
import { $, DOW } from '../util.js';
import { getSettings, saveSettings, errorText } from '../api.js';
import { guard, toast } from './common.js';

await guard('settings');
const f = $('#f');
const NUMS = ['capacity', 'max_web_people', 'few_threshold', 'lunch_stay_min', 'dinner_stay_min', 'cutoff_hours', 'booking_days'];

function fill(s) {
  NUMS.forEach(k => { f.elements[k].value = s[k]; });
  f.elements.lunch_slots.value = s.lunch_slots.join(', ');
  f.elements.dinner_slots.value = s.dinner_slots.join(', ');
  $('#dows').innerHTML = DOW.map((d, i) => `<label><input type="checkbox" name="dow" value="${i}" ${s.closed_dows.includes(i) ? 'checked' : ''}>${d}</label>`).join('');
}

const parseSlots = v => {
  const list = v.split(/[,、，\s]+/).map(x => x.trim()).filter(Boolean).map(x => x.replace(/^(\d):/, '0$1:'));
  if (!list.length || list.some(x => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x))) return null;
  return [...new Set(list)].sort();
};

f.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#msg'); msg.textContent = '';
  const v = {};
  for (const k of NUMS) {
    const el = f.elements[k], n = Number(el.value);
    if (!Number.isInteger(n) || n < Number(el.min) || n > Number(el.max)) { msg.textContent = `「${el.closest('label').firstChild.textContent.trim()}」は ${el.min}〜${el.max} の数字で入力してください`; el.focus(); return; }
    v[k] = n;
  }
  v.lunch_slots = parseSlots(f.elements.lunch_slots.value);
  v.dinner_slots = parseSlots(f.elements.dinner_slots.value);
  if (!v.lunch_slots || !v.dinner_slots) { msg.textContent = '時間枠は「11:00, 11:30」のように入力してください'; return; }
  v.closed_dows = [...f.querySelectorAll('[name=dow]:checked')].map(x => Number(x.value));
  try {
    await saveSettings(v);
    fill(await getSettings({ fresh: true }));
    toast('設定を保存しました');
  } catch (err) { msg.textContent = errorText(err); }
});

try { fill(await getSettings({ fresh: true })); }
catch (e) { $('#msg').textContent = errorText(e); }
