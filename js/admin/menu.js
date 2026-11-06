/* admin/menu.html：お品書き（menu_items）の追加・編集・並べ替え・お休み・写真 */
import { $, $$, esc, todayKey } from '../util.js';
import { DEMO, listAllMenu, saveMenuItem, deleteMenuItem, uploadMenuImage, menuImageUrl, priceText, priceNote,
  getSettings, saveSettings, MENU_CATEGORY, errorText } from '../api.js';
import { guard, toast } from './common.js';

await guard('menu');
const f = $('#f');
let items = [];
let editing = null;      // 編集中の品（新規は {}）
let photoPath = null;    // フォーム上の image_path

/* ---------- 一覧 ---------- */
const stateOf = m => {
  const t = todayKey();
  if (!m.is_available) return 'お休み';
  if (m.available_from && m.available_from > t) return `${m.available_from.slice(5).replace('-', '/')}から`;
  if (m.available_until && m.available_until < t) return '期間終了';
  return '';
};
async function load() {
  try {
    items = await listAllMenu();
    render();
  } catch (e) { $('#lists').innerHTML = `<p class="msg">${esc(errorText(e))}</p>`; }
}
function render() {
  $('#lists').innerHTML = Object.keys(MENU_CATEGORY).map(cat => {
    const rows = items.filter(m => m.category === cat).sort((a, b) => a.sort_order - b.sort_order);
    if (cat === 'drink' && !rows.length) return '';
    return `<section class="panel" aria-labelledby="h-${cat}">
      <h2 id="h-${cat}">${MENU_CATEGORY[cat]}<span class="sp" style="flex:1"></span><button type="button" class="b b--sm" data-add="${cat}">＋ 追加</button></h2>
      ${rows.length ? rows.map((m, i) => {
        const st = stateOf(m);
        const p = priceText(m);
        const off = !m.is_available || st === '期間終了';
        return `<div class="mrow${off ? ' is-off' : ''}">
          <div class="mv"><button type="button" data-up="${m.id}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(m.name)}を上へ">↑</button><button type="button" data-down="${m.id}" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="${esc(m.name)}を下へ">↓</button></div>
          <div class="main"><b>${esc(m.name)}</b><span>${esc(p || '価格なし')}${priceNote(m) ? `（${esc(priceNote(m))}）` : ''}${m.badge ? `・${esc(m.badge)}` : ''}${m.reservable ? '・予約可' : ''}${st ? `・<strong>${esc(st)}</strong>` : ''}</span></div>
          <button type="button" class="b b--sm b--line" data-toggle="${m.id}">${m.is_available ? 'お休みに' : '提供する'}</button>
          <button type="button" class="b b--sm" data-edit="${m.id}">編集</button>
        </div>`;
      }).join('') : '<p class="muted">まだありません</p>'}
    </section>`;
  }).join('');
  $$('[data-add]').forEach(b => b.addEventListener('click', () => open({ category: b.dataset.add })));
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => open(items.find(m => m.id === b.dataset.edit))));
  $$('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    const m = items.find(x => x.id === b.dataset.toggle);
    try { await saveMenuItem({ id: m.id, is_available: !m.is_available }); toast(m.is_available ? `「${m.name}」をお休みにしました` : `「${m.name}」を提供中にしました`); load(); }
    catch (e) { toast(errorText(e)); }
  }));
  $$('[data-up],[data-down]').forEach(b => b.addEventListener('click', () => move(b.dataset.up || b.dataset.down, b.dataset.up ? -1 : 1)));
}

