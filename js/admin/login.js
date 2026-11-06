/* admin/login.html：ログイン・パスワード再設定 */
import { $ } from '../util.js';
import { DEMO, signIn, signOut, isAdmin, getSession, resetPassword, errorText } from '../api.js';

const params = new URLSearchParams(location.search);
const next = (() => { const n = params.get('next') || ''; return n.startsWith('/admin/') ? n : '/admin/'; })();
const show = id => ['#loginForm', '#resetForm'].forEach(x => { $(x).hidden = x !== id; });

$('#demoBox').hidden = !DEMO;
if (params.get('denied')) $('#loginMsg').textContent = errorText({ code: 'NOT_ADMIN' });

/* 古い再設定メール（login.html に戻るもの）のリンクは再設定画面へ */
const h = new URLSearchParams(location.hash.slice(1));
const recoveryLink = params.has('token_hash') || h.get('type') === 'recovery' || h.has('error_code');
if (recoveryLink) location.replace('/admin/reset-password.html' + location.search + location.hash);

/* ログイン済みならそのまま中へ */
if (!recoveryLink) getSession().then(async s => {
  if (s && await isAdmin().catch(() => false)) location.replace(next);
});

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, msg = $('#loginMsg'), btn = f.querySelector('[type=submit]');
  const email = f.email.value.trim(), password = f.password.value;
  if (!email || !password) { msg.textContent = 'メールアドレスとパスワードを入力してください'; return; }
  btn.disabled = true; msg.textContent = '';
  try {
    await signIn(email, password);
    if (!(await isAdmin())) { await signOut(); msg.textContent = errorText({ code: 'NOT_ADMIN' }); return; }
    location.replace(next);
  } catch (err) {
    msg.textContent = errorText(err);
  } finally { btn.disabled = false; }
});

$('#toReset').addEventListener('click', () => { show('#resetForm'); $('#resetForm [name=email]').value = $('#loginForm [name=email]').value; $('#resetForm [name=email]').focus(); });
$('#toLogin').addEventListener('click', () => { show('#loginForm'); $('#loginForm [name=email]').focus(); });

$('#resetForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = e.target.email.value.trim(), msg = $('#resetMsg');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'メールアドレスを正しく入力してください'; return; }
  try {
    await resetPassword(email, `${location.origin}/admin/reset-password.html`);
    msg.textContent = DEMO ? 'デモモードのため、メールは送信されません。' : '再設定のメールを送りました。メールのリンクから新しいパスワードを設定してください。';
  } catch (err) { msg.textContent = errorText(err); }
});

