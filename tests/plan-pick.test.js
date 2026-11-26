// A landing Subscribe choice stays through create-account, the email step, and sign-in.
// node tests/plan-pick.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(appSrc.indexOf("var PLAN_PICK_KEY = 'wb.plan.pick'") !== -1);
assert.ok(appSrc.indexOf('function startPickedCheckout(') !== -1);
assert.ok(appSrc.indexOf('WBAuth.startCheckout(plan)') !== -1);

(async function () {
  const URL = process.argv[2];
  if (!URL) {
    console.log('PLAN PICK OK');
    return;
  }
  const pp = require('puppeteer-core');
  const stubAuth = require('./allow.js').stubAuth;
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', function (err) { errors.push(String(err)); });
    await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
    await stubAuth(page, { session: null, profile: null });
    await page.goto(URL, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-landing-plan="trainer"]');
    assert.strictEqual(await page.$('#landing [data-landing-plan="free_client"]'), null);
    assert.ok((await page.$eval('#landing', function (el) { return el.innerText; })).indexOf("Free with your trainer's invite code.") !== -1);
    await page.click('[data-landing-plan="trainer"]');
    await page.waitForFunction(function () {
      var note = document.getElementById('plan-pick');
      return location.hash === '#/join' && note && note.textContent === 'Trainer · $19.99 / month' && document.getElementById('invite-code');
    });
    assert.strictEqual(await page.evaluate(function () { return sessionStorage.getItem('wb.plan.pick'); }), 'trainer');
    await page.click('[data-auth="switch"]');
    await page.waitForFunction(function () {
      var note = document.getElementById('plan-pick');
      return location.hash === '#/signin' && note && note.textContent === 'Trainer · $19.99 / month' && !document.getElementById('invite-code');
    });
    assert.strictEqual(await page.evaluate(function () { return sessionStorage.getItem('wb.plan.pick'); }), 'trainer');
    await page.click('[data-auth="switch"]');
    await page.waitForSelector('#invite-code');
    await page.evaluate(function () {
      window.WBAuth.signUp = function () { return Promise.resolve({ needsConfirmation: true }); };
    });
    await page.type('#acct-email', 'ada@example.com');
    await page.type('#acct-pass', 'correct horse battery');
    await page.type('#confirm-pass', 'correct horse battery');
    await page.click('[data-auth="up"]');
    await page.waitForFunction(function () {
      return location.hash === '#/signin' && document.body.innerText.indexOf('Check your email to confirm the account, then sign in. You chose Trainer.') !== -1 && document.getElementById('plan-pick') && document.getElementById('plan-pick').textContent === 'Trainer · $19.99 / month';
    });
    assert.strictEqual(await page.evaluate(function () { return sessionStorage.getItem('wb.plan.pick'); }), 'trainer');
    await page.evaluate(function () {
      window.__pickedCheckout = [];
      window.WBAuth.signIn = function () { return Promise.resolve({ user: { id: 'payer', email: 'ada@example.com' } }); };
      window.WBAuth.session = function () { return Promise.resolve({ user: { id: 'payer', email: 'ada@example.com' } }); };
      window.WBAuth.profile = function () {
        return Promise.resolve({ id: 'payer', email: 'ada@example.com', membership: 'none', intended_plan: null, access_approved: true, billing_status: null });
      };
      window.WBAuth.startCheckout = function (plan) {
        window.__pickedCheckout.push(plan);
        return new Promise(function () {});
      };
    });
    await page.type('#acct-email', 'ada@example.com');
    await page.type('#acct-pass', 'correct horse battery');
    await page.click('[data-auth="in"]');
    await page.waitForFunction(function () { return window.__pickedCheckout && window.__pickedCheckout[0] === 'trainer'; });
    assert.strictEqual(await page.evaluate(function () { return sessionStorage.getItem('wb.plan.pick'); }), 'trainer');

    const paying = await browser.newPage();
    paying.on('pageerror', function (err) { errors.push(String(err)); });
    await stubAuth(paying, { session: null, profile: null });
    await paying.goto(URL + '#/signin', { waitUntil: 'domcontentloaded' });
    await paying.waitForSelector('[data-auth="in"]');
    await paying.evaluate(function () {
      sessionStorage.setItem('wb.plan.pick', 'trainer');
      window.__pickedCheckout = [];
      window.WBAuth.signIn = function () { return Promise.resolve({ user: { id: 'payer', email: 'ada@example.com' } }); };
      window.WBAuth.session = function () { return Promise.resolve({ user: { id: 'payer', email: 'ada@example.com' } }); };
      window.WBAuth.profile = function () {
        return Promise.resolve({
          id: 'payer',
          email: 'ada@example.com',
          membership: 'trainer',
          intended_plan: 'trainer',
          access_approved: true,
          billing_status: 'active',
          stripe_customer_id: 'cus_test'
        });
      };
      window.WBAuth.startCheckout = function (plan) {
        window.__pickedCheckout.push(plan);
        return new Promise(function () {});
      };
    });
    await paying.type('#acct-email', 'ada@example.com');
    await paying.type('#acct-pass', 'correct horse battery');
    await paying.click('[data-auth="in"]');
    await paying.waitForFunction(function () {
      return location.hash === '#/subscriptions' && window.__pickedCheckout.length === 0 && !sessionStorage.getItem('wb.plan.pick');
    });
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
  console.log('PLAN PICK OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
