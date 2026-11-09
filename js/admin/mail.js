/* admin/mail.html：予約メールの文面・プレビュー・テスト送信・店の情報・送信履歴 */
import { $, $$, esc, todayKey } from '../util.js';
import { listMailTemplates, saveMailTemplate, getMailShop, saveMailShop, listMailLog, sendTestMail, SHOP_FIELDS, errorText } from '../api.js';
import { VARS, DEFAULT_TEMPLATES, buildVars, render, sampleReservation, unknownKeys } from '../mail-render.js';
import { guard, toast, MAIL_STATUS, MAIL_TEMPLATE } from './common.js';

const session = await guard('mail');
const f = $('#f');
const shopForm = $('#shopForm');

const WHEN = {
  customer_confirmed: 'お客様へ／予約が登録されたとき（メールアドレスがあり「確認メールを送る」がオンの予約）',
  customer_cancelled: 'お客様へ／予約を「キャンセル」にしたとき（同上）',
  shop_new: '店の通知先へ／Webから予約が入ったとき（管理画面で登録した電話・DM予約では送りません）',
};

let saved = {};      // key → 保存済みの文面
let drafts = {};     // key → 編集中の文面
let current = 'customer_confirmed';
let shop = {};
let lastField = f.elements.body;   // 差し込み項目を入れる先（最後に触った件名か本文）
let force = false;   // 書き間違いの警告を確認したうえで保存する

const isDirty = k => ['enabled', 'subject', 'body'].some(p => drafts[k][p] !== saved[k][p]);

/* ---------- タブ ---------- */
function renderTabs() {
  $('#tplTabs').innerHTML = Object.keys(saved).map(k =>
    `<label><input type="radio" name="tpl" value="${k}" ${k === current ? 'checked' : ''}>${esc(MAIL_TEMPLATE[k] || saved[k].label)}${isDirty(k) ? '<span class="dirty" aria-label="未保存">●</span>' : ''}${saved[k].enabled ? '' : '<small>（停止中）</small>'}</label>`).join('');
  $$('#tplTabs input').forEach(r => r.addEventListener('change', () => { current = r.value; openTemplate(); }));
}
function openTemplate() {
  const d = drafts[current];
  $('#tplTitle').textContent = saved[current].label;
  $('#tplWhen').textContent = WHEN[current] || '';
  f.elements.enabled.checked = d.enabled;
  f.elements.subject.value = d.subject;
  f.elements.body.value = d.body;
  $('#warn').hidden = true; $('#msg').textContent = ''; force = false;
  renderTabs();
  update();
}

/* ---------- プレビュー（Edge Function と同じ render を使う） ---------- */
function sampleVars() {
  const r = sampleReservation(todayKey(), $('#testForm').elements.to.value || 'guest@example.com');
  return buildVars(r, { ...shop, ...shopValues() }, { isCourse: true, bookedPeople: 6, remaining: 11 });
}
let timer;
function update() {
  const d = drafts[current];
  d.enabled = f.elements.enabled.checked;
  d.subject = f.elements.subject.value;
  d.body = f.elements.body.value;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const vars = sampleVars();
    const m = render(d, vars);
    $('#pvSubject').textContent = m.subject;
    $('#pvFrame').srcdoc = m.html.replace('<head>', '<head><base target="_blank">');
    const unknown = unknownKeys(d.subject + d.body, vars);
    const w = $('#unknownWarn');
    w.hidden = !unknown.length;
    w.innerHTML = unknown.length ? `<p>一覧にない差し込みがあります：${unknown.map(k => `<code>{{${esc(k)}}}</code>`).join('・')}<br>このまま送ると、その部分は文字のまま届きます。</p>` : '';
  }, 120);
  // 未保存の印（●）が変わったときだけタブを描き直す
  if (isDirty(current) !== !!$('#tplTabs input:checked')?.parentElement.querySelector('.dirty')) renderTabs();
}
['input', 'change'].forEach(ev => f.addEventListener(ev, () => { force = false; update(); }));
['subject', 'body'].forEach(n => f.elements[n].addEventListener('focus', () => { lastField = f.elements[n]; }));

/* ---------- 差し込み項目（押すとカーソル位置に挿入） ---------- */
$('#varList').innerHTML = VARS.map(([k, label]) =>
  `<li><button type="button" class="var-chip" data-var="${k}"><code>{{${k}}}</code><span>${esc(label)}</span></button></li>`).join('');
$$('[data-var]').forEach(b => b.addEventListener('click', () => {
  const el = lastField, text = `{{${b.dataset.var}}}`;
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
  el.value = el.value.slice(0, s) + text + el.value.slice(e);
  el.focus();
  el.setSelectionRange(s + text.length, s + text.length);
  update();
}));

