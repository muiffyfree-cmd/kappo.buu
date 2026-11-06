/**
 * 割烹 舞ぅ 予約システム（Google Apps Script）
 * - 昼と夜の2部制
 * - 空き状況は「予約」シートの内容と席数から自動で計算します
 * - お客様への確認メールは Resend、お店への通知は Gmail で送ります
 * - Resend の APIキーは「スクリプト プロパティ」の RESEND_API_KEY から読みます（コードに書かない）
 *
 * 最初に一度だけ setup() を実行してください。
 */

const TZ = 'Asia/Tokyo';
const SHEET_SETTINGS = '設定';
const SHEET_RESERVE = '予約';
const SHEET_HOLIDAY = '臨時休業日';
const RESERVE_HEADERS = ['受付日時', '予約番号', '日付', '部', '時間', '人数', 'コース', 'お名前', '電話', 'メール', 'ご要望', '状態', '経路'];
// 列番号（0始まり）
const C = { at: 0, id: 1, date: 2, part: 3, time: 4, people: 5, course: 6, name: 7, tel: 8, email: 9, note: 10, state: 11, route: 12 };
const PARTS = ['lunch', 'dinner'];
const PART_JP = { lunch: '昼', dinner: '夜' };

/* ================= 初期設定（1回だけ実行） ================= */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const s = ss.getSheetByName(SHEET_SETTINGS) || ss.insertSheet(SHEET_SETTINGS);
  if (s.getLastRow() === 0) {
    const rows = [
      ['項目', '値', '説明'],
      ['店名', '割烹 舞ぅ', 'メールに表示されます'],
      ['電話', '095-823-8510', 'メールに表示されます'],
      ['店のメール', 'shop@example.com', '予約通知の送り先（TODO 店のアドレスに変更）'],
      ['送信元', '割烹 舞ぅ <yoyaku@example.jp>', 'Resendで認証したドメインのアドレス（TODO 独自ドメイン未定）'],
      ['席数', 17, '同じ時間に入れる最大人数（TODO 内訳が分かれば卓単位の計算に変更）'],
      ['1組の最大人数', 4, 'これを超える人数は電話で受け付け'],
      ['昼の時間枠', '11:00,11:30,12:00,12:30,13:00', 'カンマ区切り'],
      ['夜の時間枠', '18:00,18:30,19:00,19:30,20:00', 'カンマ区切り'],
      ['昼の滞在時間(分)', 90, '席が埋まる時間'],
      ['夜の滞在時間(分)', 120, '席が埋まる時間'],
      ['定休曜日', '日', '例：日,月　（なしの場合は空欄）'],
      ['受付締切(時間前)', 3, '来店の何時間前までWeb予約できるか'],
      ['受付期間(日)', 60, '何日先まで予約できるか'],
    ];
    s.getRange(1, 1, rows.length, 3).setValues(rows);
    s.getRange('A1:C1').setFontWeight('bold').setBackground('#eeeeee');
    s.setColumnWidth(1, 160); s.setColumnWidth(2, 300); s.setColumnWidth(3, 380);
  }

  const r = ss.getSheetByName(SHEET_RESERVE) || ss.insertSheet(SHEET_RESERVE);
  if (r.getLastRow() === 0) {
    r.appendRow(RESERVE_HEADERS);
    r.getRange(1, 1, 1, RESERVE_HEADERS.length).setFontWeight('bold').setBackground('#eeeeee');
    r.setFrozenRows(1);
    const dv = list => SpreadsheetApp.newDataValidation().requireValueInList(list, true).build();
    r.getRange('D2:D2000').setDataValidation(dv(['昼', '夜']));                       // 部
    r.getRange('L2:L2000').setDataValidation(dv(['予約', 'キャンセル', '来店済']));      // 状態
    r.getRange('M2:M2000').setDataValidation(dv(['Web', '電話', 'Instagram', 'その他'])); // 経路
  }

  const h = ss.getSheetByName(SHEET_HOLIDAY) || ss.insertSheet(SHEET_HOLIDAY);
  if (h.getLastRow() === 0) {
    h.appendRow(['日付', 'メモ']);
    h.getRange('A1:B1').setFontWeight('bold').setBackground('#eeeeee');
  }
}

