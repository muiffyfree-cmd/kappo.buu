/* =========================================================
   reserve.html：空き状況カレンダーと予約フォーム
   ①日付 → ②時間 → ③人数・お客様情報 → ④確認 → ⑤完了
   公開側は RPC（get_availability / create_reservation）だけを使い、個人情報は読まない。
   ========================================================= */
import { CONFIG } from './config.js';
import { $, $$, PART, esc, jpDate, ymd, todayKey } from './util.js';
import { DEMO, getAvailability, getSettings, createReservation, summarize, errorText, courseOptions, MARK, WORD } from './api.js';
import { monthHtml } from './calendar.js';
import { renderRail } from './rail.js';

const TEL_HREF = 'tel:' + CONFIG.TEL.replace(/-/g, '');
const telLink = `<a href="${TEL_HREF}">${CONFIG.TEL}</a>`;

let S = null;            // settings
let SUM = new Map();     // summarize() の結果
const COURSES = { lunch: ['当日決める'], dinner: ['当日決める'] };   // 予約フォームのコース（お品書きから）
let part = new URLSearchParams(location.search).get('part') === 'lunch' ? 'lunch' : 'dinner';

/* ================= データ ================= */
async function load() {
  const t = todayKey();
  const end = new Date(); end.setMonth(end.getMonth() + CONFIG.MONTHS_AHEAD, 0);
  const [s, rows, dinnerCourses] = await Promise.all([getSettings({ fresh: true }), getAvailability(t, ymd(end)), courseOptions('dinner')]);
  COURSES.dinner = dinnerCourses;
  S = s;
  SUM = summarize(rows, s);
  $('#cutoffText').textContent = `${s.cutoff_hours}時間`;
}
const maxWeb = () => S?.max_web_people ?? 4;
const slotsOf = (k, p) => SUM.get(k)?.[p]?.slots || {};
const canBook = (k, p) => ['ok', 'few'].includes(SUM.get(k)?.[p]?.status);

/* ================= カレンダー ================= */
const viewM = new Date(); viewM.setDate(1); viewM.setHours(0, 0, 0, 0);
const minM = new Date(viewM);
const maxM = new Date(viewM); maxM.setMonth(maxM.getMonth() + CONFIG.MONTHS_AHEAD - 1);

function renderCal() {
  const y = viewM.getFullYear(), m = viewM.getMonth();
  $('#calTitle').textContent = `${y}年${m + 1}月`;
  $('#prevM').disabled = viewM <= minM;
  $('#nextM').disabled = viewM >= maxM;
  const cal = $('#cal');
  cal.innerHTML = monthHtml({ year: y, month: m, summary: SUM, part, mode: 'button' });
  $$('[data-k]', cal).forEach(b => b.addEventListener('click', () => openBooking(b.dataset.k, b)));
  $('#calMsg').textContent = `○△の日付を押すと、${PART[part]}の時間を選べます`;
  $('#demoFlag').hidden = !DEMO;
}
$('#prevM').addEventListener('click', () => { viewM.setMonth(viewM.getMonth() - 1); renderCal(); });
$('#nextM').addEventListener('click', () => { viewM.setMonth(viewM.getMonth() + 1); renderCal(); });

