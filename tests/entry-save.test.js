// A missing times column must still be reported when the invite column is
// missing too and there is nobody to invite. No live database.
const assert = require('assert');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto(URL);
  await page.waitForFunction(function () { return window.WBAuth && window.WBAuth.saveProgramEntry; });
  const result = await page.evaluate(function () {
    var calls = [];
    function fail(message) { return { error: { message: message } }; }
    window.__wbTestDb = {
      from: function () {
        return {
          upsert: function (row) {
            calls.push(row);
            if (row.starts_at) return Promise.resolve(fail("Could not find the 'starts_at' column of 'program_entries' in the schema cache"));
            if (row.invitees) return Promise.resolve(fail("Could not find the 'invitees' column of 'program_entries' in the schema cache"));
            return Promise.resolve({ data: null, error: null });
          }
        };
      }
    };
    return window.WBAuth.saveProgramEntry({
      ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      id: 'pg-times',
      workoutId: 'push',
      workoutName: 'Push',
      date: '2026-11-25',
      start: '09:00',
      end: '10:00',
      presence: 'solo',
      invites: []
    }).then(function () {
      return { ok: true, calls: calls.length };
    }, function (err) {
      return { ok: false, message: err && err.message, timesLocal: !!(err && err.timesLocal), calls: calls.length };
    });
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.timesLocal, true);
  assert.ok(result.message.indexOf('program times SQL') !== -1);
  assert.ok(result.calls >= 3);
  await browser.close();
  console.log('ENTRY SAVE OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
