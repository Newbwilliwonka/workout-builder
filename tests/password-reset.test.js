// Forgot-password and recovery-link screens. node tests/password-reset.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const SENT = 'If that email has an account, a reset link is on its way. Check your inbox and spam.';
const INVALID = 'This reset link is invalid or has expired.';
const src = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
assert.ok(src.indexOf('resetPasswordForEmail') !== -1, 'resetPasswordForEmail');
assert.ok(src.indexOf('redirectTo: REDIRECT') !== -1, 'reset uses the shared redirect');
assert.ok(src.indexOf("var REDIRECT = 'https://coachtrainerapp.com/';") !== -1, 'redirect URL');
assert.ok(src.indexOf('updateUser({ password: password })') !== -1, 'updateUser');

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  async function open(cfg) {
    const p = await b.newPage();
    p.on('pageerror', e => errs.push(String(e)));
    await p.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
    await p.evaluateOnNewDocument(function (cfg) {
      var current;
      Object.defineProperty(window, 'WBAuth', {
        configurable: true,
        enumerable: true,
        get: function () { return current; },
        set: function (v) {
          window.__resetSource = String(v.requestPasswordReset || '');
          v.session = function () {
            if (cfg.consumeCode && !window.__consumed) {
              window.__consumed = true;
              try {
                var u = new URL(location.href);
                u.searchParams.delete('code');
                history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + (u.hash || ''));
              } catch (e) {}
            }
            if (cfg.clearHash && !window.__cleared) {
              window.__cleared = true;
              try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
            }
            return Promise.resolve(cfg.session || null);
          };
          v.profile = function () { return Promise.resolve(cfg.profile == null ? null : cfg.profile); };
          v.signOut = function () { window.__signedOut = (window.__signedOut || 0) + 1; return Promise.resolve(); };
          v.requestPasswordReset = function (email) {
            window.__reset = window.__reset || [];
            window.__reset.push(email);
            if (cfg.resetError) return Promise.reject(new Error(cfg.resetError));
            return Promise.resolve(true);
          };
          v.updatePassword = function (password) {
            window.__updated = password;
            if (cfg.updateError) return Promise.reject(new Error(cfg.updateError));
            return Promise.resolve(true);
          };
          current = v;
        }
      });
    }, cfg || {});
    return p;
  }

  const forgot = await open({});
  await forgot.goto(URL + '#/signin');
  await forgot.waitForSelector('[data-auth=forgot]');
  assert.strictEqual(await forgot.$eval('h2', e => e.textContent), 'Sign in');
  assert.ok(await forgot.$('#invite-code'), 'invite code entry stays on sign in');
  assert.ok(await forgot.$('[data-auth=switch]'), 'create account stays on sign in');
  assert.strictEqual(await forgot.$eval('#back', e => e.hidden), true);
  await forgot.click('[data-auth=switch]');
  await forgot.waitForFunction(() => location.hash === '#/join' && document.querySelector('h2').textContent === 'Create your account');
  assert.ok(!(await forgot.$('[data-auth=forgot]')), 'create account does not gain forgot password');
  await forgot.click('[data-auth=switch]');
  await forgot.waitForSelector('[data-auth=forgot]');
  await forgot.click('[data-auth=forgot]');
  await forgot.waitForFunction(() => location.hash === '#/forgot' && document.querySelector('h2').textContent === 'Forgot password');
  assert.strictEqual(await forgot.$eval('#back', e => e.hidden), true);
  await forgot.click('[data-auth=send-reset]');
  await forgot.waitForFunction(() => document.body.innerText.indexOf('Enter your email.') !== -1);
  assert.deepStrictEqual(await forgot.evaluate(() => window.__reset || []), []);
  await forgot.type('#reset-email', 'ada@example.com');
  await forgot.evaluate(() => { window.__reset = []; });
  await forgot.click('[data-auth=send-reset]');
  await forgot.waitForFunction((sent) => document.querySelector('h2').textContent === 'Check your email' && document.body.innerText.indexOf(sent) !== -1, {}, SENT);
  assert.deepStrictEqual(await forgot.evaluate(() => window.__reset), ['ada@example.com']);
  assert.ok((await forgot.evaluate(() => window.__resetSource)).indexOf('resetPasswordForEmail') !== -1);
  assert.ok(!(await forgot.evaluate(() => document.body.innerText.indexOf('ada@example.com') !== -1)), 'confirmation must not reveal the address');
  await forgot.screenshot({ path: '/opt/cursor/artifacts/forgot_password_sent.png' });
  await forgot.click('[data-auth=back-signin]');
  await forgot.waitForFunction(() => location.hash === '#/signin' && document.querySelector('h2').textContent === 'Sign in');

  const hidden = await open({ resetError: 'User not found' });
  await hidden.goto(URL + '#/forgot');
  await hidden.waitForSelector('#reset-email');
  await hidden.type('#reset-email', 'missing@example.com');
  await hidden.click('[data-auth=send-reset]');
  await hidden.waitForFunction((sent) => document.body.innerText.indexOf(sent) !== -1 && document.body.innerText.indexOf('User not found') === -1, {}, SENT);

  const badEmail = await open({ resetError: 'Unable to validate email address: invalid format' });
  await badEmail.goto(URL + '#/forgot');
  await badEmail.waitForSelector('#reset-email');
  await badEmail.type('#reset-email', 'a@b');
  await badEmail.click('[data-auth=send-reset]');
  await badEmail.waitForFunction(() => document.body.innerText.indexOf('Enter a valid email.') !== -1);
  assert.deepStrictEqual(await badEmail.evaluate(() => window.__reset), ['a@b']);

  const offline = await open({ resetError: 'Failed to fetch' });
  await offline.goto(URL + '#/forgot');
  await offline.waitForSelector('#reset-email');
  await offline.type('#reset-email', 'ada@example.com');
  await offline.click('[data-auth=send-reset]');
  await offline.waitForFunction(() => document.body.innerText.indexOf('Could not send the reset link.') !== -1 && document.querySelector('#reset-email'));

  const expired = await open({});
  await expired.goto(URL + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expired.waitForFunction((msg) => {
    var h = document.querySelector('h2');
    return h && h.textContent === 'Set a new password' && document.body.innerText.indexOf(msg) !== -1 && location.hash === '#/reset';
  }, {}, INVALID);
  assert.strictEqual(await expired.evaluate(() => location.hash.indexOf('access_token') === -1 && location.hash.indexOf('error=') === -1), true);
  await expired.click('[data-auth=forgot]');
  await expired.waitForFunction(() => location.hash === '#/forgot' && document.querySelector('#reset-email'));

  const code = await open({});
  await code.goto(URL + '?code=reset-code');
  await code.waitForFunction((msg) => document.body.innerText.indexOf(msg) !== -1 && location.hash === '#/reset', {}, INVALID);
  assert.notStrictEqual(await code.$eval('h2', e => e.textContent), 'Sign in');
  await code.screenshot({ path: '/opt/cursor/artifacts/reset_link_expired.png' });

  const none = { membership: 'none', intended_plan: null };
  const setPass = await open({
    session: { user: { id: 'u', email: 'ada@example.com' } },
    profile: none,
    clearHash: true
  });
  await setPass.goto(URL + '#access_token=abc&refresh_token=def&type=recovery');
  await setPass.waitForSelector('#new-pass');
  assert.strictEqual(await setPass.$eval('h2', e => e.textContent), 'Set a new password');
  assert.strictEqual(await setPass.$eval('#back', e => e.hidden), true);
  assert.strictEqual(await setPass.evaluate(() => location.hash), '#/reset');
  await setPass.screenshot({ path: '/opt/cursor/artifacts/set_new_password.png' });
  async function fill(a, b) {
    await setPass.evaluate((a, b) => {
      document.getElementById('new-pass').value = a;
      document.getElementById('confirm-pass').value = b;
    }, a, b);
  }
  await fill('short', 'short');
  await setPass.click('[data-auth=update-pass]');
  await setPass.waitForFunction(() => document.body.innerText.indexOf('at least 6 characters') !== -1);
  assert.strictEqual(await setPass.evaluate(() => window.__updated || ''), '');
  await fill('secret12', 'secret99');
  await setPass.click('[data-auth=update-pass]');
  await setPass.waitForFunction(() => document.body.innerText.indexOf('do not match') !== -1);
  await fill('secret12', 'secret12');
  await setPass.evaluate(() => {
    window.__sawUpdated = false;
    new MutationObserver(function () {
      if (document.body.innerText.indexOf('Password updated') !== -1) window.__sawUpdated = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await setPass.click('[data-auth=update-pass]');
  await setPass.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.indexOf('Choose how you want to train') !== -1 && !document.querySelector('[data-a=new]'));
  assert.strictEqual(await setPass.evaluate(() => window.__updated), 'secret12');
  assert.strictEqual(await setPass.evaluate(() => window.__sawUpdated), true);
  await setPass.screenshot({ path: '/opt/cursor/artifacts/password_updated_subscriptions.png' });

  const home = await open({
    session: { user: { id: 'u', email: 'ada@example.com' } },
    profile: { membership: 'none', intended_plan: 'enthusiast' },
    clearHash: true
  });
  await home.goto(URL + '#access_token=abc&refresh_token=def&type=recovery');
  await home.waitForSelector('#new-pass');
  await home.type('#new-pass', 'secret12');
  await home.type('#confirm-pass', 'secret12');
  await home.click('[data-auth=update-pass]');
  await home.waitForSelector('[data-a=new]');
  assert.ok(['', '#', '#/'].indexOf(await home.evaluate(() => location.hash)) !== -1);

  const confirm = await open({
    session: { user: { id: 'u', email: 'ada@example.com' } },
    profile: none,
    consumeCode: true
  });
  await confirm.goto(URL + '?code=confirm-code');
  await confirm.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.indexOf('Choose how you want to train') !== -1);
  assert.ok(!(await confirm.evaluate(() => document.body.innerText.indexOf('Set a new password') !== -1 && document.querySelector('#new-pass'))));

  const weak = await open({
    session: { user: { id: 'u', email: 'ada@example.com' } },
    profile: none,
    clearHash: true,
    updateError: 'Password should be at least 8 characters'
  });
  await weak.goto(URL + '#type=recovery');
  await weak.waitForSelector('#new-pass');
  await weak.type('#new-pass', 'secret12');
  await weak.type('#confirm-pass', 'secret12');
  await weak.click('[data-auth=update-pass]');
  await weak.waitForFunction(() => document.body.innerText.indexOf('at least 8 characters') !== -1 && document.querySelector('#new-pass'));

  const leave = await open({
    session: { user: { id: 'u', email: 'ada@example.com' } },
    profile: none,
    clearHash: true
  });
  await leave.goto(URL + '#type=recovery');
  await leave.waitForSelector('[data-auth=back-signin]');
  await leave.click('[data-auth=back-signin]');
  await leave.waitForFunction(() => location.hash === '#/signin' && document.querySelector('h2').textContent === 'Sign in');
  assert.strictEqual(await leave.evaluate(() => window.__signedOut), 1);

  assert.deepStrictEqual(errs, []);
  console.log('PASSWORD RESET OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
