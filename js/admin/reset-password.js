/* admin/reset-password.html：パスワード再設定メールのリンクの受け口
   ・?token_hash=...&type=recovery → verifyOtp → 新しいパスワード
   ・#access_token=...&type=recovery（Supabase 既定のメール文面のとき）→ supabase-js が自動でログイン → 新しいパスワード
   ・失敗、または #error_code=...（期限切れなど）→ 再送フォーム */
import { $ } from '../util.js';
import { DEMO, getSession, verifyRecovery, updatePassword, resetPassword, errorText } from '../api.js';

const query = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const show = id => ['#checking', '#newPwForm', '#doneBox', '#resendForm'].forEach(x => { $(x).hidden = x !== id; });
// トークンが履歴や画面共有に残らないよう、URL から消しておく
const cleanUrl = () => history.replaceState(null, '', location.pathname);
const resetUrl = () => `${location.origin}/admin/reset-password.html`;

async function start() {
  if (hash.get('error_code') || hash.get('error')) return expired();
  const tokenHash = query.get('token_hash');
  try {
    if (tokenHash) {
      if (query.get('type') && query.get('type') !== 'recovery') return expired();
      await verifyRecovery(tokenHash);
    } else if (!DEMO && hash.get('type') === 'recovery') {
      // supabase-js が URL のハッシュからセッションを作るのを待つ
      if (!(await getSession())) return expired();
    } else {
      return expired();
    }
  } catch { return expired(); }
  cleanUrl();
  show('#newPwForm');
  $('#newPwForm [name=password]').focus();
}

function expired() {
  cleanUrl();
  show('#resendForm');
  $('#resendForm [name=email]').focus();
}

$('#newPwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, msg = $('#newPwMsg'), btn = f.querySelector('[type=submit]');
  const pw = f.password.value;
  if (pw.length < 8) { msg.textContent = '8文字以上で入力してください'; f.password.focus(); return; }
  if (pw !== f.confirm.value) { msg.textContent = '確認のパスワードが一致しません'; f.confirm.focus(); return; }
  btn.disabled = true; msg.textContent = '';
  try {
    await updatePassword(pw);
    show('#doneBox');
    setTimeout(() => location.replace('/admin/'), 1500);
  } catch (err) {
    msg.textContent = /session|expired|jwt/i.test(err.message || '') ? 'リンクの有効期限が切れています。再設定メールを送り直してください。' : errorText(err);
  } finally { btn.disabled = false; }
});

$('#resendForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = e.target.email.value.trim(), msg = $('#resendMsg');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'メールアドレスを正しく入力してください'; return; }
  try {
    await resetPassword(email, resetUrl());
    msg.textContent = DEMO ? 'デモモードのため、メールは送信されません。' : '再設定のメールを送りました。届いたメールのリンクを開いてください。';
  } catch (err) { msg.textContent = errorText(err); }
});

start();