/* 並べ替え：区分の中で入れ替え、10刻みに振り直す */
async function move(id, dir) {
  const m = items.find(x => x.id === id);
  const rows = items.filter(x => x.category === m.category).sort((a, b) => a.sort_order - b.sort_order);
  const i = rows.indexOf(m), j = i + dir;
  if (j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  try {
    await Promise.all(rows.map((r, k) => ((k + 1) * 10 !== r.sort_order ? saveMenuItem({ id: r.id, sort_order: (k + 1) * 10 }) : null)));
    await load();
    $(`[data-${dir < 0 ? 'up' : 'down'}="${id}"]`)?.focus();
  } catch (e) { toast(errorText(e)); }
}

/* ---------- 編集フォーム ---------- */
function exRow(v = '') {
  const d = document.createElement('div');
  d.className = 'ex-row';
  d.innerHTML = `<input value="${esc(v)}" maxlength="40" aria-label="半月替わりの品"><button type="button" aria-label="この行を削除">×</button>`;
  d.querySelector('button').addEventListener('click', () => d.remove());
  $('#exRows').append(d);
  return d;
}
function showPhoto() {
  $('#photoView').innerHTML = photoPath ? `<img src="${esc(menuImageUrl(photoPath))}" alt="現在の写真">` : '<span class="none">写真なし</span>';
  $('#photoRemove').hidden = !photoPath;
}
function open(m) {
  editing = m;
  const isNew = !m.id;
  $('#formTitle').textContent = isNew ? `${MENU_CATEGORY[m.category]}に追加` : `「${m.name}」を編集`;
  f.elements.category.value = m.category;
  for (const k of ['name', 'subtitle', 'price_note', 'description', 'examples_note', 'badge', 'available_from', 'available_until']) f.elements[k].value = m[k] ?? '';
  f.elements.price.value = m.price ?? '';
  f.elements.is_available.checked = isNew ? true : !!m.is_available;
  f.elements.reservable.checked = isNew ? m.category === 'dinner' : !!m.reservable;
  $('#exRows').innerHTML = '';
  (m.examples || []).forEach(x => exRow(x));
  photoPath = m.image_path || null;
  showPhoto();
  $('#delWrap').hidden = isNew;
  $('#warn').hidden = true;
  $('#msg').textContent = '';
  f.hidden = false;
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#formTitle').focus();
}
const close = () => { f.hidden = true; editing = null; };
$('#cancelBtn').addEventListener('click', close);
$('#exAdd').addEventListener('click', () => exRow().querySelector('input').focus());
$('#photoRemove').addEventListener('click', () => { photoPath = null; showPhoto(); });

/* 写真：長辺1600px（デモは800px）に縮小して JPEG で送る */
async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}
$('#photoFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const msg = $('#msg');
  msg.textContent = '写真を送っています…';
  try {
    const blob = await shrink(file, DEMO ? 800 : 1600);
    photoPath = await uploadMenuImage(blob);
    showPhoto();
    msg.textContent = '写真を入れました。「保存する」で確定します。';
  } catch (err) { msg.textContent = '写真を送れませんでした：' + errorText(err); }
});

f.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#msg'); msg.textContent = '';
  const v = k => f.elements[k].value.trim();
  const data = {
    category: v('category'), name: v('name'), subtitle: v('subtitle') || null,
    price: v('price') === '' ? null : Number(v('price')), price_note: v('price_note') || null,
    description: v('description') || null, examples_note: v('examples_note') || null,
    examples: $$('#exRows input').map(i => i.value.trim()).filter(Boolean),
    badge: v('badge') || null, image_path: photoPath,
    available_from: v('available_from') || null, available_until: v('available_until') || null,
    is_available: f.elements.is_available.checked, reservable: f.elements.reservable.checked,
  };
  if (!data.name) { msg.textContent = '名前を入力してください'; f.elements.name.focus(); return; }
  if (data.price != null && !(Number.isInteger(data.price) && data.price >= 0)) { msg.textContent = '価格は0以上の整数で入力してください'; return; }
  if (data.available_from && data.available_until && data.available_from > data.available_until) { msg.textContent = '終了日は開始日より後にしてください'; return; }
  if (editing.id) data.id = editing.id;
  else data.sort_order = (Math.max(0, ...items.filter(m => m.category === data.category).map(m => m.sort_order)) + 10);
  $('#saveBtn').disabled = true;
  try {
    await saveMenuItem(data);
    toast('保存しました。サイトに反映されています');
    close();
    load();
  } catch (err) { msg.textContent = errorText(err); }
  finally { $('#saveBtn').disabled = false; }
});

$('#delBtn').addEventListener('click', () => {
  const w = $('#warn');
  w.innerHTML = `<p>「${esc(editing.name)}」を削除します。元に戻せません（一時的に出さないなら「お休み」にしてください）。</p><div class="btns"><button type="button" class="b b--line" data-no>やめる</button><button type="button" class="b b--black" data-yes>削除する</button></div>`;
  w.hidden = false;
  w.querySelector('[data-no]').addEventListener('click', () => { w.hidden = true; });
  w.querySelector('[data-yes]').addEventListener('click', async () => {
    try { await deleteMenuItem(editing.id); toast('削除しました'); close(); load(); } catch (e) { toast(errorText(e)); }
  });
  w.querySelector('[data-yes]').focus();
});

/* ---------- 共通の注記（settings） ---------- */
const notes = $('#notes');
getSettings({ fresh: true }).then(s => {
  notes.elements.course_service_note.value = s.course_service_note || '';
  notes.elements.menu_note.value = s.menu_note || '';
}).catch(e => { $('#notesMsg').textContent = errorText(e); });
notes.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await saveSettings({ course_service_note: notes.elements.course_service_note.value.trim(), menu_note: notes.elements.menu_note.value.trim() });
    toast('注記を保存しました');
  } catch (err) { $('#notesMsg').textContent = errorText(err); }
});

load();