/* ================= Web API ================= */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'availability';
  if (action === 'availability') return json_(getAvailability_());
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '送信内容が正しくありません' }); }
  if (body.action === 'reserve') return json_(reserve_(body));
  return json_({ ok: false, error: 'unknown action' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= 設定の読み込み ================= */
function settings_() {
  const rows = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS).getDataRange().getValues();
  const m = {};
  rows.slice(1).forEach(r => { m[String(r[0]).trim()] = r[1]; });
  const slots = v => String(v || '').split(/[,、\s]+/).map(t => normTime_(t)).filter(Boolean);
  return {
    shopName: String(m['店名'] || ''),
    tel: String(m['電話'] || ''),
    shopEmail: String(m['店のメール'] || ''),
    from: String(m['送信元'] || ''),
    // TODO 17席の内訳（カウンター〇席＋テーブル〇卓）が分かれば、卓単位で空きを計算する
    capacity: Number(m['席数'] || 17),
    maxPeople: Number(m['1組の最大人数'] || 4),
    slots: { lunch: slots(m['昼の時間枠']), dinner: slots(m['夜の時間枠']) },
    stay: { lunch: Number(m['昼の滞在時間(分)'] || 90), dinner: Number(m['夜の滞在時間(分)'] || 120) },
    closedDow: String(m['定休曜日'] || '').split(/[,、\s]+/).filter(Boolean)
      .map(d => '日月火水木金土'.indexOf(d.replace('曜日', '').replace('曜', ''))).filter(i => i >= 0),
    cutoffH: Number(m['受付締切(時間前)'] || 0),
    days: Number(m['受付期間(日)'] || 60),
  };
}

/* ================= 日付・時刻の正規化 ================= */
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v).trim().replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}` : '';
}
function normTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  const m = String(v).trim().replace('：', ':').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${('0' + m[1]).slice(-2)}:${m[2]}` : '';
}
const toMin_ = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** 「部」の列の値（昼/夜）。空欄のとき（電話の予約など）は時間から判断する（16時より前は昼） */
function normPart_(v, time) {
  const s = String(v || '').trim();
  if (s === '昼' || s === 'lunch') return 'lunch';
  if (s === '夜' || s === 'dinner') return 'dinner';
  return time && toMin_(time) < 16 * 60 ? 'lunch' : 'dinner';
}

/* ================= 空き状況の計算 ================= */
function activeReservations_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RESERVE);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, RESERVE_HEADERS.length).getValues()
    .filter(r => r[C.date] && r[C.state] !== 'キャンセル')
    .map(r => {
      const time = normTime_(r[C.time]);
      return { date: normDate_(r[C.date]), part: normPart_(r[C.part], time), time, people: Number(r[C.people]) || 0 };
    });
}
function holidays_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_HOLIDAY);
  if (sh.getLastRow() < 2) return {};
  const set = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => { const d = normDate_(r[0]); if (d) set[d] = true; });
  return set;
}

/** 指定日・指定の部の各時間枠の残席を計算 */
function remainFor_(date, part, cfg, resv, now) {
  const out = {};
  const same = resv.filter(r => r.date === date && r.part === part);
  cfg.slots[part].forEach(slot => {
    const start = toMin_(slot);
    // 締切チェック
    const slotTime = new Date(date + 'T' + slot + ':00+09:00');
    if (slotTime.getTime() - now.getTime() < cfg.cutoffH * 3600 * 1000) { out[slot] = 0; return; }
    // 滞在時間が重なる予約の人数を合計（時間が空欄の予約は、その部の全枠を使うものとして数える）
    const used = same.filter(r => !r.time || Math.abs(toMin_(r.time) - start) < cfg.stay[part])
      .reduce((a, r) => a + r.people, 0);
    out[slot] = Math.max(0, cfg.capacity - used);
  });
  return out;
}

/** 残席から ○(ok) △(few) ×(full) を決める（サイトの js/reserve.js と同じ基準） */
function statusOf_(slots, capacity) {
  const best = Math.max.apply(null, Object.values(slots).concat([0]));
  if (best === 0) return 'full';
  return best <= Math.max(2, Math.floor(capacity * 0.3)) ? 'few' : 'ok';
}

/**
 * 返り値：
 * { settings:{ lunchSlots, dinnerSlots, maxPeople, capacity },
 *   days:{ 'YYYY-MM-DD': { status, lunch:{status, slots}, dinner:{status, slots} } } }
 */
function getAvailability_() {
  const cfg = settings_();
  const resv = activeReservations_();
  const hol = holidays_();
  const now = new Date();
  const days = {};
  const base = new Date(Utilities.formatDate(now, TZ, 'yyyy-MM-dd') + 'T00:00:00+09:00');
  for (let i = 0; i < cfg.days; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const k = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    const dow = Number(Utilities.formatDate(d, TZ, 'u')) % 7; // 1=月…7=日 → 日=0
    if (hol[k] || cfg.closedDow.indexOf(dow) >= 0) {
      days[k] = { status: 'closed', lunch: { status: 'closed', slots: {} }, dinner: { status: 'closed', slots: {} } };
      continue;
    }
    const day = {};
    PARTS.forEach(p => {
      const slots = remainFor_(k, p, cfg, resv, now);
      day[p] = { status: statusOf_(slots, cfg.capacity), slots };
    });
    const st = [day.lunch.status, day.dinner.status];
    day.status = st.indexOf('ok') >= 0 ? 'ok' : st.indexOf('few') >= 0 ? 'few' : 'full';
    days[k] = day;
  }
  return {
    settings: { lunchSlots: cfg.slots.lunch, dinnerSlots: cfg.slots.dinner, maxPeople: cfg.maxPeople, capacity: cfg.capacity },
    days,
  };
}

