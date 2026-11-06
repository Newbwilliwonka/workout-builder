// Builder and player stay closed unless the signed-in email is allowlisted.
// node tests/access-lock.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const stubAuth = require('./allow.js').stubAuth;
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));
const w = M.newWorkout('Hidden workout');
w.items = [mk({ name: 'Curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 } })];
const data = M.emptyData(); data.workouts.push(w);
const none = { membership: 'none', intended_plan: null };
const chosen = { membership: 'none', intended_plan: 'enthusiast' };

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  async function open(session, profile) {
    const p = await b.newPage();
    p.on('pageerror', e => errs.push(String(e)));
    await p.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
    const opts = {};
    if (session !== undefined) opts.session = session;
    if (profile !== undefined) opts.profile = profile;
    await stubAuth(p, opts);
    await p.evaluateOnNewDocument(() => {
      window.__leak = false;
      var obs = new MutationObserver(function () {
        var t = document.body ? document.body.innerText : '';
        if (document.querySelector('[data-a=new], [data-a=run], [data-a=play], .pl-screen, [data-b=name]') || t.indexOf('Hidden workout') !== -1) window.__leak = true;
      });
      obs.observe(document, { childList: true, subtree: true, characterData: true });
    });
    return p;
  }
  async function seed(p) {
    await p.goto(URL);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  }
  async function denied(p, hash, expectHash, shot) {
    await p.goto(URL + hash); await p.reload();
    await p.waitForFunction(h => location.hash === h, {}, expectHash);
    await new Promise(r => setTimeout(r, 250));
    assert.strictEqual(await p.evaluate(() => location.hash), expectHash);
    assert.strictEqual(await p.evaluate(() => window.__leak), false, hash + ' showed the builder');
    assert.ok(!(await p.$('[data-a=new], [data-a=run], [data-a=play], .pl-screen')));
    if (shot) await p.screenshot({ path: shot });
  }

  const signedOut = await open(null);
  await seed(signedOut);
  await denied(signedOut, '#/', '#/signin', '/tmp/signed-out-signin-412.png');
  assert.strictEqual(await signedOut.$eval('h2', e => e.textContent), 'Sign in');
  await denied(signedOut, '#/w/' + w.id, '#/signin');
  await denied(signedOut, '#/w/' + w.id + '/ex/new', '#/signin');
  await denied(signedOut, '#/play/' + w.id, '#/signin');
  await signedOut.click('#back');
  await signedOut.waitForFunction(() => location.hash === '#/signin' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in');
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await signedOut.evaluate(() => window.__leak), false, 'back button opened the builder');
  await signedOut.goto(URL + '#/join'); await signedOut.reload();
  await signedOut.waitForFunction(() => location.hash === '#/join' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Create your account');
  await signedOut.close();

  const stranger = await open({ user: { id: 's', email: 'ada@example.com' } }, none);
  await seed(stranger);
  await denied(stranger, '#/', '#/subscriptions');
  assert.ok((await stranger.evaluate(() => document.body.innerText)).includes('Choose how you want to train'));
  await denied(stranger, '#/w/' + w.id, '#/subscriptions');
  await denied(stranger, '#/play/' + w.id, '#/subscriptions');
  await stranger.click('#back');
  await stranger.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.includes('Choose how you want to train'));
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await stranger.evaluate(() => window.__leak), false, 'back button opened the builder for a stranger');
  await stranger.close();

  const chosenStranger = await open({ user: { id: 's', email: 'Ada@Example.com' } }, chosen);
  await seed(chosenStranger);
  await denied(chosenStranger, '#/', '#/subscriptions');
  await chosenStranger.evaluate(() => { window.__hashN = 0; window.addEventListener('hashchange', function () { window.__hashN++; }); });
  await new Promise(r => setTimeout(r, 400));
  assert.strictEqual(await chosenStranger.evaluate(() => location.hash), '#/subscriptions');
  assert.strictEqual(await chosenStranger.evaluate(() => window.__hashN), 0, 'subscriptions bounced back to the builder');
  assert.strictEqual(await chosenStranger.evaluate(() => window.__leak), false, 'a chosen plan opened the builder');
  await chosenStranger.close();

  const allowed = await open({ user: { id: 'a', email: '  Hempled@gmail.com ' } }, none);
  await seed(allowed);
  await allowed.goto(URL + '#/'); await allowed.reload();
  await allowed.waitForSelector('[data-a=run]');
  assert.strictEqual(await allowed.$eval('.name', e => e.textContent), 'Hidden workout');
  await allowed.screenshot({ path: '/tmp/allowlisted-workouts-412.png' });
  await allowed.click('[data-a=run]');
  await allowed.waitForSelector('.pl-screen');
  assert.strictEqual(await allowed.$eval('.pl-info .pl-name', e => e.textContent), 'Curl');
  assert.ok(/#\/play\//.test(await allowed.evaluate(() => location.hash)));
  await allowed.close();

  const other = await open({ user: { id: 'k', email: 'KINISIATHLETICS@gmail.com' } }, chosen);
  await seed(other);
  await other.goto(URL + '#/w/' + w.id + '/ex/' + w.items[0].id); await other.reload();
  await other.waitForSelector('[data-b=name]');
  assert.strictEqual(await other.$eval('[data-b=name]', e => e.value), 'Curl');
  await other.goto(URL + '#/subscriptions'); await other.reload();
  await other.waitForSelector('[data-a=new]');
  assert.ok(!(await other.evaluate(() => location.hash === '#/subscriptions')));
  await other.close();

  assert.deepStrictEqual(errs, []);
  console.log('ACCESS LOCK OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
