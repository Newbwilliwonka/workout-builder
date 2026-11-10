// Visual messaging, send-workout, and enthusiast sharing. Sample data only.
// node tests/connect-ui.test.js [url]
const assert = require('assert');
const pp = require('puppeteer-core');
const stubAuth = require('./allow.js').stubAuth;
const M = require('../model.js');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';

async function stubConn(page, conn) {
  await page.evaluateOnNewDocument(function (conn) {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return desc.get(); },
      set: function (v) {
        desc.set(v);
        var api = desc.get();
        api.myConnection = function () { return Promise.resolve(conn); };
        api.roster = function () { return Promise.resolve({ role: null }); };
      }
    });
  }, conn);
}

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const trainer = await b.newPage();
  trainer.on('pageerror', e => errs.push('trainer ' + e));
  await trainer.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await stubAuth(trainer, {
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    profile: { membership: 'none', intended_plan: 'trainer' }
  });
  await stubConn(trainer, null);
  const data = M.emptyData();
  data.workouts.push(M.newWorkout('Morning'));
  await trainer.goto(URL);
  await trainer.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  const before = await trainer.evaluate(k => localStorage.getItem(k), M.STORAGE_KEY);
  await trainer.goto(URL + '#/');
  await trainer.reload();
  await trainer.waitForSelector('[data-a=send]');
  assert.strictEqual(await trainer.$eval('[data-a=messages]', e => e.textContent), 'Messages');
  assert.strictEqual(await trainer.$eval('[data-a=send]', e => e.textContent), 'Send workout');
  assert.ok(await trainer.$('[data-a=new]'));
  assert.ok(await trainer.$('[data-a=run]'));

  await trainer.click('[data-a=messages]');
  await trainer.waitForSelector('[data-thread=maya]');
  const list = await trainer.$eval('#app', e => e.innerText);
  assert.ok(list.includes('Maya Chen') && list.includes('Jordan Lee') && list.includes('Sam Ortiz'));
  assert.ok(list.includes('Enthusiast') && list.includes('Free Client'));
  assert.ok(!(await trainer.$('[data-a=new]')));

  await trainer.click('[data-thread=maya]');
  await trainer.waitForSelector('#thread');
  const talk = await trainer.$eval('#thread', e => e.innerText);
  assert.ok(talk.includes('Can we move Thursday to Friday morning?'));
  assert.ok(talk.includes('Friday at 8 works.'));
  await trainer.type('#msg-text', 'See you Friday');
  await trainer.click('#msg-send');
  await trainer.waitForFunction(() => document.body.innerText.includes('See you Friday'));
  await trainer.click('#back');
  await trainer.waitForSelector('[data-thread=maya]');
  assert.strictEqual(await trainer.evaluate(() => location.hash), '#/messages');

  await trainer.goto(URL + '#/send');
  await trainer.waitForSelector('#send-go');
  assert.strictEqual(await trainer.$eval('#send-go', e => e.textContent), 'Send to 2 clients');
  assert.strictEqual(await trainer.$eval('[data-pick-workout=lower]', e => e.getAttribute('aria-pressed')), 'true');
  assert.ok((await trainer.$eval('[data-pick-client=maya]', e => e.innerText)).includes('Enthusiast · client'));
  const stored = await trainer.evaluate(k => localStorage.getItem(k), M.STORAGE_KEY);
  await trainer.click('#send-go');
  await trainer.waitForSelector('#sent-note');
  const sent = await trainer.$eval('#sent-note', e => e.innerText);
  assert.ok(sent.includes('Maya Chen and Jordan Lee'));
  assert.ok(sent.includes('editable copy of Lower body strength'));
  assert.ok(sent.includes('Nothing was sent'));
  assert.strictEqual(await trainer.evaluate(k => localStorage.getItem(k), M.STORAGE_KEY), stored);
  assert.strictEqual(before, stored);

  await trainer.click('[data-role=client]');
  await trainer.waitForSelector('#send-locked');
  assert.ok((await trainer.$eval('#send-locked', e => e.innerText)).includes('Only a trainer can send a workout'));
  await trainer.click('[data-open-received=list]');
  await trainer.waitForSelector('#received-lead');
  const library = await trainer.$eval('#app', e => e.innerText);
  assert.ok(library.includes('From Alex Rivera'));
  assert.ok(library.includes('You can edit it'));
  assert.ok(library.includes('Easy bike day'));
  assert.ok(library.includes('Your workout'));
  await trainer.click('[data-open-received=friday]');
  await trainer.waitForSelector('#copy-name');
  assert.strictEqual(await trainer.$eval('#copy-name', e => e.value), 'Friday full body');
  assert.ok((await trainer.$eval('#copy-note', e => e.textContent)).includes('This copy is yours'));
  await trainer.click('#copy-name', { clickCount: 3 });
  await trainer.type('#copy-name', 'Friday session');
  await trainer.click('#copy-save');
  await trainer.waitForFunction(() => document.getElementById('title').textContent === 'Friday session');
  await trainer.click('#back');
  await trainer.waitForFunction(() => document.body.innerText.includes('Friday session'));
  assert.strictEqual(await trainer.evaluate(k => localStorage.getItem(k), M.STORAGE_KEY), stored);
  assert.ok(!(await trainer.$('[data-a=run], [data-a=play], .pl-screen')));

  await trainer.goto(URL + '#/subscriptions');
  await trainer.waitForSelector('#redeem');
  assert.strictEqual(await trainer.$('#share-link'), null);
  await trainer.goto(URL + '#/account');
  await trainer.waitForSelector('[data-go=send]');
  assert.strictEqual(await trainer.$('#share-account'), null);
  assert.strictEqual(await trainer.$('[data-go=received]'), null);

  const fan = await b.newPage();
  fan.on('pageerror', e => errs.push('fan ' + e));
  await fan.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await stubAuth(fan, {
    session: { user: { id: 'fan', email: 'fan@example.com' } },
    profile: { membership: 'none', intended_plan: 'enthusiast' }
  });
  await stubConn(fan, null);
  await fan.goto(URL + '#/subscriptions');
  await fan.waitForSelector('#share-link');
  assert.strictEqual(await fan.$eval('#share-link', e => e.checked), true);
  assert.ok((await fan.$eval('#redeem', e => e.innerText)).includes('training conflicts'));
  assert.ok((await fan.$eval('#redeem', e => e.innerText)).includes('Let your trainer view your workouts and tracking'));
  await fan.click('#share-link');
  await fan.waitForFunction(() => sessionStorage.getItem('wb.shareWorkouts') === '0');
  assert.strictEqual(await fan.$eval('#share-link', e => e.checked), false);
  await fan.evaluate(() => { location.hash = '#/subscriptions?again=1'; });
  await fan.waitForSelector('#share-link');
  assert.strictEqual(await fan.$eval('#share-link', e => e.checked), false);
  await fan.evaluate(() => {
    window.WBAuth.myConnection = function () {
      return Promise.resolve({ trainerId: 'alex', trainerEmail: 'alex@example.com' });
    };
    location.hash = '#/account?linked=1';
  });
  await fan.waitForSelector('#share-account');
  assert.strictEqual(await fan.$eval('#share-account', e => e.getAttribute('aria-checked')), 'false');
  assert.ok((await fan.$eval('#share-card', e => e.innerText)).includes('training conflicts'));
  assert.strictEqual(await fan.$('#share-link'), null);
  await fan.click('#share-account');
  assert.strictEqual(await fan.$eval('#share-account', e => e.getAttribute('aria-checked')), 'true');
  assert.strictEqual(await fan.evaluate(() => sessionStorage.getItem('wb.shareWorkouts')), '1');
  assert.ok((await fan.$eval('#app', e => e.innerText)).includes('alex@example.com'));

  const guest = await b.newPage();
  guest.on('pageerror', e => errs.push('guest ' + e));
  await stubAuth(guest, { session: null });
  await guest.goto(URL + '#/messages');
  await guest.waitForFunction(() => location.hash === '#/signin');
  assert.strictEqual(await guest.$('[data-thread=maya]'), null);

  const preview = await b.newPage();
  preview.on('pageerror', e => errs.push('preview ' + e));
  await preview.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await preview.goto(URL + '#/messages?preview=1');
  await preview.waitForSelector('[data-thread=maya]');
  assert.strictEqual(await preview.$('[data-a=new]'), null);
  await preview.goto(URL + '#/subscriptions?as=enthusiast&preview=1');
  await preview.waitForSelector('#share-link');
  assert.strictEqual(await preview.$eval('#share-link', e => e.checked), true);
  await preview.goto(URL + '#/account?as=enthusiast&preview=1');
  await preview.waitForSelector('#share-account');
  assert.strictEqual(await preview.$eval('#share-account', e => e.getAttribute('aria-checked')), 'true');

  assert.deepStrictEqual(errs, []);
  console.log('CONNECT UI OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
