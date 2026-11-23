// All clients calendar: merged entries, first names, and database check marks.
// node tests/programs-all-clients.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';

const TRAINER = 'trainer-1';
const MIA = 'fc-mia';
const LEO = 'fc-leo';
const NINA = 'en-nina';
const OWEN = 'en-owen';
const PAT = 'fc-pat';

function exercise(name) {
  return M.normalizeExercise(M.newExercise({
    name: name, sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }));
}

function workout(name) {
  const w = M.newWorkout(name);
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Press', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

function entry(id, ownerId, wo, start, end, presence) {
  return {
    id: id, ownerId: ownerId, workoutId: wo.id, workoutName: wo.name,
    items: wo.items, date: 'TODAY', presence: presence, start: start, end: end, updatedAt: Date.now() - 120000
  };
}

function remoteEntry(id, ownerId, wo, start, end) {
  return {
    local_id: id, owner_id: ownerId, workout_local_id: wo.id, workout_name: wo.name,
    items: wo.items, day: 'TODAY', presence: 'solo', starts_at: start, ends_at: end,
    updated_at: new Date().toISOString()
  };
}

function remoteSession(clientId, programId, workoutId) {
  return {
    id: 'srv-' + programId, client_id: clientId, local_id: 'loc-' + programId,
    workout_id: workoutId, program_id: programId, local_date: 'TODAY', status: 'completed'
  };
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const own = workout('Own strength');
  const miaWo = workout('Mia legs');
  const leoWo = workout('Leo push');
  const ninaWo = workout('Nina flow');
  const owenWo = workout('Owen secret');
  const patWo = workout('Pat secret');
  patWo.id = 'pat-wo';
  const extra = workout('Extra lift');

  const roster = {
    role: 'trainer',
    clients: [
      { id: MIA, display_name: 'Mia Chen', name: 'Mia Chen', plan: 'Free Client', membership: 'free_client' },
      { id: LEO, display_name: 'Leo Brooks', name: 'Leo Brooks', plan: 'Free Client', membership: 'free_client' },
      { id: NINA, display_name: 'Nina Shah', name: 'Nina Shah', plan: 'Enthusiast', membership: 'enthusiast' },
      { id: OWEN, display_name: 'Owen Blake', name: 'Owen Blake', plan: 'Enthusiast', membership: 'enthusiast' },
      { id: PAT, display_name: 'pat@example.com', name: 'pat@example.com', email: 'pat@example.com', plan: 'Free Client', membership: 'free_client' }
    ]
  };
  const status = {
    [MIA]: { shared: false, enthusiast: false, linked: true, plan: 'Free Client' },
    [LEO]: { shared: false, enthusiast: false, linked: true, plan: 'Free Client' },
    [NINA]: { shared: true, enthusiast: true, linked: true, plan: 'Enthusiast' },
    [OWEN]: { shared: false, enthusiast: true, linked: true, plan: 'Enthusiast' },
    [PAT]: { shared: false, enthusiast: false, linked: true, plan: 'Free Client' }
  };
  const remoteRows = [remoteEntry('nina1', NINA, ninaWo, '13:00', '14:00')];
  const dbSessions = [
    remoteSession(TRAINER, 'own1', own.id),
    remoteSession(MIA, 'mia1', miaWo.id),
    remoteSession(NINA, 'nina1', ninaWo.id),
    remoteSession(OWEN, 'owen1', owenWo.id),
    remoteSession(PAT, 'pat1', 'pat-wo'),
    remoteSession(LEO, 'leo-b', leoWo.id),
    remoteSession(LEO, 'leo-c', leoWo.id),
    {
      id: 'srv-nina-extra', client_id: NINA, local_id: 'ses-nina-extra',
      workout_id: 'nina-extra', workout_name: 'Nina extra',
      program_id: '', local_date: 'TODAY', status: 'completed'
    }
  ];
  const libraries = {
    [MIA]: [{ localId: miaWo.id, name: 'Mia legs', items: [exercise('Mia curl')] }],
    [NINA]: [{ localId: 'nina-extra', name: 'Nina extra', items: [exercise('Nina hold')] }]
  };

  async function stub(page, profile, session, pageRoster) {
    await require('./allow.js').stubAuth(page, { profile: profile, session: session });
    await page.evaluateOnNewDocument(function (pack) {
      window.__wbAllCalls = { entries: [], sessions: [] };
      window.__wbClientLoads = [];
      var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
      if (!desc || !desc.set) return;
      var prev = desc.set;
      function today() {
        var now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      }
      Object.defineProperty(window, 'WBAuth', {
        configurable: true,
        enumerable: true,
        get: desc.get,
        set: function (value) {
          prev(value);
          if (!value) return;
          value.shareSetting = function () { return Promise.resolve(pack.share); };
          value.roster = function () { return Promise.resolve(pack.roster); };
          value.clientStatus = function (id) {
            if (window.__wbShareFail && window.__wbShareFail[id]) return Promise.reject(new Error('share'));
            var live = window.__wbShareLive && window.__wbShareLive[id];
            return Promise.resolve(live || pack.status[id] || { shared: false, enthusiast: false, linked: false });
          };
          value.programEntries = function () { return Promise.resolve([]); };
          value.saveProgramEntry = function () { return Promise.resolve(true); };
          value.deleteProgramEntry = function () { return Promise.resolve(true); };
          value.programEntriesFor = function (ids) {
            var list = (ids || []).slice();
            window.__wbAllCalls.entries.push(list);
            var day = today();
            return Promise.resolve(pack.remote.map(function (row) {
              var copy = JSON.parse(JSON.stringify(row));
              copy.day = day;
              return copy;
            }));
          };
          value.clientAccountWorkouts = function (id) {
            window.__wbClientLoads.push(id);
            var result = { permission: 'edit', workouts: (pack.libraries && pack.libraries[id]) || [] };
            if (window.__wbHoldLoads && window.__wbHoldLoads[id]) {
              return new Promise(function (resolve) {
                window.__wbReleaseLoads = window.__wbReleaseLoads || {};
                window.__wbReleaseLoads[id] = function () { resolve(result); };
              });
            }
            return Promise.resolve(result);
          };
          value.clientSentWorkouts = function () { return Promise.resolve([]); };
          value.clientWorkouts = function () { return Promise.resolve([]); };
          value.calendarSessions = function (ids) {
            var list = (ids || []).slice();
            window.__wbAllCalls.sessions.push(list);
            var day = today();
            return Promise.resolve(pack.sessions.filter(function (row) {
              return list.indexOf(row.client_id) >= 0;
            }).map(function (row) {
              var copy = JSON.parse(JSON.stringify(row));
              copy.local_date = day;
              return copy;
            }));
          };
        }
      });
    }, {
      roster: pageRoster,
      status: status,
      share: { on: true, enthusiast: true, linked: true },
      remote: pageRoster && pageRoster.clients ? remoteRows : [],
      sessions: dbSessions,
      libraries: libraries
    });
  }

  const trainerData = M.emptyData();
  trainerData.workouts.push(own, miaWo, leoWo, extra);
  trainerData.programs = [
    entry('own1', TRAINER, own, '07:00', '08:00', 'solo'),
    entry('pat1', PAT, patWo, '08:00', '08:30', 'solo'),
    entry('mia1', MIA, miaWo, '09:00', '10:00', 'trainer'),
    entry('leo1', LEO, leoWo, '11:00', '12:00', 'solo'),
    entry('leo-b', LEO, leoWo, '12:00', '12:30', 'solo'),
    entry('leo-c', LEO, leoWo, '12:30', '13:00', 'solo'),
    entry('owen1', OWEN, owenWo, '15:00', '16:00', 'solo')
  ];
  trainerData.programs.forEach(function (row) {
    if (row.id === 'leo1') row.items = [exercise('Leo snap')];
  });
  trainerData.sessions = [{
    id: 'ses-leo', workoutId: leoWo.id, workoutName: 'Leo push', programId: 'leo1',
    startedAt: Date.now() - 1000, endedAt: Date.now(), results: [{ logged: true, name: 'Press' }]
  }];

  const trainer = await browser.newPage();
  trainer.on('pageerror', function (err) { errors.push('trainer ' + err); });
  trainer.on('dialog', function (dialog) { dialog.accept(); });
  await trainer.setViewport(phone);
  await stub(trainer, {
    id: TRAINER, email: 'kinisiathletics@gmail.com', membership: 'trainer', intended_plan: 'trainer', display_name: 'Alex Rivera'
  }, { user: { id: TRAINER, email: 'kinisiathletics@gmail.com' } }, roster);

  async function boot(page, data) {
    await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(function (key, value) {
      var stored = JSON.parse(value);
      var now = new Date();
      var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      (stored.programs || []).forEach(function (row) { row.date = day; });
      (stored.sessions || []).forEach(function (row) { row.endedAt = Date.now(); row.startedAt = Date.now() - 1000; });
      localStorage.setItem(key, JSON.stringify(stored));
    }, M.STORAGE_KEY, JSON.stringify(data));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#programs-open');
    await page.click('#programs-open');
    await page.waitForFunction(function () {
      var root = document.getElementById('pv-root');
      return root && !document.getElementById('pv-loading') && document.querySelector('.pv-day.today');
    });
  }

  await boot(trainer, trainerData);
  await trainer.waitForFunction(function () {
    var sel = document.getElementById('pv-client');
    var today = document.querySelector('.pv-day.today');
    return sel && sel.value === 'all' && today && today.querySelector('.pv-check') && today.querySelectorAll('.pv-session').length === 8 && today.textContent.indexOf('Self') !== -1 && today.textContent.indexOf('Mia Chen') !== -1 && today.textContent.indexOf('Nina flow') === -1 && today.textContent.indexOf('Owen') === -1 && today.textContent.indexOf('@') === -1;
  });

  assert.strictEqual(await trainer.$eval('#pv-client option:checked', function (el) { return el.textContent; }), 'All clients');
  assert.deepStrictEqual(await trainer.$$eval('#pv-client option', function (els) {
    return els.map(function (el) { return el.textContent; });
  }), [
    'All clients',
    'My calendar',
    'Mia Chen · Free Client',
    'Leo Brooks · Free Client',
    'Nina Shah · Enthusiast',
    'Owen Blake · Enthusiast',
    'Client · Free Client'
  ]);
  assert.ok((await trainer.$eval('#pv-role-note', function (el) { return el.textContent; })).indexOf('every client you can see') !== -1);

  const calls = await trainer.evaluate(function () { return window.__wbAllCalls; });
  assert.ok(calls.entries.length >= 1 && calls.entries.length < 7, 'entry reads ' + calls.entries.length);
  assert.ok(calls.sessions.length >= 1 && calls.sessions.length < 7, 'session reads ' + calls.sessions.length);
  calls.entries.forEach(function (ids) {
    assert.ok(ids.indexOf(NINA) >= 0 && ids.indexOf(MIA) >= 0 && ids.indexOf(LEO) >= 0 && ids.indexOf(TRAINER) >= 0 && ids.indexOf(PAT) >= 0);
    assert.strictEqual(ids.indexOf(OWEN), -1);
  });
  calls.sessions.forEach(function (ids) {
    assert.ok(ids.indexOf(NINA) >= 0 && ids.indexOf(TRAINER) >= 0 && ids.indexOf(PAT) >= 0);
    assert.strictEqual(ids.indexOf(OWEN), -1);
  });

  const cards = await trainer.$$eval('.pv-day.today .pv-session', function (rows) {
    return rows.map(function (row) {
      var who = row.querySelector('.pv-who');
      var ico = row.querySelector('.pv-ico');
      return {
        who: who ? who.textContent : '',
        kind: ico && ico.classList.contains('trainer') ? 'trainer' : 'solo',
        extra: row.classList.contains('is-extra'),
        named: !!row.querySelector('.name')
      };
    });
  });
  assert.deepStrictEqual(cards, [
    { who: 'Self', kind: 'solo', extra: false, named: false },
    { who: 'Client', kind: 'solo', extra: false, named: false },
    { who: 'Mia Chen', kind: 'trainer', extra: false, named: false },
    { who: 'Leo Brooks', kind: 'solo', extra: false, named: false },
    { who: 'Leo Brooks', kind: 'solo', extra: false, named: false },
    { who: 'Leo Brooks', kind: 'solo', extra: false, named: false },
    { who: 'Nina Shah', kind: 'solo', extra: false, named: false },
    { who: 'Nina Shah', kind: 'solo', extra: true, named: false }
  ]);
  assert.strictEqual((await trainer.$eval('#pv-cal', function (el) { return el.textContent; })).indexOf('@'), -1);
  assert.ok(await trainer.$('.pv-day.today .pv-check'), 'day check needs every visible workout, including database sessions');
  await trainer.evaluate(function () {
    var strip = document.querySelector('.pv-week-scroll');
    var day = document.querySelector('.pv-day.today');
    if (strip && day) strip.scrollLeft = Math.max(0, day.offsetLeft + day.offsetWidth - strip.clientWidth + 12);
    if (day) day.scrollIntoView({ inline: 'nearest', block: 'center' });
  });
  await trainer.screenshot({ path: path.join(ART, 'all_clients_week.png') });

  await trainer.evaluate(function () {
    var el = document.querySelector('[data-cal=month]');
    if (el) el.scrollIntoView({ block: 'center' });
    if (el) el.click();
  });
  await trainer.waitForSelector('.pv-cell.today .pv-ico');
  const monthIcons = await trainer.$$eval('.pv-cell.today .pv-ico', function (els) {
    return els.map(function (el) { return el.classList.contains('trainer') ? 'trainer' : 'solo'; });
  });
  assert.deepStrictEqual(monthIcons, ['solo', 'solo', 'trainer', 'solo', 'solo', 'solo']);
  assert.strictEqual(await trainer.$eval('.pv-cell.today .pv-more', function (el) { return el.textContent; }), '+2');
  const monthText = await trainer.$eval('.pv-cell.today', function (el) { return el.textContent; });
  assert.strictEqual(monthText.indexOf('Mia'), -1);
  assert.strictEqual(monthText.indexOf('Nina'), -1);
  assert.strictEqual(monthText.indexOf('Self'), -1);
  assert.strictEqual(monthText.indexOf('@'), -1);
  assert.strictEqual(await trainer.$('.pv-cell.today .pv-names'), null);
  assert.strictEqual(await trainer.$('.pv-cell.today .pv-check'), null);
  assert.strictEqual(await trainer.$('.pv-cell.today .name'), null);
  const monthLabel = await trainer.$eval('.pv-cell.today', function (el) { return el.getAttribute('aria-label'); });
  assert.ok(monthLabel.indexOf('8 workouts') !== -1);
  assert.ok(monthLabel.indexOf('not scheduled') !== -1);
  assert.strictEqual(monthLabel.indexOf('@'), -1);
  assert.strictEqual(monthLabel.indexOf('Mia'), -1);
  await trainer.evaluate(function () {
    var cell = document.querySelector('.pv-cell.today');
    if (cell) cell.scrollIntoView({ block: 'center' });
  });
  await trainer.screenshot({ path: path.join(ART, 'all_clients_month.png') });

  await trainer.evaluate(function () {
    var cell = document.querySelector('.pv-cell.today');
    if (cell) cell.scrollIntoView({ block: 'center' });
    if (cell) cell.click();
  });
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row');
  const dayRows = await trainer.$$eval('#pv-day-sheet .pv-day-row', function (rows) {
    return rows.map(function (row) {
      var who = row.querySelector('.pv-row-client');
      return {
        name: row.querySelector('.name').textContent,
        who: who ? who.textContent : '',
        done: !!row.querySelector('.pv-check'),
        slot: !!(who && who.getAttribute('data-client-slot') === '1')
      };
    });
  });
  assert.deepStrictEqual(dayRows, [
    { name: 'Own strength', who: '', done: true, slot: true },
    { name: 'Pat secret', who: '', done: true, slot: true },
    { name: 'Mia legs', who: 'Mia', done: true, slot: true },
    { name: 'Leo push', who: 'Leo', done: true, slot: true },
    { name: 'Leo push', who: 'Leo', done: true, slot: true },
    { name: 'Leo push', who: 'Leo', done: true, slot: true },
    { name: 'Nina flow', who: 'Nina', done: true, slot: true },
    { name: 'Nina extra', who: 'Nina', done: true, slot: true }
  ]);
  assert.strictEqual(await trainer.$eval('#pv-day-sheet .pv-day-row', function (el) { return el.getAttribute('aria-label'); }), 'Own strength, 7:00–8:00 AM, Solo, completed');
  const ninaLabel = await trainer.$$eval('#pv-day-sheet .pv-day-row', function (rows) {
    var found = '';
    rows.forEach(function (row) {
      if (row.querySelector('.name').textContent === 'Nina flow') found = row.getAttribute('aria-label');
    });
    return found;
  });
  assert.ok(ninaLabel.indexOf('Nina flow') >= 0 && ninaLabel.indexOf('Nina') >= 0 && ninaLabel.indexOf('completed') >= 0);
  assert.strictEqual(await trainer.$eval('#pv-day-sheet .pv-day-row.is-extra .name', function (el) { return el.textContent; }), 'Nina extra');
  assert.ok(await trainer.$('#pv-day-sheet .pv-day-row.is-extra .pv-check.is-extra'));
  assert.strictEqual((await trainer.$eval('#pv-day-sheet', function (el) { return el.textContent; })).indexOf('@'), -1);
  await trainer.screenshot({ path: path.join(ART, 'all_clients_day.png') });

  async function openNamed(name) {
    await trainer.evaluate(function (wanted) {
      var rows = document.querySelectorAll('#pv-day-sheet .pv-day-row');
      for (var i = 0; i < rows.length; i++) {
        var label = rows[i].querySelector('.name');
        if (label && label.textContent === wanted) { rows[i].click(); return; }
      }
    }, name);
    await trainer.waitForSelector('#pv-day-sheet [data-view-wo]');
    await trainer.click('#pv-day-sheet [data-view-wo]');
  }
  async function expectPlayer(exerciseName) {
    await trainer.waitForSelector('.pl-name');
    await trainer.waitForSelector('#pv-not-tracked');
    return trainer.evaluate(function () {
      var player = window.__wbPlayer;
      return {
        name: document.querySelector('.pl-name').textContent,
        track: player ? player.track : null,
        id: player && player.w ? player.w.id : '',
        note: document.getElementById('pv-not-tracked').textContent,
        calendar: !!document.getElementById('pv-root')
      };
    }).then(function (seen) {
      assert.strictEqual(seen.name, exerciseName);
      assert.strictEqual(seen.track, false);
      assert.strictEqual(seen.note, 'Preview - not tracked');
      assert.strictEqual(seen.calendar, false);
      return seen;
    });
  }
  async function backToDay() {
    await trainer.evaluate(function () { history.back(); });
    await trainer.waitForFunction(function () {
      return !document.querySelector('.pl-screen') && document.querySelector('.pv-cell.today');
    });
    await trainer.evaluate(function () {
      var cell = document.querySelector('.pv-cell.today');
      if (cell) { cell.scrollIntoView({ block: 'center' }); cell.click(); }
    });
    await trainer.waitForSelector('#pv-day-sheet .pv-day-row');
  }

  await openNamed('Mia legs');
  const miaPlay = await expectPlayer('Mia curl');
  assert.strictEqual(miaPlay.id, miaWo.id);
  assert.ok((await trainer.evaluate(function () { return window.__wbClientLoads; })).indexOf(MIA) >= 0);
  assert.strictEqual((await trainer.evaluate(function () { return window.__wbClientLoads; })).indexOf(TRAINER), -1);
  await trainer.evaluate(function () {
    var el = document.querySelector('.pl-name');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await trainer.screenshot({ path: path.join(ART, 'all_clients_player.png') });
  await backToDay();

  await openNamed('Nina extra');
  const ninaPlay = await expectPlayer('Nina hold');
  assert.strictEqual(ninaPlay.id, 'nina-extra');
  await backToDay();

  await openNamed('Leo push');
  const leoPlay = await expectPlayer('Leo snap');
  assert.strictEqual(leoPlay.id, leoWo.id);
  await backToDay();

  const loadsBeforeOwn = await trainer.evaluate(function () { return window.__wbClientLoads.length; });
  await openNamed('Own strength');
  const ownPlay = await expectPlayer('Press');
  assert.strictEqual(ownPlay.id, own.id);
  assert.strictEqual(await trainer.evaluate(function () { return window.__wbClientLoads.length; }), loadsBeforeOwn);
  await backToDay();
  assert.strictEqual(await trainer.evaluate(function () {
    return (JSON.parse(localStorage.getItem('wb.data.v1')).sessions || []).length;
  }), 1);

  await trainer.evaluate(function (id) {
    window.__wbHoldLoads = {};
    window.__wbHoldLoads[id] = true;
  }, MIA);
  await openNamed('Mia legs');
  await trainer.waitForFunction(function (id) {
    return window.__wbClientLoads.indexOf(id) >= 0 && !document.querySelector('.pl-name');
  }, {}, MIA);
  await trainer.click('#back');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row.is-extra');
  await trainer.evaluate(function (id) {
    return new Promise(function (resolve) {
      if (window.__wbReleaseLoads && window.__wbReleaseLoads[id]) window.__wbReleaseLoads[id]();
      setTimeout(resolve, 80);
    });
  }, MIA);
  assert.strictEqual(await trainer.$('.pl-name'), null);
  assert.ok(await trainer.$('#pv-day-sheet .pv-day-row'));

  await trainer.evaluate(function (id) {
    window.__wbHoldLoads = {};
    window.__wbHoldLoads[id] = true;
  }, NINA);
  await openNamed('Nina extra');
  await trainer.waitForFunction(function (id) {
    return window.__wbReleaseLoads && window.__wbReleaseLoads[id] && !document.querySelector('.pl-name');
  }, {}, NINA);
  await trainer.click('#back');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row');
  await openNamed('Mia legs');
  const kept = await expectPlayer('Mia curl');
  assert.strictEqual(kept.id, miaWo.id);
  await trainer.evaluate(function (id) {
    return new Promise(function (resolve) {
      if (window.__wbReleaseLoads && window.__wbReleaseLoads[id]) window.__wbReleaseLoads[id]();
      setTimeout(resolve, 80);
    });
  }, NINA);
  const still = await expectPlayer('Mia curl');
  assert.strictEqual(still.id, miaWo.id);
  await backToDay();

  await trainer.click('[data-sheet=add-day]');
  await trainer.waitForSelector('#pv-add-who');
  const addPeople = await trainer.$$eval('#pv-add-who option', function (els) {
    return els.map(function (el) { return el.textContent; });
  });
  assert.deepStrictEqual(addPeople, ['Me', 'Mia Chen', 'Leo Brooks', 'Nina Shah', 'Client']);
  assert.strictEqual(await trainer.$eval('#pv-add-who', function (el) { return el.options[el.selectedIndex].textContent; }), 'Me');
  await trainer.select('#pv-add-who', LEO);
  await trainer.evaluate(function () {
    var picks = document.querySelectorAll('#pv-sheet .pv-pick');
    for (var i = 0; i < picks.length; i++) {
      if (picks[i].textContent.indexOf('Extra lift') !== -1) { picks[i].click(); return; }
    }
  });
  await trainer.click('#pv-sheet .pv-presence input[value="solo"]');
  await trainer.click('[data-sheet=save]');
  await trainer.waitForFunction(function () {
    var rows = JSON.parse(localStorage.getItem('wb.data.v1')).programs || [];
    return rows.some(function (row) { return row.workoutName === 'Extra lift' && row.ownerId === 'fc-leo'; });
  });
  const stored = await trainer.evaluate(function () { return JSON.parse(localStorage.getItem('wb.data.v1')).programs; });
  const extraRow = stored.filter(function (row) { return row.workoutName === 'Extra lift'; })[0];
  assert.strictEqual(extraRow.ownerId, LEO);
  assert.strictEqual(stored.filter(function (row) { return row.id === 'mia1'; })[0].ownerId, MIA);
  await trainer.waitForFunction(function () {
    var hit = false;
    document.querySelectorAll('#pv-day-sheet .pv-day-row').forEach(function (row) {
      var who = row.querySelector('.pv-row-client');
      if (row.textContent.indexOf('Extra lift') !== -1 && who && who.textContent === 'Leo') hit = true;
    });
    return hit;
  });

  await trainer.click('#back');
  await trainer.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await trainer.evaluate(function () {
    var el = document.querySelector('[data-cal=week]');
    if (el) el.click();
  });
  await trainer.waitForSelector('.pv-day.today');
  await trainer.select('#pv-client', MIA);
  await trainer.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today');
    return document.getElementById('pv-client').value === 'fc-mia' && today &&
      today.textContent.indexOf('Mia legs') !== -1 && today.textContent.indexOf('Nina flow') === -1 &&
      today.textContent.indexOf('Own strength') === -1;
  });
  assert.strictEqual(await trainer.$eval('.pv-day.today .pv-who', function (el) { return el.textContent; }), 'Mia');
  assert.ok(await trainer.$('.pv-day.today .pv-check'));
  await trainer.click('.pv-day.today .pv-day-h');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row');
  const miaRows = await trainer.$$eval('#pv-day-sheet .pv-day-row', function (rows) {
    return rows.map(function (row) {
      return row.querySelector('.name').textContent + ' ' + row.querySelector('.pv-row-client').textContent;
    });
  });
  assert.deepStrictEqual(miaRows, ['Mia legs Mia']);
  await trainer.click('[data-sheet=add-day]');
  await trainer.waitForSelector('#pv-sheet .pv-pick');
  assert.strictEqual(await trainer.$('#pv-add-who'), null);
  await trainer.click('[data-sheet=cancel]');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row');
  await trainer.click('#back');
  await trainer.waitForFunction(function () { return !document.getElementById('pv-sheet'); });

  await trainer.select('#pv-client', '');
  await trainer.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today');
    return document.getElementById('pv-client').value === '' && today &&
      today.textContent.indexOf('Own strength') !== -1 && today.textContent.indexOf('Mia legs') === -1 &&
      today.textContent.indexOf('Nina flow') === -1;
  });
  assert.strictEqual(await trainer.$('.pv-day.today .pv-who'), null);

  function sessionCallsSince(start) {
    return trainer.evaluate(function (from) {
      return window.__wbAllCalls.sessions.slice(from);
    }, start);
  }
  // A newer single-client share read replaces the All clients snapshot.
  await trainer.evaluate(function (id) {
    window.__wbShareLive = {};
    window.__wbShareLive[id] = { shared: true, enthusiast: true, linked: true };
  }, OWEN);
  var owenCalls = await trainer.evaluate(function () { return window.__wbAllCalls.sessions.length; });
  await trainer.select('#pv-client', OWEN);
  await trainer.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today');
    return document.getElementById('pv-client').value === 'en-owen' && !document.getElementById('pv-private') &&
      today && today.textContent.indexOf('Owen secret') !== -1;
  });
  var owenAsked = await sessionCallsSince(owenCalls);
  assert.ok(owenAsked.some(function (ids) { return ids.indexOf(OWEN) >= 0; }));

  await trainer.evaluate(function (id) {
    window.__wbShareLive[id] = { shared: false, enthusiast: true, linked: true };
  }, NINA);
  var ninaOff = await trainer.evaluate(function () { return window.__wbAllCalls.sessions.length; });
  await trainer.select('#pv-client', NINA);
  await trainer.waitForSelector('#pv-private');
  (await sessionCallsSince(ninaOff)).forEach(function (ids) {
    assert.strictEqual(ids.indexOf(NINA), -1);
  });

  await trainer.select('#pv-client', '');
  await trainer.waitForFunction(function () { return document.getElementById('pv-client').value === ''; });
  await trainer.evaluate(function (id) {
    window.__wbShareFail = {};
    window.__wbShareFail[id] = true;
  }, NINA);
  var ninaFail = await trainer.evaluate(function () { return window.__wbAllCalls.sessions.length; });
  await trainer.select('#pv-client', NINA);
  await trainer.waitForSelector('#pv-private');
  (await sessionCallsSince(ninaFail)).forEach(function (ids) {
    assert.strictEqual(ids.indexOf(NINA), -1);
  });

  const ninaData = M.emptyData();
  ninaData.workouts.push(ninaWo);
  ninaData.programs = [entry('nina1', NINA, ninaWo, '13:00', '14:00', 'solo')];
  ninaData.sessions = [];
  const client = await browser.newPage();
  client.on('pageerror', function (err) { errors.push('client ' + err); });
  await client.setViewport(phone);
  await stub(client, {
    id: NINA, email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast', display_name: 'Nina Shah'
  }, { user: { id: NINA, email: 'kinisiathletics@gmail.com' } }, { role: null, clients: [] });
  await boot(client, ninaData);
  await client.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today');
    return today && today.textContent.indexOf('Nina flow') !== -1 && document.querySelector('.pv-day.today .pv-check');
  });
  assert.strictEqual(await client.$('#pv-client'), null);
  assert.strictEqual(await client.$('.pv-who'), null);
  assert.ok((await client.$eval('#app', function (el) { return el.textContent; })).indexOf('All clients') === -1);
  assert.ok((await client.$eval('#app', function (el) { return el.textContent; })).indexOf('Owen secret') === -1);
  assert.ok((await client.$eval('#app', function (el) { return el.textContent; })).indexOf('Mia legs') === -1);
  const localSessions = await client.evaluate(function (key) {
    return JSON.parse(localStorage.getItem(key)).sessions || [];
  }, M.STORAGE_KEY);
  assert.strictEqual(localSessions.length, 0);
  await client.click('.pv-day.today .pv-day-h');
  await client.waitForSelector('#pv-day-sheet .pv-day-row .pv-check');
  assert.strictEqual(await client.$eval('#pv-day-sheet .pv-row-client', function (el) { return el.textContent; }), '');
  await client.click('#back');
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await client.evaluate(function () {
    var strip = document.querySelector('.pv-week-scroll');
    if (strip) strip.scrollLeft = strip.scrollWidth;
    var day = document.querySelector('.pv-day.today');
    if (day) day.scrollIntoView({ inline: 'center', block: 'center' });
  });
  await client.screenshot({ path: path.join(ART, 'all_clients_client.png') });

  assert.deepStrictEqual(errors, []);
  console.log('ALL CLIENTS OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
