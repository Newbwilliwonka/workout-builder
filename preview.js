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
    if (P.isTrainer(state.role) && state.clientId) return state.clientId;
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
  var pushEpoch = {};
  function noteDrop(id, ownerId) {
    if (!data() || !id) return;
    data().programDrops = data().programDrops || {};
    data().programDrops[id] = { at: Date.now(), ownerId: ownerId || '' };
  }
  function pushRemote(row) {
    if (!row || !options || !options.saveEntry || !P.isUuid(row.ownerId)) return;
    var epoch = pushEpoch[row.id] || 0;
    var saveEntry = options.saveEntry;
    var deleteEntry = options.deleteEntry;
    var persist = options.persist;
    var store = options.data;
    Promise.resolve().then(function () { return saveEntry(row); }).then(function () {
      afterPush(null);
    }, function (err) {
      afterPush(err);
    });
    function afterPush(err) {
      if (!store) return;
      var superseded = (pushEpoch[row.id] || 0) !== epoch;
      if (P.staleWrite(err, store.programDrops, row.id, store.programs)) {
        store.programDrops[row.id] = { at: Date.now(), ownerId: row.ownerId || '' };
        if (persist) persist();
        if (deleteEntry && P.isUuid(row.ownerId)) {
          Promise.resolve().then(function () { return deleteEntry(row); }).then(function () {
            if (state) state.remote = '';
          }, function (delErr) {
            if (!state) return;
            state.remote = remoteNote(delErr);
            render();
          });
        }
        return;
      }
      if (err) {
        if (!state) return;
        state.remote = remoteNote(err);
        render();
        return;
      }
      if (!state || superseded) return;
      state.remote = '';
      var cleared = false;
      store.programs = (store.programs || []).map(function (item) {
        if (!item || item.id !== row.id || !item.pending) return item;
        if ((item.updatedAt || 0) !== (row.updatedAt || 0)) return item;
        cleared = true;
        var next = Object.assign({}, item, { synced: true });
        delete next.pending;
        return next;
      });
      if (cleared && persist) persist();
    }
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
  var pullGen = 0;
  function pullRemote() {
    var owner = ownerId();
    if (!options.loadEntries || !P.isUuid(owner)) return;
    var token = loadToken;
    var gen = ++pullGen;
    Promise.resolve().then(function () { return options.loadEntries(owner); }).then(function (rows) {
      if (!state || token !== loadToken || gen !== pullGen || !Array.isArray(rows) || !data()) return;
      var dropped = data().programDrops || {};
      var merged = P.merge(data().programs, rows, owner, { keepLocalTimes: !!rows.timesPending, dropped: dropped });
      data().programs = merged;
      data().programDrops = P.settleDrops(dropped, rows, merged, owner);
      merged.forEach(function (row) {
        if (row && row.ownerId === owner && row.pending) pushRemote(row);
      });
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
  function ico(kind, button) {
    var path = kind === 'trainer'
      ? 'M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM9 13c-2.8 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.8 13 9 13zm7 .5c-.4 0-.8 0-1.2.1 1.3.8 2.2 1.9 2.2 3.2V19h5v-2c0-1.8-2.5-3.5-6-3.5z'
      : 'M12 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4z';
    var mark = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
    if (button) {
      return '<button type="button" class="pv-ico ' + kind + '" data-presence="' + esc(button.id) + '" aria-label="' + esc(presenceLabel(kind)) + '. Change it.">' + mark + '</button>';
    }
    return '<span class="pv-ico ' + kind + '" title="' + esc(presenceLabel(kind)) + '">' + mark + '</span>';
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
      '<div class="name">' + esc(name) + '</div></div>' +
      '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + '</div></div>';
  }
  function sessionCard(row) {
    var live = workoutById(row.workoutId);
    var name = live ? live.name : (row.workoutName || 'Workout');
    var kind = row.presence === 'trainer' ? 'trainer' : 'solo';
    var when = P.formatRange(row.start, row.end);
    var icon = canEdit() ? ico(kind, { id: row.id }) : ico(kind);
    return '<div class="card pv-session" data-open-session="' + esc(row.id) + '"' + dragAttrs('session', row.id, name) + '><div class="pv-session-top">' +
      icon + '</div>' +
      '<div class="name">' + esc(name) + '</div>' +
      (when ? '<div class="pv-when">' + esc(when) + '</div>' : '') +
      '<div class="mute">' + esc(presenceLabel(kind)) + '</div></div>';
  }
  function presenceChoice(name, selected, entryId) {
    function opt(value, label) {
      var on = selected === value ? ' checked' : '';
      var entry = entryId ? ' data-entry="' + esc(entryId) + '"' : '';
      return '<label class="pv-presence-opt"><input type="radio" name="' + esc(name) + '" value="' + value + '"' + on + entry + '>' +
        ico(value) + '<span>' + esc(label) + '</span></label>';
    }
    return '<div class="pv-presence" role="radiogroup" aria-label="Solo or Trainer present">' +
      '<div class="pv-presence-label">Solo or Trainer present</div>' +
      opt('solo', 'Solo') + opt('trainer', 'Trainer present') + '</div>';
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
      h += '<div class="pv-day' + (today ? ' today' : '') + '" data-date="' + date + '" data-day="' + date + '"><div class="pv-day-h"><div><div class="pv-dow">' + DOWS[i] + '</div><div class="pv-num">' + d.getDate() + (today ? '<span class="pv-today-label mute"> Today</span>' : '') + '</div></div>' +
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
    if (P.isTrainer(state.role) && state.clientId && state.clientShare && state.clientShare.shared === true) {
      return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is on, so you can drag and schedule workouts on this calendar.</p></div>';
    }
    if (P.isTrainer(state.role) && state.clientId && canEdit()) return '<div class="card" id="pv-role-note"><p style="margin:0">You can drag and move workouts on this client’s calendar.</p></div>';
    return '';
  }
  function clientPicker() {
    if (!P.isTrainer(state.role)) return '';
    if (!state.clients.length) return '<div class="card"><div class="name">No clients yet</div><p class="mute">Invite a client from Account, then their calendar shows up here.</p></div>';
    var h = '<label class="mute" for="pv-client">Client</label><select id="pv-client">';
    h += '<option value=""' + (state.clientId ? '' : ' selected') + '>My calendar</option>';
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
      '<div class="pv-views"><div class="seg" id="pv-range-switch" role="group" aria-label="Week or month"><button type="button" data-cal="week" class="' + (state.view === 'week' ? 'on' : '') + '">Week</button>' +
      '<button type="button" data-cal="month" class="' + (state.view === 'month' ? 'on' : '') + '">Month</button></div>' +
      '<button type="button" id="pv-gcal">Add to Google Calendar</button></div>' +
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
    if (state.sheet.type === 'day') return daySheetHtml();
    if (state.sheet.type === 'gcal') return gcalSheetHtml();
    return '';
  }
  // Phones and tablets: Google's app cannot subscribe from a link.
  // iPadOS reports a Mac user agent and still has a multi-touch screen.
  function calendarOnPhone(nav) {
    var n = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!n) return false;
    var ua = String(n.userAgent || '');
    var data = n.userAgentData;
    if (data && data.mobile) return true;
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
    var touch = Number(n.maxTouchPoints) || 0;
    var platform = String(n.platform || '');
    if (data && data.platform) platform += ' ' + String(data.platform);
    if (touch > 1 && /Mac/i.test(ua + ' ' + platform)) return true;
    return false;
  }
  var GCAL_PHONE_NOTE = 'Google\'s phone app can\'t add calendar links. Do it once on a computer: sign in at coachtrainerapp.com, tap Add to Google Calendar there, and it will sync to this phone on its own.';
  function gcalSheetHtml() {
    var sheet = state.sheet;
    var phone = calendarOnPhone();
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" id="pv-gcal-sheet" role="dialog" aria-label="Add to Google Calendar">';
    h += '<h3 class="name">Add to Google Calendar</h3>';
    if (sheet.status === 'signedout') {
      h += '<p class="mute" id="pv-gcal-signin">Sign in to add your program to Google Calendar.</p>';
      return h + '<button type="button" data-sheet="cancel">Close</button></div></div>';
    }
    if (sheet.note) h += '<p class="mute" id="pv-gcal-note">' + esc(sheet.note) + '</p>';
    if (sheet.error) h += '<p class="mute" id="pv-gcal-error">' + esc(sheet.error) + '</p>';
    h += gcalActionsHtml(sheet, phone);
    h += '<button type="button" class="ghost" data-gcal="reset" id="pv-gcal-reset">Reset link</button>';
    h += '<button type="button" data-sheet="cancel">Close</button></div></div>';
    if (sheet.confirmReset) h += resetConfirmHtml();
    return h;
  }
  function gcalActionsHtml(sheet, phone) {
    var ready = sheet.status === 'ready' && sheet.url && sheet.openUrl;
    if (phone) {
      var note = '<p class="mute" id="pv-gcal-phone">' + esc(GCAL_PHONE_NOTE) + '</p>';
      if (ready) return note + '<button type="button" class="pri" id="pv-gcal-share" data-gcal="share">Send the link to myself</button>';
      if (sheet.status === 'error') return note + '<button type="button" class="pri" id="pv-gcal-share" data-gcal="retry">Send the link to myself</button>';
      return note + '<button type="button" class="pri" id="pv-gcal-share" disabled>Send the link to myself</button>';
    }
    if (ready) return '<a class="pri" id="pv-gcal-open" href="' + esc(sheet.openUrl) + '" target="_blank" rel="noopener noreferrer">Open Google Calendar</a>';
    if (sheet.status === 'error') return '<button type="button" class="pri" id="pv-gcal-open" data-gcal="retry">Open Google Calendar</button>';
    return '<button type="button" class="pri" id="pv-gcal-open" disabled>Open Google Calendar</button>';
  }
  function resetConfirmHtml() {
    return '<div class="pl-modal" id="pv-gcal-reset-confirm" role="dialog" aria-label="Reset your calendar link?"><div class="card"><h3>Reset your calendar link?</h3><p class="mute">Your current link will stop working, and anyone who has it will no longer see your schedule. You\'ll need to add it to Google Calendar again on a computer.</p><button type="button" class="pri" id="pv-gcal-reset-yes" data-gcal="reset-yes">Yes, reset</button><button type="button" id="pv-gcal-reset-cancel" data-gcal="reset-cancel">Cancel</button></div></div>';
  }
  function daySheetHtml() {
    var date = state.sheet.date;
    var items = onDay(date);
    var actions = P.entryMenu(context());
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" id="pv-day-sheet" role="dialog" aria-label="This day">';
    if (!items.length) {
      h += '<h3 class="name">' + esc(prettyDate(date)) + '</h3><p class="mute" id="pv-empty-day">Nothing scheduled</p>';
      return h + '<button type="button" data-sheet="cancel">Close</button></div></div>';
    }
    items.forEach(function (row) { h += dayWorkoutHtml(row, actions); });
    return h + '</div></div>';
  }
  function dayWorkoutHtml(row, actions) {
    var workout = workoutById(row.workoutId);
    var name = workout ? (workout.name || 'Workout') : (row.workoutName || 'Workout');
    var editing = actions.indexOf('remove') >= 0;
    var when = P.formatRange(row.start, row.end);
    var kind = row.presence === 'trainer' ? 'trainer' : 'solo';
    var draft = (state.sheet.drafts && state.sheet.drafts[row.id]) || { start: row.start || '', end: row.end || '', error: '' };
    var h = '<div class="pv-slot">';
    h += '<h3 class="name pv-slot-title">' + ico(kind) + '<span>' + esc(name) + '</span></h3><p class="mute">' + esc(prettyDate(row.date)) + ' · ' + esc(presenceLabel(kind)) + '</p>';
    if (editing) h += presenceChoice('pv-presence-' + row.id, kind, row.id);
    if (editing) {
      h += '<label for="pv-start-' + esc(row.id) + '">Start</label><input id="pv-start-' + esc(row.id) + '" data-time="start" data-entry="' + esc(row.id) + '" type="time" value="' + esc(draft.start || '') + '">' +
        '<label for="pv-end-' + esc(row.id) + '">End</label><input id="pv-end-' + esc(row.id) + '" data-time="end" data-entry="' + esc(row.id) + '" type="time" value="' + esc(draft.end || '') + '">';
    } else if (when) h += '<p class="pv-when">' + esc(when) + '</p>';
    if (draft.error) h += '<p class="errs" id="pv-sheet-error">' + esc(draft.error) + '</p>';
    if (actions.indexOf('run') >= 0) h += '<button type="button" class="pri" data-run="' + esc(row.workoutId) + '" data-entry="' + esc(row.id) + '">Run</button>';
    if (actions.indexOf('view') >= 0) h += '<button type="button" data-view-wo="' + esc(row.workoutId) + '" data-entry="' + esc(row.id) + '">View</button>';
    if (editing) h += '<button type="button" data-sheet="times" data-entry="' + esc(row.id) + '">Save times</button>';
    if (actions.indexOf('remove') >= 0) h += '<button type="button" class="danger" data-sheet="remove" data-entry="' + esc(row.id) + '">Remove workout</button>';
    if (actions.indexOf('add') >= 0) h += '<button type="button" data-sheet="add" data-entry="' + esc(row.id) + '">Add workout</button>';
    return h + '</div>';
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
    h += '</div>' + presenceChoice('pv-presence', sheet.presence || '', '') +
      '<label for="pv-start">Start</label><input id="pv-start" type="time" value="' + esc(sheet.start || '') + '">' +
      '<label for="pv-end">End</label><input id="pv-end" type="time" value="' + esc(sheet.end || '') + '">';
    if (sheet.error) h += '<p class="errs" id="pv-sheet-error">' + esc(sheet.error) + '</p>';
    return h + '<button type="button" class="pri" data-sheet="save">Add to this day</button><button type="button" data-sheet="cancel">Cancel</button></div></div>';
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
    if (!items.length) {
      if (canEdit()) { openAdd(date); return; }
      state.sheet = { type: 'day', date: date, drafts: {} };
      state.hint = '';
      render();
      return;
    }
    var drafts = {};
    items.forEach(function (row) {
      drafts[row.id] = { start: row.start || '', end: row.end || '', error: '' };
    });
    state.sheet = { type: 'day', date: date, drafts: drafts };
    state.hint = '';
    render();
  }
  function openAdd(date, workoutId) {
    state.sheet = { type: 'add', date: date, workoutId: workoutId || '', start: '09:00', end: '10:00', presence: '', error: '' };
    state.hint = '';
    render();
  }
  function openMenu(entry) {
    if (!entry) return;
    openDay(entry.date);
  }
  function readSheetTimes() {
    if (!state || !state.sheet) return;
    if (state.sheet.type === 'add') {
      var startEl = document.getElementById('pv-start');
      var endEl = document.getElementById('pv-end');
      if (startEl) state.sheet.start = startEl.value;
      if (endEl) state.sheet.end = endEl.value;
      return;
    }
    if (state.sheet.type !== 'day' || !state.sheet.drafts) return;
    var nodes = document.querySelectorAll('#pv-day-sheet input[data-time]');
    for (var i = 0; i < nodes.length; i++) {
      var draft = state.sheet.drafts[nodes[i].getAttribute('data-entry')];
      var key = nodes[i].getAttribute('data-time');
      if (!draft || !key) continue;
      draft[key] = nodes[i].value;
    }
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
      presence: sheet.presence
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
  function saveEntryTimes(id) {
    readSheetTimes();
    var sheet = state.sheet;
    if (!sheet || sheet.type !== 'day' || !sheet.drafts || !sheet.drafts[id] || !data()) return false;
    var draft = sheet.drafts[id];
    var result = P.setTimes(data().programs, id, draft.start, draft.end);
    if (result.error) { draft.error = result.error; render(); return false; }
    draft.error = '';
    if (result.changed) {
      draft.start = result.changed.start;
      draft.end = result.changed.end;
      savePrograms(result.programs, 'Saved on this device.');
      pushRemote(result.changed);
    }
    render();
    return true;
  }
  function removeScheduled(id) {
    var sheet = state.sheet;
    if (!sheet || !data() || !id) return;
    var result = P.remove(data().programs, id);
    state.sheet = null;
    if (!result.removed) { render(); return; }
    pushEpoch[id] = (pushEpoch[id] || 0) + 1;
    noteDrop(id, result.removed.ownerId);
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
    if (!state) return;
    var radio = e.target;
    if (radio && radio.type === 'radio' && radio.name && String(radio.name).indexOf('pv-presence') === 0) {
      if (!state.sheet || !data()) return;
      readSheetTimes();
      if (state.sheet.type === 'add') {
        state.sheet.presence = radio.value === 'trainer' ? 'trainer' : 'solo';
        state.sheet.error = '';
        render();
        return;
      }
      if (state.sheet.type === 'day' && canEdit()) {
        var id = radio.getAttribute('data-entry');
        var flipped = P.setPresence(data().programs, id, radio.value);
        if (flipped.changed) {
          savePrograms(flipped.programs, 'Saved on this device.');
          pushRemote(flipped.changed);
        }
        render();
      }
      return;
    }
    if (e.target.id !== 'pv-client') return;
    state.clientId = e.target.value;
    state.clientShare = null;
    state.hint = '';
    state.sheet = null;
    state.screen = 'home';
    render();
    loadClientShare(++loadToken);
  }
  function playFrom(node, mode) {
    var workoutId = node.getAttribute(mode === 'view' ? 'data-view-wo' : 'data-run');
    var entryId = node.getAttribute('data-entry') || '';
    if (state.sheet && state.sheet.type === 'day' && canEdit() && entryId) {
      readSheetTimes();
      var draft = state.sheet.drafts && state.sheet.drafts[entryId];
      var row = entryById(entryId);
      var edited = draft && row && ((draft.start || '') !== (row.start || '') || (draft.end || '') !== (row.end || ''));
      if (edited && !saveEntryTimes(entryId)) return;
    }
    state.focusWorkout = workoutId;
    state.focusEntry = entryId;
    state.playerMode = mode;
    state.screen = 'player';
    state.sheet = null;
    render();
  }
  var FEED_KEY = 'wb.calendarFeed.v1';
  function localFeedErr() {
    var err = new Error('local');
    err.local = true;
    return err;
  }
  function feedBag() {
    try {
      var raw = localStorage.getItem(FEED_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }
  function feedSaved(userId) {
    var row = feedBag()[userId];
    if (!row || !window.WBCalendar || !WBCalendar.validToken(row.token)) return null;
    return row;
  }
  function feedRemember(userId, row) {
    if (!row || !window.WBCalendar || !WBCalendar.validToken(row.token)) return;
    var all = feedBag();
    all[userId] = { token: row.token, timezone: row.timezone || WBCalendar.deviceZone() };
    try { localStorage.setItem(FEED_KEY, JSON.stringify(all)); } catch (e) {}
  }
  var FEED_RESET_NOTE = 'New link ready.';
  var FEED_FAIL_NOTE = "Couldn't create your calendar link. Please try again.";
  function showFeed(row, preview, note) {
    if (!state || !state.sheet || state.sheet.type !== 'gcal' || !window.WBCalendar) return;
    var url = WBCalendar.feedUrl(row.token);
    state.sheet.status = 'ready';
    state.sheet.url = url;
    state.sheet.openUrl = WBCalendar.googleAddUrl(url);
    state.sheet.preview = !!preview;
    state.sheet.note = note || '';
    state.sheet.error = '';
    render();
  }
  function revealLinkField(url) {
    var field = document.getElementById('pv-gcal-link');
    if (!field) {
      var card = document.getElementById('pv-gcal-sheet');
      if (!card) return null;
      field = document.createElement('input');
      field.id = 'pv-gcal-link';
      field.className = 'pv-gcal-link';
      field.type = 'text';
      field.readOnly = true;
      field.value = url;
      field.setAttribute('aria-label', 'Calendar link');
      field.spellcheck = false;
      var reset = document.getElementById('pv-gcal-reset');
      if (reset && reset.parentNode === card) card.insertBefore(field, reset);
      else card.appendChild(field);
    }
    try {
      field.focus();
      field.select();
      if (field.setSelectionRange) field.setSelectionRange(0, field.value.length);
    } catch (err) {}
    return field;
  }
  function copyCalendarLink() {
    if (!state || !state.sheet || state.sheet.type !== 'gcal' || !state.sheet.url) return;
    var url = state.sheet.url;
    function selectField() { revealLinkField(url); }
    function copied() {
      if (options && options.toast) options.toast('Link copied');
    }
    var clip = navigator.clipboard;
    if (clip && clip.writeText) {
      try {
        var pending = clip.writeText(url);
        if (pending && pending.then) pending.then(copied, selectField);
        else copied();
        return;
      } catch (err) {
        selectField();
        return;
      }
    }
    selectField();
  }
  function shareCancelled(err) {
    return !!(err && err.name === 'AbortError');
  }
  // Share consumes the tap on iOS, so a later clipboard.writeText is rejected.
  // Start the clipboard write during the tap and only fill it in if share fails.
  function armShareCopy(url) {
    var committed = false;
    var writeFailed = false;
    var resolveText = null;
    var rejectText = null;
    var armed = false;
    var clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (clip && typeof clip.write === 'function' && typeof ClipboardItem === 'function') {
      try {
        var textPromise = new Promise(function (resolve, reject) {
          resolveText = resolve;
          rejectText = reject;
        });
        var blobPromise = textPromise.then(function (text) {
          return new Blob([text], { type: 'text/plain' });
        });
        blobPromise.then(function () {}, function () {});
        var pending = clip.write([new ClipboardItem({ 'text/plain': blobPromise })]);
        armed = true;
        if (pending && typeof pending.then === 'function') {
          pending.then(function () {
            if (committed && options && options.toast) options.toast('Link copied');
          }, function () {
            writeFailed = true;
            if (committed) revealLinkField(url);
          });
        }
      } catch (err) {
        armed = false;
      }
    }
    return {
      commit: function () {
        committed = true;
        if (!armed || writeFailed) {
          copyCalendarLink();
          return;
        }
        resolveText(url);
      },
      cancel: function () {
        if (rejectText) rejectText(new Error('cancelled'));
      }
    };
  }
  function shareCalendarLink() {
    if (!state || !state.sheet || state.sheet.type !== 'gcal' || !state.sheet.url) return;
    var url = state.sheet.url;
    var nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav || typeof nav.share !== 'function') {
      copyCalendarLink();
      return;
    }
    var armed = armShareCopy(url);
    var pending;
    try {
      pending = nav.share({
        title: 'My workout calendar link',
        text: 'Open this on a computer to add my workouts to Google Calendar',
        url: url
      });
    } catch (err) {
      if (shareCancelled(err)) { armed.cancel(); return; }
      armed.commit();
      return;
    }
    if (pending && typeof pending.then === 'function') {
      pending.then(function () { armed.cancel(); }, function (err) {
        if (shareCancelled(err)) { armed.cancel(); return; }
        armed.commit();
      });
      return;
    }
    armed.cancel();
  }
  function showSignedOut() {
    if (!state || !state.sheet || state.sheet.type !== 'gcal') return;
    state.sheet.status = 'signedout';
    state.sheet.url = '';
    state.sheet.openUrl = '';
    state.sheet.preview = false;
    state.sheet.note = '';
    state.sheet.error = '';
    render();
  }
  function showFeedError() {
    if (!state || !state.sheet || state.sheet.type !== 'gcal') return;
    state.sheet.note = '';
    state.sheet.error = FEED_FAIL_NOTE;
    state.sheet.status = state.sheet.openUrl ? 'ready' : 'error';
    render();
  }
  function openCalendar() {
    if (!state || !window.WBCalendar) return;
    var zone = WBCalendar.deviceZone();
    var userId = state.userId || '';
    var saved = userId ? feedSaved(userId) : null;
    state.sheet = { type: 'gcal', status: 'loading', url: '', openUrl: '', preview: false, note: '', error: '' };
    render();
    if (!userId) { showSignedOut(); return; }
    var load = options && options.loadCalendar;
    var pending = load
      ? Promise.resolve().then(function () { return load(zone, saved && saved.token); })
      : Promise.reject(localFeedErr());
    pending.then(function (row) {
      if (!row || !WBCalendar.validToken(row.token)) throw localFeedErr();
      feedRemember(userId, row);
      showFeed(row, !!row.preview, '');
    }, function (err) {
      if (!state || !state.sheet || state.sheet.type !== 'gcal') return;
      if (err && err.auth) { showSignedOut(); return; }
      if (err && err.local) {
        var row = saved || { token: WBCalendar.newToken(), timezone: zone };
        feedRemember(userId, row);
        showFeed(row, true, '');
        return;
      }
      showFeedError();
    });
  }
  function askResetCalendarLink() {
    if (!state || !state.sheet || state.sheet.type !== 'gcal' || !window.WBCalendar) return;
    if (state.sheet.status !== 'ready' && state.sheet.status !== 'error') return;
    if (!state.userId) { showSignedOut(); return; }
    state.sheet.confirmReset = true;
    render();
  }
  function dismissResetConfirm() {
    if (!state || !state.sheet || state.sheet.type !== 'gcal') return;
    state.sheet.confirmReset = false;
    render();
  }
  function resetCalendarLink() {
    if (!state || !state.sheet || state.sheet.type !== 'gcal' || !window.WBCalendar) return;
    if (state.sheet.status !== 'ready' && state.sheet.status !== 'error') return;
    if (!state.userId) { showSignedOut(); return; }
    state.sheet.confirmReset = false;
    var zone = WBCalendar.deviceZone();
    var userId = state.userId;
    var wasPreview = !!state.sheet.preview;
    var reset = options && options.resetCalendar;
    state.sheet.status = 'loading';
    state.sheet.error = '';
    state.sheet.note = '';
    render();
    var pending = reset && !wasPreview
      ? Promise.resolve().then(function () { return reset(zone); })
      : Promise.reject(localFeedErr());
    pending.then(function (row) {
      if (!row || !WBCalendar.validToken(row.token)) throw localFeedErr();
      feedRemember(userId, row);
      showFeed(row, !!row.preview, FEED_RESET_NOTE);
    }, function (err) {
      if (!state || !state.sheet || state.sheet.type !== 'gcal') return;
      if (err && err.auth) { showSignedOut(); return; }
      if ((err && err.local) || wasPreview) {
        var row = { token: WBCalendar.newToken(), timezone: zone };
        feedRemember(userId, row);
        showFeed(row, true, FEED_RESET_NOTE);
        return;
      }
      showFeedError();
    });
  }
  function onClick(e) {
    if (!state) return;
    if (e.target.id === 'pv-sheet') { state.sheet = null; render(); return; }
    if (e.target.closest('#pv-gcal')) { openCalendar(); return; }
    var gcalBtn = e.target.closest('[data-gcal]');
    if (gcalBtn && state.sheet && state.sheet.type === 'gcal') {
      var gact = gcalBtn.getAttribute('data-gcal');
      if (gact === 'reset') { askResetCalendarLink(); return; }
      if (gact === 'reset-yes') { resetCalendarLink(); return; }
      if (gact === 'reset-cancel') { dismissResetConfirm(); return; }
      if (gact === 'retry') { openCalendar(); return; }
      if (gact === 'share') { shareCalendarLink(); return; }
      if (gact === 'copy') { copyCalendarLink(); return; }
      return;
    }
    if (e.target.closest('#pv-gcal-reset-confirm')) return;
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
      if (action === 'times') { saveEntryTimes(sheetBtn.getAttribute('data-entry')); return; }
      if (action === 'remove') { removeScheduled(sheetBtn.getAttribute('data-entry')); return; }
      if (action === 'add') {
        var again = entryById(sheetBtn.getAttribute('data-entry'));
        if (!again) { state.sheet = null; render(); return; }
        openAdd(again.date);
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
    var dayTap = e.target.closest('[data-day]');
    if (dayTap && !e.target.closest('#pv-sheet')) {
      openDay(dayTap.getAttribute('data-day'));
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
          if (state.clientId && !clients.some(function (row) { return row.id === state.clientId; })) {
            state.clientId = '';
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
  window.WBPreview = { mount: mount, unmount: unmount, back: back, calendarOnPhone: calendarOnPhone };
})();
