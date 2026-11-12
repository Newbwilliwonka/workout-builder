/* Programs calendar. Real workouts and real tracking. No sample people. */
(function () {
  'use strict';
  var P = window.WBPrograms;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var app = null, titleEl = null, backBtn = null, options = null, state = null, drag = null, loadToken = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function data() { return options && options.data; }
  function todayIso() { return P.iso(new Date()); }
  function fresh() {
    var today = todayIso();
    return {
      view: 'week',
      cursor: today,
      month: today.slice(0, 7),
      screen: 'home',
      playerMode: 'view',
      focusWorkout: null,
      focusEntry: null,
      clientId: '',
      clients: [],
      profile: null,
      userId: '',
      role: 'none',
      shareOn: null,
      clientShare: null,
      hint: '',
      ready: false,
      remote: '',
      playerLive: false,
      sheet: null
    };
  }
  function ownerId() {
    if (!state) return 'self';
    if (P.isTrainer(state.role)) return state.clientId || '';
    return state.userId || 'self';
  }
  function context() {
    var self = state.userId || 'self';
    var owner = ownerId();
    var plan = 'free_client';
    var linked = false;
    var shareOn = false;
    if (P.isTrainer(state.role)) {
      var client = null;
      state.clients.forEach(function (row) { if (row.id === state.clientId) client = row; });
      plan = P.ownerPlanOf(client);
      linked = !!client;
      shareOn = !!(state.clientShare && state.clientShare.shared === true);
      if (state.clientShare && state.clientShare.enthusiast === true) plan = 'enthusiast';
    }
    return { role: state.role, self: self, ownerId: owner, ownerPlan: plan, linked: linked, shareOn: state.role === 'enthusiast' ? state.shareOn === true : shareOn };
  }
  function canEdit() { return !!state && state.ready && P.canEdit(context()); }
  function canSee() { return !!state && state.ready && P.canSee(context()); }
  function workouts() {
    var rows = data() && data().workouts;
    return Array.isArray(rows) ? rows : [];
  }
  function sessions() {
    if (options && options.sessions) {
      try { return options.sessions() || []; } catch (e) { return []; }
    }
    var rows = data() && data().sessions;
    return Array.isArray(rows) ? rows : [];
  }
  function entries() {
    var rows = data() && data().programs;
    return P.forOwner(rows, ownerId());
  }
  function workoutById(id) {
    var found = null;
    workouts().forEach(function (row) { if (row && row.id === id) found = row; });
    if (found) return found;
    var snap = null;
    entries().forEach(function (row) { if (row && row.workoutId === id) snap = row; });
    if (!snap) return null;
    return { id: snap.workoutId, name: snap.workoutName || 'Workout', items: snap.items || [] };
  }
  function entryById(id) {
    var found = null;
    entries().forEach(function (row) { if (row && row.id === id) found = row; });
    return found;
  }
  function savePrograms(next, hint) {
    if (!data()) return;
    data().programs = next;
    if (options.persist) options.persist();
    state.hint = hint || 'Saved on this device.';
  }
  function remoteNote(err) {
    var msg = String(err && err.message || '');
    if ((err && err.timesLocal) || /program times SQL|starts_at|ends_at/i.test(msg)) {
      return 'Saved on this device. Start and end times will be shared after the new program times SQL is applied.';
    }
    return 'Saved on this device. The shared calendar waits until the programs SQL is applied.';
  }
  function pushRemote(row) {
    if (!row || !options.saveEntry || !P.isUuid(row.ownerId)) return;
    Promise.resolve().then(function () { return options.saveEntry(row); }).then(function () {
      if (state) state.remote = '';
    }, function (err) {
      if (!state) return;
      state.remote = remoteNote(err);
      render();
    });
  }
  function dropRemote(row) {
    if (!row || !options.deleteEntry || !P.isUuid(row.ownerId)) return;
    Promise.resolve().then(function () { return options.deleteEntry(row); }).then(function () {
      if (state) state.remote = '';
    }, function (err) {
      if (!state) return;
      state.remote = remoteNote(err);
      render();
    });
  }
  function pullRemote() {
    var owner = ownerId();
    if (!options.loadEntries || !P.isUuid(owner)) return;
    var token = loadToken;
    Promise.resolve().then(function () { return options.loadEntries(owner); }).then(function (rows) {
      if (!state || token !== loadToken || !Array.isArray(rows)) return;
      data().programs = P.merge(data().programs, rows, owner, { keepLocalTimes: !!rows.timesPending });
      if (rows.timesPending) state.remote = remoteNote({ timesLocal: true });
      if (options.persist) options.persist();
      render();
    }, function (err) {
      if (!state || token !== loadToken) return;
      state.remote = remoteNote(err);
      render();
    });
  }
  function presenceLabel(kind) { return kind === 'trainer' ? 'Trainer present' : 'Solo'; }
  function ico(kind) {
    var path = kind === 'trainer'
      ? 'M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM9 13c-2.8 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.8 13 9 13zm7 .5c-.4 0-.8 0-1.2.1 1.3.8 2.2 1.9 2.2 3.2V19h5v-2c0-1.8-2.5-3.5-6-3.5z'
      : 'M12 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4z';
    return '<span class="pv-ico ' + kind + '" title="' + esc(presenceLabel(kind)) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg></span>';
  }
  function check() { return '<span class="pv-check" aria-label="Completed">✓</span>'; }
  function onDay(date) { return P.byStart(entries().filter(function (row) { return row.date === date; })); }
  function dragAttrs(kind, id, label) {
    if (!canEdit()) return '';
    return ' data-drag="' + esc(id) + '" data-drag-kind="' + kind + '" data-label="' + esc(label) + '"';
  }
  function workoutCard(w) {
    var n = (w.items || []).length;
    var name = w.name || 'Workout';
    return '<div class="card pv-pick-card"' + dragAttrs('workout', w.id, name) + ' data-wo="' + esc(w.id) + '"><div class="pv-session-top">' +
      (canEdit() ? '<span class="pv-handle" aria-hidden="true">⋮⋮</span>' : '') +
      '<div class="name">' + esc(name) + '</div></div>' +
      '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + '</div></div>';
  }
  function sessionCard(row) {
    var live = workoutById(row.workoutId);
    var name = live ? live.name : (row.workoutName || 'Workout');
    var kind = row.presence === 'trainer' ? 'trainer' : 'solo';
    var when = P.formatRange(row.start, row.end);
    var icon = canEdit()
      ? '<button type="button" class="pv-ico ' + kind + '" data-presence="' + esc(row.id) + '" aria-label="' + esc(presenceLabel(kind)) + '. Change it."><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + (kind === 'trainer'
        ? 'M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM9 13c-2.8 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.8 13 9 13zm7 .5c-.4 0-.8 0-1.2.1 1.3.8 2.2 1.9 2.2 3.2V19h5v-2c0-1.8-2.5-3.5-6-3.5z'
        : 'M12 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4z') + '"/></svg></button>'
      : ico(kind);
    return '<div class="card pv-session" data-open-session="' + esc(row.id) + '"' + dragAttrs('session', row.id, name) + '><div class="pv-session-top">' +
      (canEdit() ? '<span class="pv-handle" aria-hidden="true">⋮⋮</span>' : '') +
      icon + '</div>' +
      '<div class="name">' + esc(name) + '</div>' +
      (when ? '<div class="pv-when">' + esc(when) + '</div>' : '') +
      '<div class="mute">' + esc(presenceLabel(kind)) + '</div></div>';
  }
  function legendHtml() {
    return '<div class="pv-legend"><span>' + ico('trainer') + 'Trainer present</span><span>' + ico('solo') + 'Solo</span><span>' + check() + 'Completed</span></div>';
  }
  function weekHtml() {
    var start = P.weekStart(state.cursor);
    var end = new Date(start.getTime());
    end.setDate(start.getDate() + 6);
    var label = start.getMonth() === end.getMonth()
      ? MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getDate() + ' – ' + end.getDate() + ', ' + start.getFullYear()
      : MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getDate() + ' – ' + MONTHS[end.getMonth()].slice(0, 3) + ' ' + end.getDate() + ', ' + end.getFullYear();
    var tracked = sessions();
    var h = '<div class="row pv-nav"><button type="button" class="sm" data-shift="-1" data-unit="week" aria-label="Previous week">‹</button>' +
      '<div class="grow name" id="pv-range">' + esc(label) + '</div>' +
      '<button type="button" class="sm" data-shift="1" data-unit="week" aria-label="Next week">›</button></div>' +
      '<div class="pv-week-scroll"><div class="pv-week">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      var date = P.iso(d);
      var items = onDay(date);
      var today = date === todayIso();
      h += '<div class="pv-day' + (today ? ' today' : '') + '" data-date="' + date + '"' + (canEdit() ? ' data-add-day="' + date + '"' : '') + '"><div class="pv-day-h"><div><div class="pv-dow">' + DOWS[i] + '</div><div class="pv-num">' + d.getDate() + (today ? '<span class="pv-today-label mute"> Today</span>' : '') + '</div></div>' +
        (P.dayDone(items, tracked) ? check() : '') + '</div>';
      items.forEach(function (row) { h += sessionCard(row); });
      if (!items.length && canEdit()) h += '<div class="mute pv-drop">Drop here</div>';
      h += '</div>';
    }
    return h + '</div></div>';
  }
  function monthHtml() {
    var parts = state.month.split('-');
    var year = Number(parts[0]), month = Number(parts[1]) - 1;
    var first = new Date(year, month, 1);
    var start = P.weekStart(P.iso(first));
    var tracked = sessions();
    var h = '<div class="row pv-nav"><button type="button" class="sm" data-shift="-1" data-unit="month" aria-label="Previous month">‹</button>' +
      '<div class="grow name" id="pv-range">' + esc(MONTHS[month] + ' ' + year) + '</div>' +
      '<button type="button" class="sm" data-shift="1" data-unit="month" aria-label="Next month">›</button></div>' +
      '<div class="pv-dows">' + DOWS.map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div><div class="pv-month">';
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      var date = P.iso(d);
      var items = onDay(date);
      var outside = d.getMonth() !== month;
      var done = P.dayDone(items, tracked);
      var kinds = {};
      items.forEach(function (row) { kinds[row.presence === 'trainer' ? 'trainer' : 'solo'] = 1; });
      var icons = '';
      if (kinds.trainer) icons += ico('trainer');
      if (kinds.solo) icons += ico('solo');
      h += '<button type="button" class="pv-cell' + (outside ? ' is-out' : '') + (date === todayIso() ? ' today' : '') + (items.length ? ' has' : '') + '" data-month-day="' + date + '" data-date="' + date + '" aria-label="' + esc(DOWS[(d.getDay() + 6) % 7] + ' ' + d.getDate()) + '">' +
        '<span class="pv-num">' + d.getDate() + '</span><span class="pv-marks">' + icons + (done ? check() : '') + '</span></button>';
    }
    return h + '</div>';
  }
  function noteHtml() {
    if (!state.ready) return '';
    if (state.role === 'free_client') return '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer schedules your program</p></div>';
    if (state.role === 'enthusiast' && state.shareOn === true) return '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer can also edit this calendar</p></div>';
    if (state.role === 'enthusiast' && state.shareOn === false) return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is off. Your trainer cannot see or edit this calendar.</p></div>';
    if (P.isTrainer(state.role) && state.clientShare && state.clientShare.shared === true) {
      return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is on, so you can drag and schedule workouts on this calendar.</p></div>';
    }
    if (P.isTrainer(state.role) && canEdit()) return '<div class="card" id="pv-role-note"><p style="margin:0">You can drag and move workouts on this client’s calendar.</p></div>';
    return '';
  }
  function clientPicker() {
    if (!P.isTrainer(state.role)) return '';
    if (!state.clients.length) return '<div class="card"><div class="name">No clients yet</div><p class="mute">Invite a client from Account, then their calendar shows up here.</p></div>';
    var h = '<label class="mute" for="pv-client">Client</label><select id="pv-client">';
    state.clients.forEach(function (client) {
      h += '<option value="' + esc(client.id) + '"' + (client.id === state.clientId ? ' selected' : '') + '>' + esc(client.email || 'Client') + ' · ' + esc(client.plan || 'Free Client') + '</option>';
    });
    return h + '</select>';
  }
  function homeHtml() {
    var hidden = state.ready && !canSee();
    var h = '<div id="pv-root" data-role-now="' + esc(state.role) + '">' + clientPicker() + noteHtml();
    if (state.remote) h += '<p class="mute" id="pv-remote">' + esc(state.remote) + '</p>';
    if (state.hint) h += '<p class="mute" id="pv-hint">' + esc(state.hint) + '</p>';
    if (!state.ready) return h + '<p class="mute" id="pv-loading">Loading…</p></div>';
    if (P.isTrainer(state.role) && !state.clients.length) return h + '</div>';
    if (hidden) {
      return h + '<div class="card" id="pv-private"><div class="name">Not shared</div><p class="mute">This Enthusiast has turned off sharing. You cannot see or edit their program.</p></div></div>';
    }
    var list = workouts();
    h += '<div class="pv-layout" id="pv-layout"><section class="pv-workouts" id="pv-workouts" aria-label="Workouts"><h2 class="pv-h">Workouts</h2><div class="pv-rail" id="pv-rail">';
    if (!list.length) h += '<p class="mute">No workouts yet. Build one from the workout list, then drag it onto a day.</p>';
    list.forEach(function (row) { h += workoutCard(row); });
    h += '</div></section><section class="pv-cal" id="pv-cal" aria-label="Programs"><h2 class="pv-h">Programs</h2>' +
      '<p class="mute">Workouts scheduled on a calendar. A check is a day you actually tracked.</p>' +
      (canEdit() ? '<p class="mute" id="pv-schedule-hint">Drag a workout onto a day, or tap a day to choose one.</p>' : '') +
      '<div class="seg" id="pv-range-switch" role="group" aria-label="Week or month"><button type="button" data-cal="week" class="' + (state.view === 'week' ? 'on' : '') + '">Week</button>' +
      '<button type="button" data-cal="month" class="' + (state.view === 'month' ? 'on' : '') + '">Month</button></div>' +
      legendHtml() + (state.view === 'month' ? monthHtml() : weekHtml()) + '</section></div>' + sheetHtml() + '</div>';
    return h;
  }
  function prettyDate(value) {
    var d = P.parseDate(value);
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (!d || isNaN(d.getTime())) return value || '';
    return days[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }
  function sheetHtml() {
    if (!state.sheet) return '';
    if (state.sheet.type === 'add') return addSheetHtml();
    if (state.sheet.type === 'menu') return menuSheetHtml();
    if (state.sheet.type === 'day') return daySheetHtml();
    return '';
  }
  function daySheetHtml() {
    var date = state.sheet.date;
    var items = onDay(date);
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" id="pv-day-sheet" role="dialog" aria-label="This day">' +
      '<h3 class="name">' + esc(prettyDate(date)) + '</h3>';
    if (!items.length) h += '<p class="mute" id="pv-empty-day">Nothing scheduled</p>';
    items.forEach(function (row) {
      var live = workoutById(row.workoutId);
      var name = live ? (live.name || 'Workout') : (row.workoutName || 'Workout');
      var when = P.formatRange(row.start, row.end);
      h += '<button type="button" class="pv-day-row" data-open-session="' + esc(row.id) + '"><span class="name">' + esc(name) + '</span>' +
        (when ? '<span class="pv-when">' + esc(when) + '</span>' : '<span class="mute">No time set</span>') + '</button>';
    });
    if (canEdit()) h += '<button type="button" class="pri" data-sheet="add-day">Add workout</button>';
    return h + '<button type="button" data-sheet="cancel">Close</button></div></div>';
  }
  function addSheetHtml() {
    var sheet = state.sheet;
    var list = workouts();
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" role="dialog" aria-label="Add a workout">' +
      '<h3 class="name">Add a workout</h3><p class="mute">' + esc(prettyDate(sheet.date)) + '</p>';
    if (!list.length) h += '<p class="mute">No workouts yet. Build one from the workout list first.</p>';
    h += '<div class="pv-picks" role="listbox" aria-label="Your workouts">';
    list.forEach(function (w) {
      var n = (w.items || []).length;
      h += '<button type="button" class="pv-pick' + (w.id === sheet.workoutId ? ' on' : '') + '" data-pick="' + esc(w.id) + '"><span class="name">' + esc(w.name || 'Workout') + '</span><span class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + '</span></button>';
    });
    h += '</div><label for="pv-start">Start</label><input id="pv-start" type="time" value="' + esc(sheet.start || '') + '">' +
      '<label for="pv-end">End</label><input id="pv-end" type="time" value="' + esc(sheet.end || '') + '">';
    if (sheet.error) h += '<p class="errs" id="pv-sheet-error">' + esc(sheet.error) + '</p>';
    return h + '<button type="button" class="pri" data-sheet="save">Add to this day</button><button type="button" data-sheet="cancel">Cancel</button></div></div>';
  }
  function menuSheetHtml() {
    var sheet = state.sheet;
    var entry = entryById(sheet.entryId);
    if (!entry) return '';
    var workout = workoutById(entry.workoutId);
    var name = workout ? (workout.name || 'Workout') : (entry.workoutName || 'Workout');
    var actions = P.entryMenu(context());
    var editing = actions.indexOf('remove') >= 0;
    var when = P.formatRange(entry.start, entry.end);
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" role="dialog" aria-label="Scheduled workout">' +
      '<h3 class="name">' + esc(name) + '</h3><p class="mute">' + esc(prettyDate(entry.date)) + ' · ' + esc(presenceLabel(entry.presence)) + '</p>';
    if (editing) {
      h += '<label for="pv-start">Start</label><input id="pv-start" type="time" value="' + esc(sheet.start || '') + '">' +
        '<label for="pv-end">End</label><input id="pv-end" type="time" value="' + esc(sheet.end || '') + '">';
    } else if (when) h += '<p class="pv-when" id="pv-when">' + esc(when) + '</p>';
    if (sheet.error) h += '<p class="errs" id="pv-sheet-error">' + esc(sheet.error) + '</p>';
    if (actions.indexOf('run') >= 0) h += '<button type="button" class="pri" data-run="' + esc(entry.workoutId) + '" data-entry="' + esc(entry.id) + '">Run</button>';
    if (actions.indexOf('view') >= 0) h += '<button type="button" data-view-wo="' + esc(entry.workoutId) + '" data-entry="' + esc(entry.id) + '">View</button>';
    if (editing) h += '<button type="button" data-sheet="times">Save times</button>';
    if (actions.indexOf('remove') >= 0) h += '<button type="button" class="danger" data-sheet="remove">Remove workout</button>';
    if (actions.indexOf('add') >= 0) h += '<button type="button" data-sheet="add">Add workout</button>';
    return h + '</div></div>';
  }
  function playable(id) {
    var workout = workoutById(id);
    if (!workout) return null;
    if (workout.items && workout.items.length && window.WB && WB.normalizeExercise) {
      workout = {
        id: workout.id,
        name: workout.name,
        items: workout.items.map(function (item) {
          try { return WB.normalizeExercise(item); } catch (e) { return item; }
        })
      };
    }
    return workout;
  }
  function closeRealPlayer() {
    if (state && state.playerLive && window.WBPlayer) {
      state.playerLive = false;
      WBPlayer.unmount();
    }
    document.body.classList.remove('playing');
  }
  function leavePlayer() {
    if (!state) return;
    if (options && options.onTracked) options.onTracked();
    state.playerLive = false;
    state.screen = 'home';
    if (window.WBPlayer) WBPlayer.unmount();
    render();
  }
  function openRealPlayer(track) {
    if (state.playerLive) return;
    var workout = playable(state.focusWorkout);
    if (!workout || !workout.items || !workout.items.length || !window.WBPlayer) {
      state.screen = 'home';
      state.playerLive = false;
      state.hint = 'Add an exercise before running this workout.';
      render();
      return;
    }
    state.playerLive = true;
    app.innerHTML = '';
    app.onclick = null;
    app.onchange = null;
    app.onpointerdown = null;
    window.__wbClockOffset = 0;
    var scratch = { version: 4, workouts: [], sessions: [] };
    var opts = { track: track !== false };
    if (track !== false && state.focusEntry) opts.programId = state.focusEntry;
    WBPlayer.mount(app, workout, scratch, function () {}, leavePlayer, opts);
    window.scrollTo(0, 0);
  }
  function applyChrome() {
    if (titleEl) titleEl.textContent = 'Programs';
    if (backBtn) backBtn.hidden = false;
  }
  function render() {
    if (!app || !state) return;
    document.body.classList.add('pv-on');
    if (state.screen === 'player') {
      openRealPlayer(state.playerMode !== 'view');
      applyChrome();
      return;
    }
    closeRealPlayer();
    app.innerHTML = homeHtml();
    applyChrome();
    app.onclick = onClick;
    app.onchange = onChange;
    app.onpointerdown = onPointerDown;
  }
  function clearDrag() {
    if (drag) {
      document.removeEventListener('pointermove', drag.move);
      document.removeEventListener('pointerup', drag.up);
      document.removeEventListener('pointercancel', drag.up);
      if (drag.raf) cancelAnimationFrame(drag.raf);
    }
    drag = null;
    var floatEl = document.getElementById('pv-float');
    if (floatEl) floatEl.remove();
    var nodes = document.querySelectorAll('.pv-over');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('pv-over');
  }
  function openDay(date) {
    var items = onDay(date);
    if (!items.length && canEdit()) {
      openAdd(date);
      return;
    }
    state.sheet = { type: 'day', date: date };
    state.hint = '';
    render();
  }
  function openAdd(date, workoutId) {
    state.sheet = { type: 'add', date: date, workoutId: workoutId || '', start: '09:00', end: '10:00', error: '' };
    state.hint = '';
    render();
  }
  function openMenu(entry) {
    if (!entry) return;
    state.sheet = {
      type: 'menu',
      entryId: entry.id,
      start: entry.start || '09:00',
      end: entry.end || '10:00',
      error: ''
    };
    state.focusEntry = entry.id;
    render();
  }
  function readSheetTimes() {
    if (!state || !state.sheet) return;
    var startEl = document.getElementById('pv-start');
    var endEl = document.getElementById('pv-end');
    if (startEl) state.sheet.start = startEl.value;
    if (endEl) state.sheet.end = endEl.value;
  }
  function confirmAdd() {
    readSheetTimes();
    var sheet = state.sheet;
    if (!sheet || sheet.type !== 'add' || !data()) return;
    if (!sheet.workoutId) { sheet.error = 'Pick a workout.'; render(); return; }
    var times = P.validTimes(sheet.start, sheet.end);
    if (!times.ok) { sheet.error = times.error; render(); return; }
    var workout = workoutById(sheet.workoutId);
    if (!workout) { sheet.error = 'Pick a workout.'; render(); return; }
    var placed = P.place(data().programs, {
      id: window.WB.uid('pg'),
      ownerId: ownerId(),
      workoutId: workout.id,
      workoutName: workout.name,
      items: workout.items,
      date: sheet.date,
      start: times.start,
      end: times.end,
      presence: P.isTrainer(state.role) ? 'trainer' : 'solo'
    });
    if (placed.duplicate) { sheet.error = 'That workout is already on this day.'; render(); return; }
    if (!placed.created) { sheet.error = placed.error || 'Pick a workout.'; render(); return; }
    state.sheet = null;
    state.cursor = sheet.date;
    state.month = sheet.date.slice(0, 7);
    savePrograms(placed.programs, 'Saved on this device.');
    pushRemote(placed.created);
    render();
  }
  function saveMenuTimes() {
    readSheetTimes();
    var sheet = state.sheet;
    if (!sheet || sheet.type !== 'menu' || !data()) return false;
    var result = P.setTimes(data().programs, sheet.entryId, sheet.start, sheet.end);
    if (result.error) { sheet.error = result.error; render(); return false; }
    sheet.error = '';
    if (result.changed) {
      sheet.start = result.changed.start;
      sheet.end = result.changed.end;
      savePrograms(result.programs, 'Saved on this device.');
      pushRemote(result.changed);
    }
    return true;
  }
  function removeScheduled() {
    var sheet = state.sheet;
    if (!sheet || !data()) return;
    var result = P.remove(data().programs, sheet.entryId);
    state.sheet = null;
    if (!result.removed) { render(); return; }
    savePrograms(result.programs, 'Removed from this day.');
    dropRemote(result.removed);
    render();
  }
  function dropOn(kind, id, date) {
    if (!canEdit() || !date || !data()) return;
    if (kind === 'session') {
      var result = P.move(data().programs, id, date);
      if (result.duplicate) {
        state.hint = 'That workout is already on this day.';
        render();
        return;
      }
      if (!result.moved) return;
      savePrograms(result.programs, 'Saved on this device.');
      pushRemote(result.moved);
      if (!result.moved.start || !result.moved.end) openMenu(result.moved);
      else render();
      return;
    }
    var workout = workoutById(id);
    if (!workout) return;
    openAdd(date, workout.id);
  }
  function edgeScroll() {
    if (!drag || !drag.last) return;
    var ev = drag.last;
    var edge = 56;
    var speed = 16;
    if (ev.clientY < edge) window.scrollBy(0, -speed);
    else if (ev.clientY > window.innerHeight - edge) window.scrollBy(0, speed);
    var rail = document.getElementById('pv-rail');
    if (rail) {
      var box = rail.getBoundingClientRect();
      if (ev.clientY >= box.top - 12 && ev.clientY <= box.bottom + 12) {
        if (ev.clientX < box.left + edge) rail.scrollLeft -= speed;
        else if (ev.clientX > box.right - edge) rail.scrollLeft += speed;
      }
    }
    var strip = document.querySelector('.pv-week-scroll');
    if (strip && strip.scrollWidth > strip.clientWidth + 2) {
      var sb = strip.getBoundingClientRect();
      if (ev.clientY >= sb.top - 12 && ev.clientY <= sb.bottom + 12) {
        if (ev.clientX < sb.left + edge) strip.scrollLeft -= speed;
        else if (ev.clientX > sb.right - edge) strip.scrollLeft += speed;
      }
    }
    var col = document.getElementById('pv-workouts');
    if (col && window.matchMedia('(min-width: 860px)').matches) {
      var c = col.getBoundingClientRect();
      if (ev.clientX >= c.left && ev.clientX <= c.right) {
        if (ev.clientY < c.top + edge) col.scrollTop -= speed;
        else if (ev.clientY > c.bottom - edge) col.scrollTop += speed;
      }
    }
    drag.raf = requestAnimationFrame(edgeScroll);
  }
  function dayUnder(ev, floatEl) {
    if (floatEl) floatEl.style.display = 'none';
    var under = document.elementFromPoint(ev.clientX, ev.clientY);
    if (floatEl) floatEl.style.display = '';
    if (!under || !under.closest) return null;
    return under.closest('.pv-day') || under.closest('.pv-cell[data-date]');
  }
  function onPointerDown(e) {
    if (!canEdit() || (e.button != null && e.button !== 0)) return;
    if (e.target.closest('[data-presence], #pv-sheet, input, select, textarea, button')) return;
    var handle = e.target.closest('[data-drag]');
    if (!handle) return;
    clearDrag();
    var startX = e.clientX, startY = e.clientY, pointerId = e.pointerId;
    var rail = handle.closest('#pv-rail');
    var weekStrip = handle.closest('.pv-week-scroll');
    var horizontalOk = !!((rail || weekStrip) && window.matchMedia('(max-width: 859px)').matches);
    var floatEl = null;
    drag = {
      kind: handle.getAttribute('data-drag-kind'),
      id: handle.getAttribute('data-drag'),
      day: '',
      moved: false,
      last: e,
      raf: 0,
      live: false,
      move: move,
      up: finish
    };
    function move(ev) {
      if (!drag || ev.pointerId !== pointerId) return;
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!drag.live) {
        if (Math.abs(dx) + Math.abs(dy) < 8) return;
        if (horizontalOk && Math.abs(dx) > Math.abs(dy)) { finish(); return; }
        drag.live = true;
        drag.moved = true;
        floatEl = document.createElement('div');
        floatEl.id = 'pv-float';
        floatEl.className = 'pv-float';
        floatEl.textContent = handle.getAttribute('data-label') || 'Workout';
        document.body.appendChild(floatEl);
        if (!drag.raf) drag.raf = requestAnimationFrame(edgeScroll);
        try { handle.setPointerCapture(pointerId); } catch (err) {}
      }
      ev.preventDefault();
      drag.last = ev;
      floatEl.style.left = (ev.clientX + 10) + 'px';
      floatEl.style.top = (ev.clientY + 12) + 'px';
      var day = dayUnder(ev, floatEl);
      var prev = document.querySelectorAll('.pv-over');
      for (var i = 0; i < prev.length; i++) prev[i].classList.remove('pv-over');
      if (day) day.classList.add('pv-over');
      drag.day = day ? day.getAttribute('data-date') || '' : '';
    }
    function finish() {
      var info = drag;
      var moved = info && info.live && info.moved;
      var kind = info && info.kind;
      var id = info && info.id;
      var date = info && info.day;
      clearDrag();
      if (!moved) return;
      function eatClick(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener('click', eatClick, true);
      }
      document.addEventListener('click', eatClick, true);
      setTimeout(function () { document.removeEventListener('click', eatClick, true); }, 0);
      dropOn(kind, id, date);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }
  function onChange(e) {
    if (!state || e.target.id !== 'pv-client') return;
    state.clientId = e.target.value;
    state.clientShare = null;
    state.hint = '';
    state.sheet = null;
    state.screen = 'home';
    render();
    loadClientShare(++loadToken);
  }
  function playFrom(node, mode) {
    if (state.sheet && state.sheet.type === 'menu' && canEdit()) {
      if (!saveMenuTimes()) return;
    }
    state.focusWorkout = node.getAttribute(mode === 'view' ? 'data-view-wo' : 'data-run');
    state.focusEntry = node.getAttribute('data-entry') || '';
    state.playerMode = mode;
    state.screen = 'player';
    state.sheet = null;
    render();
  }
  function onClick(e) {
    if (!state) return;
    if (e.target.id === 'pv-sheet') { state.sheet = null; render(); return; }
    var pick = e.target.closest('[data-pick]');
    if (pick && state.sheet && state.sheet.type === 'add') {
      readSheetTimes();
      state.sheet.workoutId = pick.getAttribute('data-pick');
      state.sheet.error = '';
      render();
      return;
    }
    var sheetBtn = e.target.closest('[data-sheet]');
    if (sheetBtn && state.sheet) {
      var action = sheetBtn.getAttribute('data-sheet');
      if (action === 'cancel') { state.sheet = null; render(); return; }
      if (action === 'save') { confirmAdd(); return; }
      if (action === 'times') { if (saveMenuTimes()) { state.hint = 'Saved on this device.'; render(); } return; }
      if (action === 'remove') { removeScheduled(); return; }
      if (action === 'add') {
        var again = entryById(state.sheet.entryId);
        if (!again) { state.sheet = null; render(); return; }
        openAdd(again.date);
        return;
      }
      if (action === 'add-day') {
        var dayDate = state.sheet.date;
        if (!dayDate || !canEdit()) { state.sheet = null; render(); return; }
        openAdd(dayDate);
        return;
      }
    }
    var cal = e.target.closest('[data-cal]');
    if (cal) {
      var nextView = cal.getAttribute('data-cal');
      if (nextView === 'week' && state.cursor.slice(0, 7) !== state.month) state.cursor = state.month + '-01';
      state.view = nextView;
      render();
      return;
    }
    var shift = e.target.closest('[data-shift]');
    if (shift) {
      var dir = Number(shift.getAttribute('data-shift')) || 0;
      if (shift.getAttribute('data-unit') === 'month') {
        var parts = state.month.split('-');
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1 + dir, 1);
        state.month = P.iso(d).slice(0, 7);
      } else {
        var c = P.parseDate(state.cursor);
        c.setDate(c.getDate() + (7 * dir));
        state.cursor = P.iso(c);
        state.month = state.cursor.slice(0, 7);
      }
      render();
      return;
    }
    var monthDay = e.target.closest('[data-month-day]');
    if (monthDay && !e.target.closest('#pv-sheet')) {
      openDay(monthDay.getAttribute('data-month-day'));
      return;
    }
    var presenceBtn = e.target.closest('[data-presence]');
    if (presenceBtn && canEdit()) {
      var current = entryById(presenceBtn.getAttribute('data-presence'));
      if (!current) return;
      var flipped = P.setPresence(data().programs, current.id, current.presence === 'trainer' ? 'solo' : 'trainer');
      if (flipped.changed) {
        savePrograms(flipped.programs, 'Saved on this device.');
        pushRemote(flipped.changed);
      }
      render();
      return;
    }
    var openS = e.target.closest('[data-open-session]');
    if (openS && !e.target.closest('[data-presence]')) {
      openMenu(entryById(openS.getAttribute('data-open-session')));
      return;
    }
    var addDay = e.target.closest('[data-add-day]');
    if (addDay && canEdit() && !e.target.closest('[data-open-session], [data-presence], #pv-sheet')) {
      openAdd(addDay.getAttribute('data-add-day'));
      return;
    }
    var view = e.target.closest('[data-view-wo]');
    if (view) { playFrom(view, 'view'); return; }
    var run = e.target.closest('[data-run]');
    if (run) playFrom(run, 'run');
  }
  function loadClientShare(token) {
    if (!state || !P.isTrainer(state.role) || !state.clientId || !options.loadClient) {
      if (state && token === loadToken) { state.ready = true; render(); pullRemote(); }
      return;
    }
    Promise.resolve().then(function () { return options.loadClient(state.clientId); }).then(function (status) {
      if (!state || token !== loadToken) return;
      state.clientShare = status || { shared: false, enthusiast: false, linked: true };
      state.ready = true;
      render();
      if (canSee()) pullRemote();
    }, function () {
      if (!state || token !== loadToken) return;
      state.clientShare = null;
      state.ready = true;
      render();
      pullRemote();
    });
  }
  function refresh() {
    var token = ++loadToken;
    var profileP = options.loadProfile ? Promise.resolve().then(options.loadProfile) : Promise.resolve(null);
    var sessionP = options.loadSession ? Promise.resolve().then(options.loadSession) : Promise.resolve(null);
    Promise.all([profileP, sessionP]).then(function (pair) {
      if (!state || token !== loadToken) return;
      state.profile = pair[0] || null;
      var session = pair[1];
      state.userId = (session && session.user && session.user.id) || (state.profile && state.profile.id) || '';
      state.role = P.roleOf(state.profile);
      if (P.isTrainer(state.role)) {
        var rosterP = options.loadRoster ? Promise.resolve().then(options.loadRoster) : Promise.resolve(null);
        return rosterP.then(function (roster) {
          if (!state || token !== loadToken) return;
          var clients = roster && Array.isArray(roster.clients) ? roster.clients : [];
          state.clients = clients;
          if (!state.clientId || !clients.some(function (row) { return row.id === state.clientId; })) {
            state.clientId = clients.length ? clients[0].id : '';
          }
          loadClientShare(token);
        });
      }
      if (state.role === 'enthusiast' && options.loadShare) {
        return Promise.resolve().then(options.loadShare).then(function (row) {
          if (!state || token !== loadToken) return;
          state.shareOn = row && typeof row.on === 'boolean' ? row.on : null;
          state.ready = true;
          render();
          pullRemote();
        }, function () {
          if (!state || token !== loadToken) return;
          state.ready = true;
          render();
          pullRemote();
        });
      }
      state.ready = true;
      render();
      pullRemote();
    }, function () {
      if (!state || token !== loadToken) return;
      state.ready = true;
      render();
    });
  }
  function back() {
    if (!state) return false;
    if (state.playerLive) {
      if (window.WBPlayer) WBPlayer.requestEnd();
      return true;
    }
    if (state.sheet) { state.sheet = null; render(); return true; }
    if (state.screen === 'home') return false;
    state.screen = 'home';
    render();
    return true;
  }
  function mount(opts) {
    clearDrag();
    options = opts || {};
    app = options.app;
    titleEl = options.titleEl;
    backBtn = options.backBtn;
    state = fresh();
    if (data() && !Array.isArray(data().programs)) data().programs = [];
    render();
    refresh();
  }
  function unmount() {
    loadToken += 1;
    clearDrag();
    if (state && state.playerLive && window.WBPlayer) WBPlayer.unmount();
    document.body.classList.remove('playing');
    document.body.classList.remove('pv-on');
    if (app) {
      app.onpointerdown = null;
      app.onclick = null;
      app.onchange = null;
    }
    state = null;
    options = null;
  }
  window.WBPreview = { mount: mount, unmount: unmount, back: back };
})();