/* ================= 予約の登録 ================= */
function reserve_(b) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: '混み合っています。少し時間をおいてお試しください' };
  try {
    const cfg = settings_();
    // 入力チェック
    const date = normDate_(b.date), time = normTime_(b.time), people = Number(b.people);
    const part = b.part === 'lunch' || b.part === 'dinner' ? b.part : '';
    const clip = (s, n) => String(s || '').trim().slice(0, n);
    const name = clip(b.name, 50), tel = clip(b.tel, 20), email = clip(b.email, 100), note = clip(b.note, 500), course = clip(b.course, 30);
    if (!date || !part || cfg.slots[part].indexOf(time) < 0) return { ok: false, error: '日時が正しくありません' };
    if (!name || !tel || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: '入力内容に不備があります' };
    if (!(people >= 1 && people <= cfg.maxPeople)) return { ok: false, error: (cfg.maxPeople + 1) + '名様以上のご予約はお電話で承ります' };

    // 空きの再確認（同時に予約が入った場合に備えて）
    const av = getAvailability_().days[date];
    if (!av || av.status === 'closed') return { ok: false, error: 'その日はご予約を承っておりません' };
    if ((av[part].slots[time] || 0) < people) return { ok: false, error: '申し訳ありません、先ほど満席になりました' };

    const id = Utilities.formatDate(new Date(), TZ, 'MMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    // 先頭が = + - @ の入力は数式として扱われないように ' を付ける
    const safe = s => /^[=+\-@]/.test(s) ? "'" + s : s;
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RESERVE).appendRow([
      new Date(), id, "'" + date, PART_JP[part], "'" + time, people, safe(course), safe(name), "'" + tel, safe(email), safe(note), '予約', 'Web'
    ]);
    SpreadsheetApp.flush();

    const r = { id, date, part, time, people, course, name, tel, email, note };
    try { sendCustomerMail_(cfg, r); } catch (err) { console.error('お客様メール失敗: ' + err); }
    try { sendShopMail_(cfg, r); } catch (err) { console.error('店への通知失敗: ' + err); }
    return { ok: true, id };
  } finally {
    lock.releaseLock();
  }
}

/* ================= メール ================= */
function jpDate_(k) {
  const d = new Date(k + 'T00:00:00+09:00');
  return Utilities.formatDate(d, TZ, 'M月d日') + '（' + '日月火水木金土'[Number(Utilities.formatDate(d, TZ, 'u')) % 7] + '）';
}

/** お客様への確認メール（Resend） */
function sendCustomerMail_(cfg, r) {
  const key = PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY');
  if (!key) { console.warn('RESEND_API_KEY が未設定です'); return; }
  const text =
`${r.name} 様

このたびは${cfg.shopName}をご予約いただき、誠にありがとうございます。
以下の内容で承りました。

━━━━━━━━━━━━━━━━
予約番号：${r.id}
日時　　：${jpDate_(r.date)} ${PART_JP[r.part]} ${r.time}〜
人数　　：${r.people}名様
コース　：${r.course}
ご要望　：${r.note || 'なし'}
━━━━━━━━━━━━━━━━

ご変更・キャンセルは、お電話（${cfg.tel}）にてご連絡ください。
ご来店を心よりお待ちしております。

${cfg.shopName}
長崎県長崎市銅座町3-28
TEL ${cfg.tel}
※このメールは送信専用です。`;

  const res = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({
      from: cfg.from,
      to: [r.email],
      reply_to: cfg.shopEmail || undefined,
      subject: `【${cfg.shopName}】ご予約を承りました（${jpDate_(r.date)} ${PART_JP[r.part]} ${r.time}）`,
      text: text,
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) console.error('Resend error: ' + res.getContentText());
}

/** お店への通知（Gmail） */
function sendShopMail_(cfg, r) {
  if (!cfg.shopEmail) return;
  MailApp.sendEmail({
    to: cfg.shopEmail,
    subject: `【Web予約】${jpDate_(r.date)} ${PART_JP[r.part]} ${r.time} ${r.people}名 ${r.name}様`,
    body:
`Web予約が入りました。

予約番号：${r.id}
日時　　：${jpDate_(r.date)} ${PART_JP[r.part]} ${r.time}〜
人数　　：${r.people}名
コース　：${r.course}
お名前　：${r.name} 様
電話　　：${r.tel}
メール　：${r.email}
ご要望　：${r.note || 'なし'}

キャンセルの場合は、スプレッドシートの「状態」を「キャンセル」にしてください。`,
  });
}

/* ================= 動作テスト用 ================= */
function testAvailability() { console.log(JSON.stringify(getAvailability_()).slice(0, 1500)); }
