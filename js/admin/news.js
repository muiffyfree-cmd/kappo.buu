/* admin/news.html：お知らせの追加・編集・公開／非公開・削除 */
import { $, $$, esc, dotDate, todayKey } from '../util.js';
import { listAllNews, saveNews, deleteNews, errorText } from '../api.js';
import { guard, toast } from './common.js';

await guard('news');
const f = $('#f');
let items = [];
let editing = null;

function open(n) {
  editing = n || null;
  f.hidden = false;
  $('#formTitle').textContent = n ? 'お知らせを編集' : 'お知らせを書く';
  f.elements.published_on.value = n?.published_on || todayKey();
  f.elements.tag.value = n?.tag || 'お知らせ';
  f.elements.title.value = n?.title || '';
  f.elements.body.value = n?.body || '';
  f.elements.is_published.checked = n ? n.is_published : true;
  $('#delWrap').hidden = !n;
  $('#warn').hidden = true;
  $('#msg').textContent = '';
  $('#formTitle').focus();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const close = () => { f.hidden = true; editing = null; };

async function load() {
  try {
    items = await listAllNews();
    $('#list').innerHTML = items.length ? items.map(n => `<li>
      <div class="main"><b>${esc(n.title)}</b><span>${dotDate(n.published_on)}・${esc(n.tag)}・${n.is_published ? '公開中' : '<b style="display:inline">非公開</b>'}</span></div>
      <button type="button" class="b b--sm b--line" data-pub="${n.id}">${n.is_published ? '非公開にする' : '公開する'}</button>
      <button type="button" class="b b--sm" data-edit="${n.id}">編集</button></li>`).join('')
      : '<li class="empty">お知らせはまだありません</li>';
    $$('[data-edit]').forEach(b => b.addEventListener('click', () => open(items.find(n => String(n.id) === b.dataset.edit))));
    $$('[data-pub]').forEach(b => b.addEventListener('click', async () => {
      const n = items.find(x => String(x.id) === b.dataset.pub);
      try { await saveNews({ id: n.id, is_published: !n.is_published }); toast(n.is_published ? '非公開にしました' : '公開しました'); load(); }
      catch (e) { toast(errorText(e)); }
    }));
  } catch (e) { $('#list').innerHTML = `<li class="empty">${esc(errorText(e))}</li>`; }
}

$('#newBtn').addEventListener('click', () => open(null));
$('#cancelBtn').addEventListener('click', close);
f.addEventListener('submit', async e => {
  e.preventDefault();
  const data = {
    published_on: f.elements.published_on.value, tag: f.elements.tag.value.trim() || 'お知らせ',
    title: f.elements.title.value.trim(), body: f.elements.body.value.trim(), is_published: f.elements.is_published.checked,
  };
  if (!data.published_on || !data.title) { $('#msg').textContent = '日付とタイトルを入力してください'; return; }
  try {
    await saveNews(editing ? { id: editing.id, ...data } : data);
    toast('保存しました');
    close();
    load();
  } catch (err) { $('#msg').textContent = errorText(err); }
});
$('#delBtn').addEventListener('click', () => {
  const w = $('#warn');
  w.innerHTML = '<p>このお知らせを削除します。元に戻せません。</p><div class="btns"><button type="button" class="b b--line" data-no>やめる</button><button type="button" class="b b--black" data-yes>削除する</button></div>';
  w.hidden = false;
  w.querySelector('[data-no]').addEventListener('click', () => { w.hidden = true; });
  w.querySelector('[data-yes]').addEventListener('click', async () => {
    try { await deleteNews(editing.id); toast('削除しました'); close(); load(); } catch (e) { toast(errorText(e)); }
  });
  w.querySelector('[data-yes]').focus();
});
load();