/* ---------- 保存 ---------- */
f.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#msg'); msg.textContent = '';
  const d = { ...drafts[current], subject: f.elements.subject.value.trim(), body: f.elements.body.value.replace(/\s+$/, '') };
  if (!d.subject || !d.body) { msg.textContent = '件名と本文を入力してください'; return; }
  const unknown = unknownKeys(d.subject + d.body, sampleVars());
  if (unknown.length && !force) {
    confirmInline(`一覧にない差し込み（${unknown.map(k => `{{${k}}}`).join('・')}）があります。このまま保存しますか？`, () => { force = true; f.requestSubmit(); });
    return;
  }
  const btn = $('#saveBtn'); btn.disabled = true;
  try {
    await saveMailTemplate({ key: current, ...d });
    saved[current] = { ...saved[current], ...d };
    drafts[current] = { ...saved[current] };
    force = false;
    openTemplate();
    toast(`「${saved[current].label}」を保存しました`);
  } catch (err) { msg.textContent = errorText(err); }
  finally { btn.disabled = false; }
});
$('#resetBtn').addEventListener('click', () => {
  const def = DEFAULT_TEMPLATES.find(t => t.key === current);
  confirmInline('初期の文面を入れます（保存するまでは反映されません）。', () => {
    f.elements.subject.value = def.subject;
    f.elements.body.value = def.body;
    update();
    toast('初期の文面を入れました。確認して「保存する」を押してください');
  });
});
/* 画面内で確認（ブラウザの confirm は使わない） */
function confirmInline(text, onYes) {
  const w = $('#warn');
  w.innerHTML = `<p>${esc(text)}</p><div class="btns"><button type="button" class="b b--line" data-no>やめる</button><button type="button" class="b b--black" data-yes>続ける</button></div>`;
  w.hidden = false;
  w.querySelector('[data-no]').addEventListener('click', () => { w.hidden = true; });
  w.querySelector('[data-yes]').addEventListener('click', () => { w.hidden = true; onYes(); });
  w.querySelector('[data-yes]').focus();
}
addEventListener('beforeunload', e => { if (Object.keys(drafts).some(isDirty)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- テスト送信 ---------- */
$('#testForm').addEventListener('submit', async e => {
  e.preventDefault();
  const to = e.target.elements.to.value.trim();
  const msg = $('#testMsg');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { msg.textContent = '宛先のメールアドレスを確認してください'; return; }
  const btn = $('#testBtn'); btn.disabled = true; msg.textContent = '送信しています…';
  try {
    const d = drafts[current];
    const res = await sendTestMail({ template_key: current, template: { subject: d.subject, body: d.body }, to });
    msg.textContent = res?.ok === false ? `送信できませんでした（${res.error || ''}）`
      : `${to} に送りました${res?.id === 'demo' ? '（デモのため実際には送っていません）' : ''}`;
  } catch (err) { msg.textContent = `送信できませんでした：${errorText(err)}`; }
  finally { btn.disabled = false; }
});
$('#testForm').elements.to.value = session?.user?.email || '';

/* ---------- 店の情報 ---------- */
function shopValues() {
  return Object.fromEntries(['shop_email', ...SHOP_FIELDS].map(k => [k, shopForm.elements[k].value.trim()]));
}
shopForm.addEventListener('input', () => update());
shopForm.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#shopMsg'); msg.textContent = '';
  const v = shopValues();
  if (v.shop_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.shop_email)) { msg.textContent = '店の通知先メールを確認してください'; return; }
  if (!v.shop_tel || !v.shop_address) { msg.textContent = '電話と住所を入力してください'; return; }
  if (!/^https?:\/\/[^\s/]+/.test(v.site_url)) { msg.textContent = 'サイトのURLは https:// から入力してください'; return; }
  v.site_url = v.site_url.replace(/\/+$/, '');
  try {
    await saveMailShop(v);
    shop = { ...shop, ...v };
    shopForm.elements.site_url.value = v.site_url;
    toast('店の情報を保存しました');
  } catch (err) { msg.textContent = errorText(err); }
});

/* ---------- 送信履歴 ---------- */
const fmt = iso => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
async function loadLog() {
  try {
    const rows = await listMailLog({ limit: 100 });
    $('#log').innerHTML = rows.length ? `<ul class="mlog">${rows.map(l => `<li class="is-${esc(l.status)}">
      <span class="st">${esc(MAIL_STATUS[l.status] || l.status)}</span>
      <span class="main"><b>${esc(MAIL_TEMPLATE[l.template_key] || l.template_key)}</b>
        <span>${esc(fmt(l.created_at))}・${esc(l.to_email)}${l.reservations ? `・<a href="/admin/reservation.html?id=${encodeURIComponent(l.reservation_id)}">${esc(l.reservations.code)} ${esc(l.reservations.name)} 様</a>` : ''}</span>
        ${l.error ? `<span class="err">${esc(l.error)}</span>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="muted">まだ送信したメールはありません</p>';
  } catch (e) { $('#log').innerHTML = `<p class="msg">${esc(errorText(e))}</p>`; }
}
$('#logReload').addEventListener('click', loadLog);

/* ---------- 読み込み ---------- */
try {
  const [tpls, s] = await Promise.all([listMailTemplates(), getMailShop()]);
  shop = s;
  ['shop_email', ...SHOP_FIELDS].forEach(k => { shopForm.elements[k].value = s[k] ?? ''; });
  for (const t of tpls) { saved[t.key] = t; drafts[t.key] = { ...t }; }
  if (!saved[current]) current = tpls[0]?.key;
  if (!current) throw new Error('メールの文面がありません（0003_mail.sql を適用してください）');
  openTemplate();
} catch (e) {
  $('#msg').textContent = /mail_|relation|column/i.test(String(e?.message)) ? `${errorText(e)}／Supabase に 0003_mail.sql を適用してください` : errorText(e);
}
loadLog();
