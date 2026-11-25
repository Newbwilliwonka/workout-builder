// Client info on the signed-in Account page. No network and no live database.
// node tests/client-info-ui.test.js [url]
const assert = require('assert');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const USER = '22222222-2222-4222-8222-222222222222';

function birthdayIso() {
  var now = new Date();
  var y = now.getFullYear() - 30;
  var m = String(now.getMonth() + 1);
  var d = String(now.getDate());
  if (m.length < 2) m = '0' + m;
  if (d.length < 2) d = '0' + d;
  return y + '-' + m + '-' + d;
}

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(function (userId) {
    var current;
    function patch(api) {
      if (!api || api.__infoStub) return api;
      api.__infoStub = true;
      api.session = function () {
        return Promise.resolve({ user: { id: window.__userId || userId, email: 'ada@example.com' } });
      };
      api.profile = function () {
        var plan = 'free_client';
        try { plan = new URLSearchParams(location.search).get('plan') || 'free_client'; } catch (e) {}
        return Promise.resolve({
          id: userId,
          membership: plan,
          intended_plan: plan === 'free_client' ? null : plan,
          display_name: 'Ada Client'
        });
      };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.trainerRequestCount = function () { return Promise.resolve(0); };
      api.signOut = function () { return Promise.resolve(); };
      api.__saveClientInfo = api.saveClientInfo;
      api.clientInfo = function () {
        if (window.__infoHold) return new Promise(function () {});
        if (window.__infoFail) return Promise.reject(new Error('Could not load client info.'));
        var id = window.__userId || userId;
        var saved = (window.__infoByUser || {})[id];
        if (window.__infoDelay) {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(saved || null); }, 350);
          });
        }
        if (window.__infoLag) {
          var snap = saved ? JSON.parse(JSON.stringify(saved)) : null;
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(snap); }, 400);
          });
        }
        return Promise.resolve(saved || null);
      };
      function storeInfo(fields) {
        window.__infoSaves = (window.__infoSaves || 0) + 1;
        var id = window.__userId || userId;
        window.__infoByUser = window.__infoByUser || {};
        var row = {
          birthday: fields.birthday,
          sex: fields.sex,
          height_cm: fields.heightCm,
          weight_kg: fields.weightKg,
          goals: fields.goals,
          goals_other: fields.goalsOther
        };
        window.__infoByUser[id] = row;
        return row;
      }
      api.saveClientInfo = function (fields) {
        if (window.__saveDelay) {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(storeInfo(fields)); }, 300);
          });
        }
        return Promise.resolve(storeInfo(fields));
      };
      api.deleteClientInfo = function () {
        window.__infoDeletes = (window.__infoDeletes || 0) + 1;
        var id = window.__userId || userId;
        if (window.__infoByUser) delete window.__infoByUser[id];
        return Promise.resolve(null);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, USER);

  const born = birthdayIso();
  await page.goto(URL + '?plan=free_client#/account');
  await page.waitForSelector('#client-birthday');
  const labels = await page.$eval('#client-info', function (el) { return el.innerText; });
  assert.ok(labels.indexOf('Birthday') !== -1);
  assert.strictEqual(labels.indexOf('BIRTHDAY'), -1);
  assert.ok(labels.indexOf('Weight or fat loss') !== -1);
  assert.strictEqual(labels.indexOf('WEIGHT OR FAT LOSS'), -1);
  assert.ok(labels.indexOf('Birthday') !== -1);
  assert.ok(labels.indexOf('Sex') !== -1);
  assert.ok(labels.indexOf('Male') !== -1);
  assert.ok(labels.indexOf('Female') !== -1);
  assert.ok(labels.indexOf('Height') !== -1);
  assert.ok(labels.indexOf('Weight') !== -1);
  assert.ok(labels.indexOf('Weight or fat loss') !== -1);
  assert.ok(labels.indexOf('Building strength and muscle') !== -1);
  assert.ok(labels.indexOf('General health and fitness') !== -1);
  assert.ok(labels.indexOf('Mobility or pain relief') !== -1);
  assert.ok(labels.indexOf('Athletic performance') !== -1);
  assert.ok(labels.indexOf('Other') !== -1);
  assert.strictEqual(labels.indexOf('@'), -1);
  assert.strictEqual(await page.$eval('#client-info', function (el) { return el.querySelector('[aria-label="Sex"]') != null; }), true);
  await page.click('#client-info-save');
  await page.waitForSelector('#client-birthday');
  assert.strictEqual(await page.evaluate(function () { return window.__infoSaves || 0; }), 0);

  await page.$eval('#client-birthday', function (el, value) { el.value = value; }, born);
  async function sexChecked() {
    return page.$eval('#client-info input[value="female"]', function (el) { return el.checked; });
  }
  async function waitSex(checked) {
    await page.waitForFunction(function (want) {
      var el = document.querySelector('#client-info input[value="female"]');
      return !!el && el.checked === want;
    }, {}, checked);
  }
  await page.click('#client-info input[value="female"]');
  await waitSex(true);
  await page.click('#client-info input[value="female"]');
  await waitSex(false);
  await page.click('#client-info input[value="female"]');
  await waitSex(true);
  const femaleBox = await page.$eval('#client-info input[value="female"]', function (el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.right + 14, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(femaleBox.x, femaleBox.y);
  await waitSex(false);
  await page.focus('#client-info input[value="female"]');
  await page.keyboard.press('Space');
  await waitSex(true);
  await page.keyboard.press('Space');
  await waitSex(false);
  await page.click('#client-info input[value="female"]');
  await waitSex(true);
  assert.strictEqual(await sexChecked(), true);
  await page.$eval('#client-ft', function (el) { el.value = '5'; });
  await page.$eval('#client-in', function (el) { el.value = '8'; });
  await page.$eval('#client-lb', function (el) { el.value = '150'; });
  await page.click('#client-info input[value="Weight or fat loss"]');
  await page.click('#client-info input[value="Athletic performance"]');
  await page.click('#client-info input[value="Other"]');
  await page.type('#client-other', 'ada@example.com');
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var err = document.getElementById('client-info-err');
    return err && !err.hidden && err.textContent.indexOf('Other goals cannot include an email.') !== -1;
  });
  assert.strictEqual(await page.evaluate(function () { return window.__infoSaves || 0; }), 0);

  await page.$eval('#client-other', function (el) { el.value = 'Track a 10k'; });
  await page.click('#client-info-save');
  await page.waitForSelector('#client-info-edit');
  const read = await page.$eval('#client-info', function (el) { return el.textContent; });
  assert.ok(read.indexOf('Age 30') !== -1);
  assert.ok(read.indexOf('Female') !== -1);
  assert.ok(read.indexOf('5 ft 8 in') !== -1);
  assert.ok(read.indexOf('150 lb') !== -1);
  assert.ok(read.indexOf('Weight or fat loss') !== -1);
  assert.ok(read.indexOf('Athletic performance') !== -1);
  assert.ok(read.indexOf('Track a 10k') !== -1);
  assert.strictEqual(read.indexOf('Other'), -1);
  assert.strictEqual(read.indexOf('Building strength and muscle'), -1);
  assert.strictEqual(read.indexOf(born), -1);
  assert.strictEqual(read.indexOf('@'), -1);
  assert.strictEqual(await page.$('#client-birthday'), null);

  await page.evaluate(function () { window.__infoFail = true; location.hash = '#/'; });
  await page.waitForFunction(function () { return location.hash === '#/' || location.hash === ''; });
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForSelector('#client-info-edit');
  const kept = await page.$eval('#client-info', function (el) { return el.textContent; });
  assert.ok(kept.indexOf('Age 30') !== -1);
  assert.ok(kept.indexOf('Track a 10k') !== -1);
  assert.strictEqual(await page.$('#client-info-err'), null);
  await page.evaluate(function () { window.__infoFail = false; });

  await page.click('#client-info-edit');
  await page.waitForSelector('#client-birthday');
  await page.evaluate(function () { location.hash = '#/'; });
  await page.waitForFunction(function () { return location.hash === '#/' || location.hash === ''; });
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForSelector('#client-info-edit');
  assert.strictEqual(await page.$('#client-info-save'), null);

  await page.click('#client-info-edit');
  await page.waitForSelector('#client-lb');
  await page.$eval('#client-lb', function (el) { el.value = '160'; });
  var beforeDelay = await page.evaluate(function () { window.__saveDelay = true; return window.__infoSaves || 0; });
  await page.click('#client-info-save');
  await page.evaluate(function () { location.hash = '#/'; });
  await page.waitForFunction(function (min) {
    return location.hash !== '#/account' && (window.__infoSaves || 0) > min;
  }, {}, beforeDelay);
  await page.evaluate(function () { window.__saveDelay = false; window.__infoHold = true; location.hash = '#/account'; });
  await page.waitForFunction(function () {
    var box = document.getElementById('client-info');
    return box && box.textContent.indexOf('160 lb') !== -1 && !document.getElementById('client-info-save');
  });
  await page.evaluate(function () { window.__infoHold = false; });

  await page.click('#client-info-edit');
  await page.waitForSelector('#client-birthday');
  assert.strictEqual(await page.$eval('#client-birthday', function (el) { return el.value; }), born);
  await page.$eval('#client-other', function (el) { el.value = ''; });
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var box = document.getElementById('client-info');
    return box && box.textContent.indexOf('Other') !== -1 && box.textContent.indexOf('Track a 10k') === -1 && !document.getElementById('client-info-save');
  });
  await page.evaluate(function () { window.__infoLag = true; location.hash = '#/'; });
  await page.waitForFunction(function () { return location.hash === '#/' || location.hash === ''; });
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForSelector('#client-info-edit');
  await page.click('#client-info-edit');
  await page.waitForSelector('#client-birthday');
  await page.$eval('#client-info', function (box) {
    box.querySelectorAll('input').forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else el.value = '';
    });
  });
  var saves = await page.evaluate(function () { return window.__infoSaves || 0; });
  var deletes = await page.evaluate(function () { return window.__infoDeletes || 0; });
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var box = document.getElementById('client-info');
    return box && document.getElementById('client-birthday') && box.textContent.indexOf('Age ') === -1;
  });
  assert.strictEqual(await page.evaluate(function () { return window.__infoSaves || 0; }), saves);
  assert.strictEqual(await page.evaluate(function () { return window.__infoDeletes || 0; }), deletes + 1);
  await new Promise(function (resolve) { setTimeout(resolve, 500); });
  assert.ok(await page.$('#client-birthday'));
  assert.strictEqual(await page.$eval('#client-info', function (el) { return el.textContent.indexOf('Age '); }), -1);
  await page.evaluate(function () { window.__infoLag = false; });
  await page.$eval('#client-ft', function (el) { el.value = '0'; });
  await page.$eval('#client-in', function (el) { el.value = '0'; });
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var err = document.getElementById('client-info-err');
    return err && !err.hidden && err.textContent === 'Height must be between 1 ft and 9 ft 2 in.';
  });
  assert.strictEqual(await page.evaluate(function () { return window.__infoDeletes || 0; }), deletes + 1);
  await page.$eval('#client-ft', function (el) { el.value = ''; });
  await page.$eval('#client-in', function (el) { el.value = ''; });
  await page.$eval('#client-ft', function (el) { el.value = '-1'; });
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var err = document.getElementById('client-info-err');
    return err && !err.hidden && err.textContent === 'Enter feet from 0 to 9 and inches from 0 to 11.9.';
  });
  await page.$eval('#client-ft', function (el) { el.value = '1.5'; });
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var err = document.getElementById('client-info-err');
    return err && !err.hidden && err.textContent === 'Enter feet from 0 to 9 and inches from 0 to 11.9.';
  });
  await page.$eval('#client-ft', function (el) { el.value = '0'; });
  await page.$eval('#client-in', function (el) { el.value = '6'; });
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var err = document.getElementById('client-info-err');
    return err && !err.hidden && err.textContent === 'Height must be between 1 ft and 9 ft 2 in.';
  });
  await page.$eval('#client-ft', function (el) { el.value = ''; });
  await page.$eval('#client-in', function (el) { el.value = ''; });
  await page.$eval('#client-lb', function (el) { el.value = '2'; });
  await page.click('#client-info-save');
  await page.waitForFunction(function () {
    var err = document.getElementById('client-info-err');
    return err && !err.hidden && err.textContent === 'Weight must be between 3 and 1100 lb.';
  });
  assert.strictEqual(await page.evaluate(function () { return window.__infoSaves || 0; }), saves);
  const mapped = await page.evaluate(function () {
    window.__wbTestDb = {
      auth: {
        getSession: function () {
          return Promise.resolve({ data: { session: { user: { id: '22222222-2222-4222-8222-222222222222' } } }, error: null });
        }
      },
      from: function () {
        return {
          upsert: function () {
            return {
              select: function () {
                return Promise.resolve({
                  data: null,
                  error: { code: '23514', message: 'new row for relation "client_info" violates check constraint "client_info_height"' }
                });
              }
            };
          }
        };
      }
    };
    return WBAuth.__saveClientInfo({ birthday: null, sex: null, heightCm: 1, weightKg: 10, goals: [], goalsOther: null }).then(function () {
      return '';
    }, function (err) { return err.message; });
  });
  assert.strictEqual(mapped, 'Height must be between 1 ft and 9 ft 2 in.');

  await page.click('#account-signout');
  await page.waitForFunction(function () { return location.hash !== '#/account'; });
  await page.evaluate(function () { window.__infoDelay = true; location.hash = '#/account'; });
  await page.waitForSelector('#client-birthday');
  await page.$eval('#client-birthday', function (el) {
    el.focus();
    el.value = '1991-04-02';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(function (resolve) { setTimeout(resolve, 500); });
  assert.strictEqual(await page.$eval('#client-birthday', function (el) { return el.value; }), '1991-04-02');

  await page.evaluate(function () {
    window.__infoDelay = false;
    window.__userId = '33333333-3333-4333-8333-333333333333';
    window.__infoHold = true;
    location.hash = '#/';
  });
  await page.waitForFunction(function () { return location.hash === '#/' || location.hash === ''; });
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForSelector('#client-birthday');
  const switched = await page.$eval('#client-info', function (el) { return el.textContent; });
  assert.strictEqual(switched.indexOf('Age '), -1);
  assert.strictEqual(switched.indexOf('Track a 10k'), -1);
  await page.evaluate(function () { window.__infoHold = false; window.__infoFail = true; location.hash = '#/'; });
  await page.waitForFunction(function () { return location.hash === '#/' || location.hash === ''; });
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForFunction(function () {
    var err = document.getElementById('client-info-err');
    var box = document.getElementById('client-info');
    return err && err.textContent.indexOf('Could not load client info.') !== -1
      && box && box.textContent.indexOf('Age ') === -1 && box.textContent.indexOf('Track a 10k') === -1;
  });

  for (var i = 0; i < ['enthusiast', 'trainer', 'master_trainer'].length; i++) {
    var plan = ['enthusiast', 'trainer', 'master_trainer'][i];
    await page.goto(URL + '?plan=' + plan + '#/account');
    await page.waitForSelector('#client-info');
    const text = await page.$eval('#client-info', function (el) { return el.textContent; });
    assert.ok(text.indexOf('Birthday') !== -1 || text.indexOf('Age ') !== -1, plan);
    assert.strictEqual(await page.$('#client-info [data-client]'), null, plan);
  }

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('CLIENT INFO UI OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
