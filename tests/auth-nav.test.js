// Late auth responses must not replace another screen, and email confirmation stays on #/signin.
// node tests/auth-nav.test.js [url]
const assert = require('assert'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 412, height: 915, isMobile: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.goto(URL + '#/signin');
  await p.waitForSelector('#acct-email');
  await p.evaluate(() => {
    var gate = {};
    gate.p = new Promise(function (resolve, reject) { gate.resolve = resolve; gate.reject = reject; });
    window.WBAuth.signIn = function () { return gate.p; };
    window.WBAuth.profile = function () { return Promise.resolve({ membership: 'none', intended_plan: 'enthusiast' }); };
    window.__gate = gate;
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.click('[data-auth=in]');
  await p.evaluate(() => { location.hash = '#/'; });
  await p.waitForSelector('[data-a=new]');
  await p.evaluate(() => window.__gate.reject(new Error('Invalid login credentials')));
  await wait(250);
  assert.ok(await p.$('[data-a=new]'), 'workout list replaced after a late sign-in error');
  assert.ok(!(await p.evaluate(() => document.body.innerText.includes('Invalid login credentials'))));
  assert.ok(!(await p.evaluate(() => location.hash === '#/signin' || location.hash === '#/subscriptions')));

  await p.goto(URL + '#/join');
  await p.waitForSelector('#acct-email');
  await p.evaluate(() => {
    window.WBAuth.signUp = function () { return Promise.resolve({ session: null, needsConfirmation: true }); };
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.click('[data-auth=up]');
  await p.waitForFunction(() => location.hash === '#/signin' && document.body.innerText.includes('Check your email to confirm the account, then sign in.') && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in');
  await p.click('[data-auth=switch]');
  await p.waitForFunction(() => location.hash === '#/join' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Create your account');
  assert.ok(!(await p.evaluate(() => document.body.innerText.includes('Check your email'))));

  await p.evaluate(() => {
    var gate = {};
    gate.p = new Promise(function (resolve, reject) { gate.resolve = resolve; gate.reject = reject; });
    window.WBAuth.session = function () { return Promise.resolve({ user: { id: 'u', email: 'ada@example.com' } }); };
    window.WBAuth.profile = function () { return Promise.resolve({ membership: 'none', intended_plan: null }); };
    window.WBAuth.saveIntended = function () { return gate.p; };
    window.__gate = gate;
    location.hash = '#/subscriptions';
  });
  await p.waitForSelector('[data-plan=enthusiast]');
  await p.click('[data-plan=enthusiast]');
  await p.evaluate(() => { location.hash = '#/'; });
  await p.waitForSelector('[data-a=new]');
  await p.evaluate(() => window.__gate.reject(new Error('Could not save that plan')));
  await wait(250);
  assert.ok(await p.$('[data-a=new]'), 'workout list replaced after a late plan-save error');
  assert.ok(!(await p.evaluate(() => document.body.innerText.includes('Choose how you want to train'))));

  await p.evaluate(() => {
    window.WBAuth.saveIntended = function () { return Promise.resolve({ membership: 'none', intended_plan: 'enthusiast' }); };
    location.hash = '#/subscriptions';
  });
  await p.waitForSelector('[data-plan=trainer]');
  await p.click('[data-plan=trainer]');
  await p.waitForSelector('[data-a=new]');
  assert.ok(locationHashIsHome(await p.evaluate(() => location.hash)));

  // Confirmation stays visible across a sign-in redraw, and a second submit cannot start.
  await p.goto(URL + '#/join');
  await p.waitForSelector('#acct-email');
  await p.evaluate(() => {
    window.__signups = 0;
    var gate = {};
    gate.p = new Promise(function (resolve) { gate.resolve = resolve; });
    window.__gate = gate;
    window.WBAuth.signUp = function () { window.__signups++; return gate.p; };
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.click('[data-auth=up]');
  await p.evaluate(() => { var b = document.querySelector('[data-auth=up]'); if (b) b.click(); });
  assert.strictEqual(await p.evaluate(() => window.__signups), 1);
  await p.evaluate(() => window.__gate.resolve({ session: null, needsConfirmation: true }));
  await p.waitForFunction(() => location.hash === '#/signin' && document.body.innerText.includes('Check your email to confirm the account, then sign in.'));
  await p.evaluate(() => { location.hash = '#/signin/'; });
  await p.waitForFunction(() => document.body.innerText.includes('Check your email to confirm the account, then sign in.') && document.querySelector('h2').textContent === 'Sign in');

  // A failed subscriptions load opens the real sign-in page, and that sign-in still works.
  await p.evaluate(() => {
    window.WBAuth.session = function () { return Promise.reject(new Error('Could not reach sign-in')); };
    location.hash = '#/subscriptions';
  });
  await p.waitForFunction(() => location.hash === '#/signin' && document.body.innerText.includes('Could not reach sign-in') && document.querySelector('h2').textContent === 'Sign in');
  await p.evaluate(() => {
    window.WBAuth.signIn = function () { return Promise.resolve({}); };
    window.WBAuth.profile = function () { return Promise.resolve({ membership: 'none', intended_plan: null }); };
    window.WBAuth.session = function () { return Promise.resolve({ user: { id: 'u', email: 'ada@example.com' } }); };
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.click('[data-auth=in]');
  await p.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.includes('Choose how you want to train'));
  assert.deepStrictEqual(errs, []);
  console.log('AUTH NAV OK');
  await b.close();
  function locationHashIsHome(h) { return h === '' || h === '#' || h === '#/'; }
})().catch(e => { console.error(e); process.exit(1); });