function syncPartButtons() {
  $$('#partSwitch button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.part === part)));
}
$$('#partSwitch button').forEach(b => b.addEventListener('click', () => {
  part = b.dataset.part;
  syncPartButtons();
  if (S) renderCal();
}));
syncPartButtons();

/* ================= モーダル ================= */
const modal = $('#modal');
const mTitle = $('#mTitle');
const mBody = $('#mBody');
const B = {};
let opener = null;

function setStep(n) {
  $$('#steps li').forEach((e, i) => e.classList.toggle('on', i < n));
  $('#stepsLabel').textContent = `ステップ ${n} / 4`;
}
function openModal(from) {
  opener = from || document.activeElement;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (location.hash && /^#\d{4}-\d{2}-\d{2}$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  if (opener && document.contains(opener)) opener.focus();
  else $('#reserve')?.focus();
}
const focusTitle = () => mTitle.focus();
$('#modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => {
  if (!modal.classList.contains('is-open')) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key === 'Tab') {
    const f = $$('button:not([disabled]), a[href], input:not([disabled]), select, textarea', modal).filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === mTitle)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

function openBooking(k, from) {
  Object.keys(B).forEach(x => delete B[x]);
  B.date = k;
  B.part = canBook(k, part) ? part : (part === 'lunch' ? 'dinner' : 'lunch');
  openModal(from);
  stepTime();
}

/* ② 時間 */
function stepTime() {
  setStep(1);
  mTitle.textContent = `${jpDate(B.date)}　時間を選ぶ`;
  const d = SUM.get(B.date);
  const sw = ['lunch', 'dinner'].map(p => {
    const st = d[p].status;
    return `<button type="button" data-p="${p}" aria-pressed="${p === B.part}">${PART[p]}の部<small>${MARK[st]} ${WORD[st]}</small></button>`;
  }).join('');
  const s = slotsOf(B.date, B.part);
  const times = S[B.part + '_slots'];
  const slots = times.map(t => {
    const x = s[t] || { remaining: 0, bookable: false };
    const ok = x.bookable && x.remaining > 0;
    const word = !x.bookable ? '受付終了' : x.remaining <= 0 ? '満席' : x.remaining <= S.few_threshold ? `残り${x.remaining}席` : '空きあり';
    return `<button type="button" class="slot" data-t="${t}" ${ok ? '' : 'disabled'} aria-label="${PART[B.part]} ${t} ${word}">${t}<small aria-hidden="true">${word}</small></button>`;
  }).join('');
  const none = !canBook(B.date, B.part);
  mBody.innerHTML = `
    <div class="part-switch" role="group" aria-label="昼と夜の切り替え">${sw}</div>
    <div class="slots">${slots}</div>
    ${none ? `<p class="err">${PART[B.part]}の部はWebで予約できる時間がありません。ほかの部・日付をお選びいただくか、お電話（${telLink}）でご相談ください。</p>` : ''}
    <p class="note-s">ご希望の時間が満席の場合や、${maxWeb() + 1}名様以上・貸切はお電話（${telLink}／${esc(CONFIG.TEL_HOURS)}）でご相談ください。</p>`;
  $$('.part-switch button', mBody).forEach(b => b.addEventListener('click', () => {
    B.part = b.dataset.p; delete B.time; stepTime(); $(`.part-switch [data-p="${B.part}"]`, mBody).focus();
  }));
  $$('.slot:not([disabled])', mBody).forEach(b => b.addEventListener('click', () => { B.time = b.dataset.t; stepForm(); }));
  focusTitle();
}

/* ③ 人数・コース・お客様情報 */
function stepForm() {
  setStep(2);
  mTitle.textContent = 'お客様情報';
  const remain = slotsOf(B.date, B.part)[B.time]?.remaining || 0;
  const max = Math.min(remain, maxWeb());
  const courses = COURSES[B.part];
  if (!courses.includes(B.course)) B.course = courses[0];
  const ppl = Array.from({ length: max }, (_, i) => `<option value="${i + 1}" ${B.people === i + 1 ? 'selected' : ''}>${i + 1}名</option>`).join('')
    + `<option value="phone" ${B.people === 'phone' ? 'selected' : ''}>${maxWeb() + 1}名以上</option>`;
  mBody.innerHTML = `
    <p class="sub">${jpDate(B.date)}　${PART[B.part]} ${B.time}〜</p>
    <form id="f" novalidate>
      <div class="row2">
        <label class="f">人数<span class="req">必須</span>
          <select name="people" id="people">${ppl}</select></label>
        <label class="f">コース
          <select name="course">${courses.map(c => `<option ${B.course === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      </div>
      ${remain < maxWeb() ? `<p class="note-s">この時間の残りは${remain}席です。</p>` : ''}
      <div class="phone-only" id="phoneOnly" hidden>
        <p><strong>${maxWeb() + 1}名様以上は、お電話でご予約ください。</strong><br>受付時間：${esc(CONFIG.TEL_HOURS)}</p>
        <a class="btn btn--black" href="${TEL_HREF}">電話する（${CONFIG.TEL}）</a>
      </div>
      <div id="formMain">
        <label class="f">お名前<span class="req">必須</span><input name="name" autocomplete="name" value="${esc(B.name)}" placeholder="長崎 太郎" maxlength="100" required></label>
        <label class="f">電話番号<span class="req">必須</span><input name="tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(B.tel)}" placeholder="090-0000-0000" maxlength="20" required></label>
        <label class="f">メールアドレス<span class="req">必須</span><input name="email" type="email" autocomplete="email" value="${esc(B.email)}" placeholder="確認メールをお送りします" maxlength="200" required></label>
        <label class="f">アレルギー・ご要望など<textarea name="note" maxlength="1000" placeholder="例）記念日です／えびアレルギーがあります">${esc(B.note)}</textarea></label>
      </div>
      <p class="err" id="err" role="alert"></p>
      <div class="actions">
        <button type="button" class="btn btn--line" id="backBtn">戻る</button>
        <button type="submit" class="btn btn--black" id="nextBtn">確認へ</button>
      </div>
    </form>`;
  const peopleSel = $('#people');
  const syncPeople = () => {
    const phone = peopleSel.value === 'phone';
    $('#phoneOnly').hidden = !phone;
    $('#formMain').hidden = phone;
    $('#nextBtn').disabled = phone;
  };
  peopleSel.addEventListener('change', syncPeople);
  syncPeople();
  $('#backBtn').addEventListener('click', stepTime);
  $('#f').addEventListener('submit', e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (fd.people === 'phone') return;
    Object.assign(B, fd);
    B.people = Number(fd.people);
    const er = [];
    if (!fd.name.trim()) er.push('お名前');
    if (!/^[0-9０-９+()（） \-－ー]{10,20}$/.test(fd.tel.trim())) er.push('電話番号');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fd.email.trim())) er.push('メールアドレス');
    if (er.length) { $('#err').textContent = er.join('・') + 'を正しく入力してください'; return; }
    stepConfirm();
  });
  focusTitle();
}

/* ④ 確認 */
function stepConfirm() {
  setStep(3);
  mTitle.textContent = '内容の確認';
  mBody.innerHTML = `
    <table class="confirm-tbl">
      <tr><th scope="row">日時</th><td>${jpDate(B.date)}　${PART[B.part]} ${B.time}〜</td></tr>
      <tr><th scope="row">人数</th><td>${B.people}名様</td></tr>
      <tr><th scope="row">コース</th><td>${esc(B.course)}</td></tr>
      <tr><th scope="row">お名前</th><td>${esc(B.name)} 様</td></tr>
      <tr><th scope="row">電話</th><td>${esc(B.tel)}</td></tr>
      <tr><th scope="row">メール</th><td>${esc(B.email)}</td></tr>
      <tr><th scope="row">ご要望</th><td>${esc(B.note || 'なし')}</td></tr>
    </table>
    <div class="rules-box">
      <strong>キャンセル規定</strong>
      <ul>
        ${CONFIG.CANCEL_POLICY.map(p => `<li>${esc(p)}</li>`).join('')}
        <li>${maxWeb() + 1}名様以上・貸切（20名様まで）はお電話で承ります。</li>
        <li>変更・キャンセルはお電話（${telLink}）でご連絡ください。受付時間：${esc(CONFIG.TEL_HOURS)}</li>
      </ul>
    </div>
    <label class="agree"><input type="checkbox" id="agreeCancel"><span>キャンセル規定に同意します</span></label>
    <label class="agree"><input type="checkbox" id="agreePrivacy"><span><a href="/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>に同意します</span></label>
    <p class="err" id="err" role="alert"></p>
    <div class="actions">
      <button type="button" class="btn btn--line" id="backBtn">修正する</button>
      <button type="button" class="btn btn--black" id="sendBtn" disabled>この内容で予約する</button>
    </div>`;
  const agreed = () => $('#agreeCancel').checked && $('#agreePrivacy').checked;
  ['#agreeCancel', '#agreePrivacy'].forEach(id => $(id).addEventListener('change', () => { $('#sendBtn').disabled = !agreed(); }));
  $('#backBtn').addEventListener('click', stepForm);
  $('#sendBtn').addEventListener('click', () => submitBooking(agreed));
  focusTitle();
}

/* 送信 */
async function submitBooking(agreed) {
  const btn = $('#sendBtn');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const code = await createReservation({
      day: B.date, service: B.part, time: B.time, people: B.people, course: B.course,
      name: B.name.trim(), tel: B.tel.trim(), email: B.email.trim(), note: (B.note || '').trim(),
    });
    setStep(4);
    mTitle.textContent = 'ご予約を承りました';
    mBody.innerHTML = `
      <div class="done">
        <p class="big" aria-hidden="true">承</p>
        <p style="margin-top:16px;font-family:var(--serif)">${jpDate(B.date)}　${PART[B.part]} ${B.time}〜　${B.people}名様</p>
        <p class="id">予約番号：${esc(code)}</p>
        <p style="margin-top:14px;font-size:var(--fs-sm)">${esc(B.email)} に確認メールをお送りしました。<br>ご来店を心よりお待ちしております。</p>
        ${DEMO ? '<p class="note-s">※ デモ表示のため、メールは送信されません（予約はこのブラウザ内のデモデータに登録されます）。</p>' : ''}
        <div class="actions"><button type="button" class="btn btn--black" id="doneBtn">閉じる</button></div>
      </div>`;
    $('#doneBtn').addEventListener('click', closeModal);
    focusTitle();
    refresh();
  } catch (e) {
    const err = $('#err');
    if (err) err.innerHTML = `${esc(errorText(e))}。お手数ですが、お電話（${telLink}）でご予約ください。`;
    btn.disabled = !agreed(); btn.textContent = 'この内容で予約する';
    refresh();
  }
}

async function refresh() {
  try { await load(); renderCal(); renderRail(SUM); } catch { /* 表示は前のまま */ }
}

/* ================= 起動 ================= */
function openFromHash() {
  const k = location.hash.slice(1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !SUM.has(k)) return;
  const d = new Date(k + 'T00:00:00');
  viewM.setFullYear(d.getFullYear(), d.getMonth(), 1);
  if (viewM > maxM) viewM.setTime(maxM.getTime());
  renderCal();
  if (canBook(k, 'lunch') || canBook(k, 'dinner')) openBooking(k, null);
}

load().then(() => { renderCal(); renderRail(SUM); openFromHash(); }).catch(() => {
  $('#calMsg').innerHTML = `空き状況を読み込めませんでした。お電話（${telLink}）でお問い合わせください。`;
  const box = $('#railToday'); if (box) box.textContent = '';
});
window.addEventListener('hashchange', openFromHash);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !modal.classList.contains('is-open')) refresh();
});
