/* Programs calendar. Real workouts and real tracking. No sample people. */
(function () {
  'use strict';
  var P = window.WBPrograms;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var app = null, titleEl = null, backBtn = null, options = null, state = null, drag = null, loadToken = 0;
  // History steps while a day list, a workout or add window opened from that list,
  // or the player is open. Phone back closes one layer and stays on this calendar.
  var historyDepth = 0, ignorePop = 0;

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
      shares: {},
      clientShareFresh: false,
      remoteSessions: [],
      profile: null,
      userId: '',
      role: 'none',
      shareOn: null,
      clientShare: null,
      hint: '',
      ready: false,
      remote: '',
      playerLive: false,
      circuits: [],
      circuitGuests: [],
      sheet: null
    };
  }
  function viewingAll() {
    return !!(state && P.isTrainer(state.role) && state.clientId === 'all');
  }
  function ownerId() {
    if (!state) return 'self';
    if (P.isTrainer(state.role) && state.clientId && state.clientId !== 'all') return state.clientId;
    return state.userId || 'self';
  }
  function clientById(id) {
    var found = null;
    (state && state.clients || []).forEach(function (row) { if (row && row.id === id) found = row; });
    return found;
  }
  // All clients keeps one share snapshot per Enthusiast. A single calendar uses
  // the read for that open client once it finishes, so an older snapshot cannot
  // keep them hidden or editable.
  function shareFor(id) {
    if (!state) return null;
    if (!viewingAll() && state.clientId === id && state.clientShareFresh) return state.clientShare;
    if (state.shares && Object.prototype.hasOwnProperty.call(state.shares, id)) return state.shares[id];
    return null;
  }
  function isEnthusiastClient(client) {
    if (!client) return false;
    if (P.ownerPlanOf(client) === 'enthusiast') return true;
    return String(client.membership || '').toLowerCase().indexOf('enthusiast') >= 0;
  }
  // Free Clients on the roster are always visible. An Enthusiast is visible
  // only while share-with-trainer is on, including workouts they created.
  function clientShown(client) {
    if (!client || !client.id) return false;
    if (!isEnthusiastClient(client)) return true;
    var share = shareFor(client.id);
    return !!(share && share.shared === true);
  }
  function contextForOwner(owner) {
    var self = state.userId || 'self';
    var id = owner || self;
    if (!id || id === self || id === 'self') {
      return {
        role: state.role,
        self: self,
        ownerId: self,
        ownerPlan: 'free_client',
        linked: false,
        shareOn: state.role === 'enthusiast' ? state.shareOn === true : false
      };
    }
    var client = clientById(id);
    var share = shareFor(id);
    var plan = isEnthusiastClient(client) || (share && share.enthusiast === true) ? 'enthusiast' : P.ownerPlanOf(client);
    return {
      role: state.role,
      self: self,
      ownerId: id,
      ownerPlan: plan,
      linked: !!client,
      shareOn: !!(share && share.shared === true)
    };
  }
  function context() {
    if (P.isTrainer(state.role) && state.clientId && state.clientId !== 'all') return contextForOwner(state.clientId);
    return contextForOwner(state.userId || 'self');
  }
  function canEdit() { return !!state && state.ready && P.canEdit(context()); }
  function canSee() { return !!state && state.ready && P.canSee(context()); }
  function canEditOwner(owner) { return !!state && state.ready && P.canEdit(contextForOwner(owner)); }
  function canEditHere() {
    if (!state || !state.ready) return false;
    if (viewingAll()) return canEditOwner(state.userId || 'self');
    return canEdit();
  }
  function canEditRow(row) {
    if (!row || row.guestCircuit) return false;
    return canEditOwner(row.ownerId || ownerId());
  }
  function peopleShown() {
    var self = state.userId || '';
    if (viewingAll()) {
      var ids = [];
      if (self) ids.push(self);
      (state.clients || []).forEach(function (client) {
        if (clientShown(client) && ids.indexOf(client.id) < 0) ids.push(client.id);
      });
      return ids;
    }
    var owner = ownerId();
    if (!owner || owner === 'self') return self ? [self] : [];
    if (P.isTrainer(state.role) && state.clientId && !canSee()) return [];
    return [owner];
  }
  function workouts() {
    var rows = data() && data().workouts;
    return Array.isArray(rows) ? rows : [];
  }
  function circuitMarker(id) {
    return { source: 'circuit', circuitId: String(id) };
  }
  function markerCircuitId(items) {
    var item = items && items[0];
    if (!item || item.source !== 'circuit' || !item.circuitId) return '';
    return String(item.circuitId);
  }
  function circuitChoices() {
    var C = window.WBCircuit;
    var out = [];
    (state && state.circuits || []).forEach(function (row) {
      if (!row || !row.id) return;
      var body = row.data || {};
      var info = C && C.summary ? C.summary({ name: row.name, stations: body.stations, clients: body.clients }) : {};
      out.push({
        id: String(row.id),
        name: row.name || 'Circuit',
        circuit: true,
        stations: Number(info.stations) || 0,
        clients: Number(info.clients) || 0,
        items: [circuitMarker(row.id)]
      });
    });
    return out;
  }
  function circuitById(id) {
    if (!id) return null;
    var found = null;
    circuitChoices().forEach(function (row) { if (row.id === String(id)) found = row; });
    if (found) return found;
    var snap = null;
    entries().forEach(function (row) {
      if (row && String(row.workoutId) === String(id) && markerCircuitId(row.items)) snap = row;
    });
    if (!snap) return null;
    return { id: String(id), name: snap.workoutName || 'Circuit', circuit: true, items: snap.items, stations: 0, clients: 0 };
  }
  function selfId() { return (state && state.userId) || 'self'; }
  function ownerIsSelf(owner) {
    var self = selfId();
    return !owner || owner === 'self' || owner === self;
  }
  function choicesFor(owner) {
    var list = workouts();
    if (ownerIsSelf(owner)) return list.concat(circuitChoices());
    return list;
  }
  function railChoices() {
    if (!state) return workouts();
    if (viewingAll() || ownerIsSelf(ownerId())) return workouts().concat(circuitChoices());
    return workouts();
  }
  function choiceMeta(w) {
    if (w && w.circuit) {
      var stations = Number(w.stations) || 0;
      return stations + ' station' + (stations === 1 ? '' : 's');
    }
    var n = (w && w.items || []).length;
    return n + ' exercise' + (n === 1 ? '' : 's');
  }
  function sessions() {
    var local = [];
    if (options && options.sessions) {
      try { local = options.sessions() || []; } catch (e) { local = []; }
    } else {
      var rows = data() && data().sessions;
      local = Array.isArray(rows) ? rows : [];
    }
    var remote = state && Array.isArray(state.remoteSessions) ? state.remoteSessions : [];
    if (!remote.length) return local;
    return local.concat(remote);
  }
  function guestEntries() {
    // All clients already shows the trainer's own placement. Guest copies
    // would repeat that circuit once for every invited client.
    if (viewingAll()) return [];
    var rows = state && state.circuitGuests || [];
    var owner = ownerId();
    return rows.filter(function (row) { return row && row.guestCircuit && row.ownerId === owner; });
  }
  function entries() {
    var rows = data() && data().programs;
    if (!Array.isArray(rows)) rows = [];
    var mine;
    if (!viewingAll()) mine = P.forOwner(rows, ownerId());
    else {
      var allow = {};
      peopleShown().forEach(function (id) { allow[id] = 1; });
      mine = rows.filter(function (row) { return row && allow[row.ownerId]; });
    }
    return mine.concat(guestEntries());
  }
  function schedulable(items) {
    return (items || []).filter(function (row) { return row && !row.guestCircuit; });
  }
  function workoutById(id) {
    if (!id) return null;
    var found = null;
    workouts().forEach(function (row) { if (row && row.id === id) found = row; });
    if (found) return found;
    var circuit = circuitById(id);
    if (circuit) return circuit;
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
    if (!row || !options || !options.saveEntry || !P.isUuid(row.ownerId)) return Promise.resolve({ ok: true, skipped: true });
    var epoch = pushEpoch[row.id] || 0;
    var saveEntry = options.saveEntry;
    var deleteEntry = options.deleteEntry;
    var persist = options.persist;
    var store = options.data;
    return Promise.resolve().then(function () { return saveEntry(row); }).then(function () {
      afterPush(null);
      return { ok: true };
    }, function (err) {
      afterPush(err);
      return { ok: false, error: err };
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
      if (superseded) return;
      if (state) state.remote = '';
      clearPlacementPending();
    }
    function clearPlacementPending() {
      if (!store) return;
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
  var sessionGen = 0;
  var clientViewToken = 0;
  function applyEntryRows(rows, owners, token, gen) {
    if (!state || token !== loadToken || gen !== pullGen || !Array.isArray(rows) || !data()) return;
    var dropped = data().programDrops || {};
    var timesPending = !!rows.timesPending;
    var merged = data().programs || [];
    owners.forEach(function (id) {
      var part = rows.filter(function (row) { return row && (row.owner_id || row.ownerId) === id; });
      if (timesPending) part.timesPending = true;
      merged = P.merge(merged, part, id, { keepLocalTimes: timesPending, dropped: dropped });
      dropped = P.settleDrops(dropped, part, merged, id);
    });
    data().programs = merged;
    data().programDrops = dropped;
    merged.forEach(function (row) {
      if (!row || owners.indexOf(row.ownerId) < 0) return;
      if (row.pending) pushRemote(row);
    });
    if (timesPending) state.remote = remoteNote({ timesLocal: true });
    if (options.persist) options.persist();
    render();
  }
  function pullRemote() {
    if (viewingAll()) return pullMany();
    var owner = ownerId();
    if (!options.loadEntries || !P.isUuid(owner)) return;
    var token = loadToken;
    var gen = ++pullGen;
    Promise.resolve().then(function () { return options.loadEntries(owner); }).then(function (rows) {
      applyEntryRows(rows, [owner], token, gen);
    }, function (err) {
      if (!state || token !== loadToken) return;
      state.remote = remoteNote(err);
      render();
    });
  }
  function pullMany() {
    var owners = peopleShown();
    if (!owners.length || !data()) return;
    var token = loadToken;
    var gen = ++pullGen;
    var pending;
    if (options.loadEntriesFor) {
      pending = Promise.resolve().then(function () { return options.loadEntriesFor(owners); });
    } else if (options.loadEntries) {
      pending = Promise.all(owners.map(function (id) {
        if (!P.isUuid(id)) return [];
        return Promise.resolve().then(function () { return options.loadEntries(id); });
      })).then(function (groups) {
        var flat = [];
        groups.forEach(function (rows) {
          if (!Array.isArray(rows)) return;
          if (rows.timesPending) flat.timesPending = true;
          flat = flat.concat(rows);
        });
        return flat;
      });
    } else return;
    pending.then(function (rows) {
      applyEntryRows(rows, owners, token, gen);
    }, function (err) {
      if (!state || token !== loadToken) return;
      state.remote = remoteNote(err);
      render();
    });
  }
  function pullSessions() {
    if (!options.loadSessions || !state) return;
    var owners = peopleShown();
    var token = loadToken;
    var gen = ++sessionGen;
    Promise.resolve().then(function () { return options.loadSessions(owners); }).then(function (rows) {
      if (!state || token !== loadToken || gen !== sessionGen || !Array.isArray(rows)) return;
      var next = [];
      rows.forEach(function (row) {
        var shaped = P.sessionFromRemote(row);
        if (shaped) next.push(shaped);
      });
      state.remoteSessions = next;
      render();
    }, function () {});
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
  function check(extra) {
    var cls = extra ? 'pv-check is-extra' : 'pv-check';
    var label = extra ? 'Completed, not scheduled' : 'Completed';
    return '<span class="' + cls + '" aria-label="' + label + '">✓</span>';
  }
  function onDay(date) { return P.byStart(entries().filter(function (row) { return row.date === date; })); }
  function shownScope() {
    return { owners: peopleShown(), selfId: (state && state.userId) || 'self' };
  }
  function unscheduledFor(date) {
    if (!P.unscheduledOn) return [];
    return P.unscheduledOn(date, entries(), sessions(), shownScope());
  }
  function loggedName(row) {
    var live = row && workoutById(row.workoutId);
    if (live && live.name) return live.name;
    return (row && row.workoutName) || 'Workout';
  }
  function dragAttrs(kind, id, label, allowed) {
    if (!allowed) return '';
    return ' data-drag="' + esc(id) + '" data-drag-kind="' + kind + '" data-label="' + esc(label) + '"';
  }
  function workoutCard(w) {
    var name = w.name || 'Workout';
    return '<div class="card pv-pick-card"' + dragAttrs('workout', w.id, name, canEditHere()) + ' data-wo="' + esc(w.id) + '"><div class="pv-session-top">' +
      '<div class="name">' + esc(name) + '</div></div>' +
      '<div class="mute">' + esc(choiceMeta(w)) + '</div></div>';
  }
  function sessionCard(row) {
    var live = workoutById(row.workoutId);
    var name = live ? live.name : (row.workoutName || 'Workout');
    var kind = row.presence === 'trainer' ? 'trainer' : 'solo';
    var when = P.formatRange(row.start, row.end);
    var who = rowClientLabel(row);
    var icon = canEditRow(row) ? ico(kind, { id: row.id }) : ico(kind);
    return '<div class="card pv-session" data-open-session="' + esc(row.id) + '"' + dragAttrs('session', row.id, name, canEditRow(row)) + '><div class="pv-session-top">' +
      icon + '</div>' +
      '<div class="name">' + esc(name) + '</div>' +
      (who ? '<div class="pv-who" data-client-slot="1">' + esc(who) + '</div>' : '') +
      (when ? '<div class="pv-when">' + esc(when) + '</div>' : '') +
      '<div class="mute">' + esc(presenceLabel(kind)) + '</div></div>';
  }
  function extraCard(row) {
    var name = loggedName(row);
    var who = rowClientLabel(row);
    return '<div class="card pv-session is-extra" data-logged="' + esc(row.id) + '"><div class="pv-session-top">' +
      '<div class="name">' + esc(name) + '</div>' + check(true) + '</div>' +
      (who ? '<div class="pv-who" data-client-slot="1">' + esc(who) + '</div>' : '') + '</div>';
  }
  function extraMonthHtml(rows) {
    var h = '';
    (rows || []).forEach(function (row) {
      var name = loggedName(row);
      var who = rowClientLabel(row);
      h += '<span class="pv-extra" data-logged="' + esc(row.id) + '"><span class="pv-uname">' + esc(name) + '</span>' +
        (who ? '<span class="pv-who" data-client-slot="1">' + esc(who) + '</span>' : '') + check(true) + '</span>';
    });
    return h;
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
    return '<div class="pv-legend"><span>' + ico('trainer') + 'Trainer present</span><span>' + ico('solo') + 'Solo</span><span>' + check() + 'Completed</span><span>' + check(true) + 'Unscheduled</span></div>';
  }
  var MONTH_ICON_CAP = 6;
  function presenceKind(row) {
    return row && row.presence === 'trainer' ? 'trainer' : 'solo';
  }
  // All clients week labels. The trainer's own rows say Self. Another person's
  // label is their display name, or their role when that name is an email.
  function allClientsWho(row) {
    var selfId = (state && state.userId) || 'self';
    var owner = row && row.ownerId || '';
    if (!owner || owner === selfId || owner === 'self') return 'Self';
    var client = clientById(owner);
    var named = window.WBProfile && WBProfile.label ? WBProfile.label(client || {}) : '';
    if (named && named.indexOf('@') === -1) return named;
    var visible = clientVisible(client);
    if (visible && visible.indexOf('@') === -1) return visible;
    return 'Client';
  }
  function allMonthMarks(items, extras) {
    var kinds = [];
    (items || []).forEach(function (row) { kinds.push(presenceKind(row)); });
    (extras || []).forEach(function () { kinds.push('solo'); });
    var shown = kinds.slice(0, MONTH_ICON_CAP);
    var more = kinds.length - shown.length;
    var html = '';
    shown.forEach(function (kind) { html += ico(kind); });
    if (more > 0) html += '<span class="pv-more">+' + more + '</span>';
    return { html: html, count: kinds.length };
  }
  function allWeekCard(row, extra) {
    var kind = extra ? 'solo' : presenceKind(row);
    var who = allClientsWho(row);
    var icon = (!extra && canEditRow(row)) ? ico(kind, { id: row.id }) : ico(kind);
    var label = extra ? loggedName(row) : (row.workoutName || 'Workout');
    var cls = 'card pv-session pv-all-chip' + (extra ? ' is-extra' : '');
    var attrs = extra
      ? ' data-logged="' + esc(row.id) + '"'
      : ' data-open-session="' + esc(row.id) + '"' + dragAttrs('session', row.id, label, canEditRow(row));
    var aria = who + ', ' + presenceLabel(kind) + (extra ? ', completed, not scheduled' : '');
    return '<div class="' + cls + '"' + attrs + ' aria-label="' + esc(aria) + '"><div class="pv-chip-row">' +
      icon + '<span class="pv-who" data-client-slot="1">' + esc(who) + '</span></div></div>';
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
      var extras = unscheduledFor(date);
      var today = date === todayIso();
      h += '<div class="pv-day' + (today ? ' today' : '') + '" data-date="' + date + '" data-day="' + date + '"><div class="pv-day-h"><div><div class="pv-dow">' + DOWS[i] + '</div><div class="pv-num">' + d.getDate() + (today ? '<span class="pv-today-label mute"> Today</span>' : '') + '</div></div>' +
        (P.dayDone(schedulable(items), tracked) ? check() : '') + '</div>';
      if (viewingAll()) {
        items.forEach(function (row) { h += allWeekCard(row, false); });
        extras.forEach(function (row) { h += allWeekCard(row, true); });
      } else {
        items.forEach(function (row) { h += sessionCard(row); });
        extras.forEach(function (row) { h += extraCard(row); });
      }
      if (!items.length && !extras.length && canEditHere()) h += '<div class="mute pv-drop">Drop here</div>';
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
      var extras = unscheduledFor(date);
      var outside = d.getMonth() !== month;
      var today = date === todayIso();
      if (viewingAll()) {
        var marks = allMonthMarks(items, extras);
        var ariaAll = DOWS[(d.getDay() + 6) % 7] + ' ' + d.getDate();
        if (marks.count) ariaAll += ', ' + marks.count + (marks.count === 1 ? ' workout' : ' workouts');
        if (extras.length) ariaAll += ', completed, not scheduled';
        h += '<button type="button" class="pv-cell' + (outside ? ' is-out' : '') + (today ? ' today' : '') + ((items.length || extras.length) ? ' has' : '') + '" data-month-day="' + date + '" data-date="' + date + '" aria-label="' + esc(ariaAll) + '">' +
          '<span class="pv-num">' + d.getDate() + '</span>' +
          (marks.html ? '<span class="pv-icons">' + marks.html + '</span>' : '') + '</button>';
      } else {
      var done = P.dayDone(schedulable(items), tracked);
      var kinds = {};
      var names = [];
      var seenName = {};
      items.forEach(function (row) {
        kinds[row.presence === 'trainer' ? 'trainer' : 'solo'] = 1;
        var who = rowClientLabel(row);
        if (who && !seenName[who]) { seenName[who] = 1; names.push(who); }
      });
      var extraNames = extras.map(function (row) { return loggedName(row); });
      var icons = '';
      if (kinds.trainer) icons += ico('trainer');
      if (kinds.solo) icons += ico('solo');
      var nameHtml = names.length ? '<span class="pv-names" data-client-slot="1" title="' + esc(names.join(', ')) + '">' + esc(names.join(' · ')) + '</span>' : '';
      var aria = DOWS[(d.getDay() + 6) % 7] + ' ' + d.getDate() + (names.length ? ', ' + names.join(', ') : '') + (extraNames.length ? ', ' + extraNames.join(', ') + ', completed, not scheduled' : '') + (done ? ', completed' : '');
      h += '<button type="button" class="pv-cell' + (outside ? ' is-out' : '') + (today ? ' today' : '') + ((items.length || extras.length) ? ' has' : '') + '" data-month-day="' + date + '" data-date="' + date + '" aria-label="' + esc(aria) + '">' +
        '<span class="pv-num">' + d.getDate() + '</span><span class="pv-marks">' + icons + (done ? check() : '') + '</span>' + nameHtml + extraMonthHtml(extras) + '</button>';
      }
    }
    return h + '</div>';
  }
  function noteHtml() {
    if (!state.ready) return '';
    if (viewingAll()) return '';
    if (state.role === 'free_client') return '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer schedules your program</p></div>';
    if (state.role === 'enthusiast' && state.shareOn === true) return '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer can also edit this calendar</p></div>';
    if (state.role === 'enthusiast' && state.shareOn === false) return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is off. Your trainer cannot see or edit this calendar.</p></div>';
    if (P.isTrainer(state.role) && state.clientId && state.clientShare && state.clientShare.shared === true) {
      return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is on, so you can drag and schedule workouts on this calendar.</p></div>';
    }
    if (P.isTrainer(state.role) && state.clientId && canEdit()) return '<div class="card" id="pv-role-note"><p style="margin:0">You can drag and move workouts on this client’s calendar.</p></div>';
    return '';
  }
  function clientVisible(client) {
    var named = window.WBProfile && WBProfile.label ? WBProfile.label(client) : '';
    if (named) return named;
    var raw = String((client && (client.display_name || client.name)) || '').replace(/^\s+|\s+$/g, '');
    if (raw && raw.indexOf('@') === -1) return raw;
    if (/enthusiast/i.test(String((client && (client.plan || client.membership)) || ''))) return 'Enthusiast';
    return 'Client';
  }
  // Labeled client menu shared with the Tracking dashboard. First option is the caller’s own view.
  function clientSelectHtml(spec) {
    spec = spec || {};
    var id = String(spec.id || 'client-pick');
    var selected = spec.selected == null ? '' : String(spec.selected);
    var pill = id === 'pv-client';
    var h = (pill ? '<div class="client-pill">' : '') + '<label class="mute" for="' + esc(id) + '">' + esc(spec.label || 'Client') + '</label><select id="' + esc(id) + '">';
    (spec.options || []).forEach(function (opt) {
      var value = opt && opt.value != null ? String(opt.value) : '';
      h += '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(opt && opt.label || '') + '</option>';
    });
    return h + '</select>' + (pill ? '</div>' : '');
  }
  function clientPicker() {
    if (!P.isTrainer(state.role)) return '';
    if (!state.clients.length) return '<div class="card"><div class="name">No clients yet</div><p class="mute">Invite a client from Account, then their calendar shows up here.</p></div>';
    var options = [{ value: 'all', label: 'All clients' }, { value: '', label: 'My calendar' }];
    state.clients.forEach(function (client) {
      options.push({ value: client.id, label: clientVisible(client) + ' · ' + (client.plan || 'Free Client') });
    });
    return clientSelectHtml({ id: 'pv-client', label: 'Client', selected: state.clientId, options: options });
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
    var list = railChoices();
    h += '<div class="pv-layout" id="pv-layout"><section class="pv-workouts" id="pv-workouts" aria-label="Workouts"><h2 class="pv-h">Workouts</h2><div class="pv-rail" id="pv-rail">';
    if (!list.length) h += '<p class="mute">No workouts yet. Build one from the workout list, then drag it onto a day.</p>';
    list.forEach(function (row) { h += workoutCard(row); });
    h += '</div></section><section class="pv-cal" id="pv-cal" aria-label="Calendar"><h2 class="pv-h">Calendar</h2>' +
      '<p class="mute" id="pv-schedule-hint">Workouts scheduled on a calendar. A check is a day you actually tracked.' +
      (canEditHere() ? ' Drag a workout onto a day, or tap a day to choose one.' : '') + '</p>' +
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
    if (state.sheet.type === 'list') return dayListHtml();
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
  function firstWord(value) {
    var raw = String(value || '').replace(/^\s+|\s+$/g, '');
    if (!raw || raw.indexOf('@') !== -1) return '';
    return raw.split(/\s+/)[0] || '';
  }
  // First name when a trainer is looking at a client's workout.
  // The trainer's own entries, and a client's own calendar, leave the slot empty.
  function rowClientLabel(row) {
    if (!state || !P.isTrainer(state.role) || !row) return '';
    var owner = row.ownerId || '';
    var self = state.userId || 'self';
    if (!owner || owner === self) return '';
    var client = null;
    (state.clients || []).forEach(function (item) {
      if (item && item.id === owner) client = item;
    });
    if (!client) return '';
    return firstWord(client.display_name) || firstWord(client.name);
  }
  function dayRowHtml(row, tracked) {
    var workout = workoutById(row.workoutId);
    var name = workout ? (workout.name || 'Workout') : (row.workoutName || 'Workout');
    var when = P.formatRange(row.start, row.end);
    var kind = row.presence === 'trainer' ? 'trainer' : 'solo';
    var done = P.entryDone(row, tracked);
    var who = rowClientLabel(row);
    var label = name + (when ? ', ' + when : '') + ', ' + presenceLabel(kind) + (who ? ', ' + who : '') + (done ? ', completed' : '');
    return '<button type="button" class="pv-day-row" data-open-entry="' + esc(row.id) + '" aria-label="' + esc(label) + '">' +
      ico(kind) +
      '<span class="pv-row-main"><span class="name">' + esc(name) + '</span>' +
      (when ? '<span class="pv-when">' + esc(when) + '</span>' : '') + '</span>' +
      '<span class="pv-row-end"><span class="pv-row-client" data-client-slot="1">' + esc(who) + '</span>' +
      (done ? check() : '') + '</span></button>';
  }
  function extraRowHtml(row) {
    var name = loggedName(row);
    var who = rowClientLabel(row);
    var label = name + (who ? ', ' + who : '') + ', completed, not scheduled';
    return '<button type="button" class="pv-day-row is-extra" data-open-logged="' + esc(row.id) + '" aria-label="' + esc(label) + '">' +
      '<span class="pv-row-main"><span class="name">' + esc(name) + '</span></span>' +
      '<span class="pv-row-end"><span class="pv-row-client" data-client-slot="1">' + esc(who) + '</span>' +
      check(true) + '</span></button>';
  }
  function dayListHtml() {
    var date = state.sheet.date;
    var items = onDay(date);
    var extras = unscheduledFor(date);
    var tracked = sessions();
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" id="pv-day-sheet" role="dialog" aria-label="This day">' +
      '<div class="pv-grab" data-sheet-grab="1" role="button" aria-label="Close"></div>';
    h += '<h3 class="name">' + esc(prettyDate(date)) + '</h3>';
    if (!items.length && !extras.length) h += '<p class="mute" id="pv-empty-day">No workouts scheduled</p>';
    var rows = '';
    items.forEach(function (row) { rows += dayRowHtml(row, tracked); });
    extras.forEach(function (row) { rows += extraRowHtml(row); });
    if (rows) h += '<div class="pv-day-list">' + rows + '</div>';
    if (canEditHere()) h += '<button type="button" data-sheet="add-day">Add workout</button>';
    return h + '</div></div>';
  }
  function loggedById(id) {
    var found = null;
    if (!state || !state.sheet || !state.sheet.date) return null;
    unscheduledFor(state.sheet.date).forEach(function (row) { if (row && row.id === id) found = row; });
    return found;
  }
  function daySheetHtml() {
    if (state.sheet.loggedId) return loggedSheetHtml();
    var row = entryById(state.sheet.entryId);
    var actions = row && row.guestCircuit ? [] : (row ? P.entryMenu(contextForOwner(row.ownerId)) : []);
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" id="pv-day-sheet" role="dialog" aria-label="This workout">' +
      '<div class="pv-grab" data-sheet-grab="1" role="button" aria-label="Close"></div>';
    if (!row) h += '<p class="mute">That workout is no longer on this day.</p>';
    else h += dayWorkoutHtml(row, actions);
    return h + '</div></div>';
  }
  function loggedSheetHtml() {
    var row = loggedById(state.sheet.loggedId);
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" id="pv-day-sheet" role="dialog" aria-label="This workout">' +
      '<div class="pv-grab" data-sheet-grab="1" role="button" aria-label="Close"></div>';
    if (!row) h += '<p class="mute">That workout is no longer on this day.</p>';
    else {
      var name = loggedName(row);
      var actions = P.entryMenu(contextForOwner(row.ownerId)).filter(function (action) { return action === 'run' || action === 'view'; });
      h += '<div class="pv-slot"><h3 class="name pv-slot-title">' + check(true) + '<span>' + esc(name) + '</span></h3>';
      h += '<p class="mute">' + esc(prettyDate(row.date)) + ' · Completed, not scheduled</p>';
      if (actions.indexOf('view') >= 0) h += '<button type="button" data-view-wo="' + esc(row.workoutId) + '">View</button>';
      if (actions.indexOf('run') >= 0) h += '<button type="button" class="pri" data-run="' + esc(row.workoutId) + '">Run</button>';
      h += openErrorHtml() + '</div>';
    }
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
      h += '<div class="pv-times"><div><label for="pv-start-' + esc(row.id) + '">Start</label><input id="pv-start-' + esc(row.id) + '" data-time="start" data-entry="' + esc(row.id) + '" type="time" value="' + esc(draft.start || '') + '"></div>' +
        '<div><label for="pv-end-' + esc(row.id) + '">End</label><input id="pv-end-' + esc(row.id) + '" data-time="end" data-entry="' + esc(row.id) + '" type="time" value="' + esc(draft.end || '') + '"></div></div>';
    } else if (when) h += '<p class="pv-when">' + esc(when) + '</p>';
    if (draft.error) h += '<p class="errs" id="pv-sheet-error">' + esc(draft.error) + '</p>';
    if (actions.indexOf('view') >= 0) h += '<button type="button" data-view-wo="' + esc(row.workoutId) + '" data-entry="' + esc(row.id) + '">View</button>';
    if (actions.indexOf('run') >= 0) h += '<button type="button" class="pri" data-run="' + esc(row.workoutId) + '" data-entry="' + esc(row.id) + '">Run</button>';
    if (editing) h += '<button type="button" data-sheet="times" data-entry="' + esc(row.id) + '">Save times</button>';
    if (actions.indexOf('remove') >= 0) h += '<button type="button" class="danger" data-sheet="remove" data-entry="' + esc(row.id) + '">Remove workout</button>';
    return h + openErrorHtml() + '</div>';
  }
  function ampmHtml(which, selected) {
    function btn(ap) {
      var on = selected === ap;
      return '<button type="button" data-ampm="' + which + '" data-ap="' + ap + '"' + (on ? ' class="on"' : '') + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + ap + '</button>';
    }
    var label = which === 'end' ? 'End AM or PM' : 'Start AM or PM';
    return '<div class="pv-ampm" role="group" aria-label="' + label + '">' + btn('AM') + btn('PM') + '</div>';
  }
  function timePart(which, part, value, bad) {
    var id = (which === 'end' ? 'pv-end' : 'pv-start') + '-' + part;
    var label = (which === 'end' ? 'End' : 'Start') + (part === 'h' ? ' hour' : ' minute');
    var cls = bad ? ' class="is-empty"' : '';
    var invalid = bad ? ' aria-invalid="true"' : '';
    return '<input id="' + id + '"' + cls + ' data-clock="' + which + '" data-part="' + part + '" data-clear="1" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="' + (part === 'h' ? 'HH' : 'MM') + '" aria-label="' + label + '" value="' + esc(value || '') + '"' + invalid + '>';
  }
  function timeField(which, hour, minute, ap) {
    var label = which === 'end' ? 'End' : 'Start';
    var hourId = (which === 'end' ? 'pv-end' : 'pv-start') + '-h';
    var period = ap === 'PM' ? 'PM' : 'AM';
    var bad = (state.sheet && state.sheet.bad && state.sheet.bad[which]) || [];
    return '<label for="' + hourId + '">' + label + '</label><div class="pv-time">' +
      timePart(which, 'h', hour, bad.indexOf('h') >= 0) +
      '<span class="pv-colon" aria-hidden="true">:</span>' +
      timePart(which, 'm', minute, bad.indexOf('m') >= 0) +
      ampmHtml(which, period) + '</div>';
  }
  function addTargets() {
    var self = state.userId || 'self';
    var list = [{ id: self, label: 'Me' }];
    if (!viewingAll()) return list;
    (state.clients || []).forEach(function (client) {
      if (!clientShown(client) || !canEditOwner(client.id)) return;
      list.push({ id: client.id, label: clientVisible(client) });
    });
    return list;
  }
  function inviteName(client) {
    var raw = String((client && (client.display_name || client.name)) || '').replace(/^\s+|\s+$/g, '');
    if (!raw || raw.indexOf('@') !== -1) return 'Client';
    return raw.length > 80 ? raw.slice(0, 80) : raw;
  }
  function inviteHtml(sheet, target) {
    var workout = workoutById(sheet.workoutId);
    if (!workout || !workout.circuit || !ownerIsSelf(target)) return '';
    var picked = {};
    (sheet.invites || []).forEach(function (id) { if (id) picked[id] = 1; });
    var h = '<div class="pv-invites" id="pv-invites" role="group" aria-label="Invite clients">';
    var any = false;
    (state.clients || []).forEach(function (client) {
      if (!client || !client.id) return;
      var name = inviteName(client);
      var on = !!picked[client.id];
      any = true;
      h += '<button type="button" class="pv-invite' + (on ? ' on' : '') + '" data-invite="' + esc(client.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(name) + '</button>';
    });
    if (!any) return '';
    return h + '</div>';
  }
  function addSheetHtml() {
    var sheet = state.sheet;
    var target = viewingAll() ? (sheet.ownerId || selfId()) : ownerId();
    var list = choicesFor(target);
    var h = '<div class="pv-sheet" id="pv-sheet"><div class="pv-sheet-card" role="dialog" aria-label="Add a workout">' +
      '<h3 class="name">Add a workout</h3><p class="mute">' + esc(prettyDate(sheet.date)) + '</p>';
    var targets = addTargets();
    if (viewingAll() && targets.length > 1) {
      h += '<label class="mute" for="pv-add-who">Calendar</label><select id="pv-add-who">';
      targets.forEach(function (person) {
        var selected = (sheet.ownerId || state.userId || 'self') === person.id ? ' selected' : '';
        h += '<option value="' + esc(person.id) + '"' + selected + '>' + esc(person.label) + '</option>';
      });
      h += '</select>';
    }
    if (sheet.dropped && sheet.workoutId) {
      var chosen = workoutById(sheet.workoutId);
      h += '<p class="pv-dropped" id="pv-dropped">' + esc(chosen ? (chosen.name || 'Workout') : 'Workout') + '</p>';
    } else {
      if (!list.length) h += '<p class="mute">No workouts yet. Build one from the workout list first.</p>';
      h += '<div class="pv-picks" role="listbox" aria-label="Your workouts">';
      list.forEach(function (w) {
        h += '<button type="button" class="pv-pick' + (w.id === sheet.workoutId ? ' on' : '') + '" data-pick="' + esc(w.id) + '"><span class="name">' + esc(w.name || 'Workout') + '</span><span class="mute">' + esc(choiceMeta(w)) + '</span></button>';
      });
      h += '</div>';
    }
    h += inviteHtml(sheet, target);
    h += presenceChoice('pv-presence', sheet.presence || '', '') +
      timeField('start', sheet.startH, sheet.startM, sheet.startAp) +
      timeField('end', sheet.endH, sheet.endM, sheet.endAp);
    if (sheet.error) h += '<p class="errs" id="pv-sheet-error">' + esc(sheet.error) + '</p>';
    return h + '<button type="button" class="pri" data-sheet="save">Add to this day</button><button type="button" data-sheet="cancel">Cancel</button></div></div>';
  }
  function openErrorHtml() {
    if (!state.sheet || !state.sheet.openError) return '';
    return '<p class="errs" id="pv-open-error">' + esc(state.sheet.openError) + '</p>';
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
    state.focusClientPlay = null;
    state.playerLive = false;
    state.screen = 'home';
    if (window.WBPlayer) WBPlayer.unmount();
    render();
  }
  // A blank set count still has an exercise to look at. The saved workout is not changed.
  function viewItem(item) {
    var next = item;
    try {
      if (window.WB && WB.normalizeExercise) next = WB.normalizeExercise(item);
    } catch (e) { next = item; }
    if (!next || (typeof next.sets === 'number' && next.sets >= 1)) return next;
    var copy = next;
    try { copy = JSON.parse(JSON.stringify(next)); } catch (e2) {}
    if (copy) copy.sets = 1;
    return copy;
  }
  // Same player the calendar opens for View: real player, track off, nothing saved.
  function openView(root, workout, onLeave) {
    if (!root || !workout || !workout.items || !workout.items.length || !window.WBPlayer) return false;
    var playableW = {
      id: workout.id,
      name: workout.name,
      items: workout.items.map(viewItem).filter(Boolean)
    };
    if (!playableW.items.length) return false;
    root.innerHTML = '';
    root.onclick = null;
    root.onchange = null;
    root.oninput = null;
    root.onpointerdown = null;
    window.__wbClockOffset = 0;
    try {
      WBPlayer.mount(root, playableW, { version: 4, workouts: [], sessions: [] }, function () {}, onLeave || function () {}, { track: false });
    } catch (e) {
      WBPlayer.unmount();
      document.body.classList.remove('playing');
      return false;
    }
    window.scrollTo(0, 0);
    return true;
  }
  function openRealPlayer(track) {
    if (state.playerLive) return;
    if (track === false) {
      var previewWorkout = state.focusClientPlay || workoutById(state.focusWorkout);
      if (!openView(app, previewWorkout, leavePlayer)) {
        state.focusClientPlay = null;
        state.screen = 'home';
        state.playerLive = false;
        state.hint = 'Add an exercise before running this workout.';
        render();
        return;
      }
      state.focusClientPlay = null;
      state.playerLive = true;
      return;
    }
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
    app.oninput = null;
    app.onpointerdown = null;
    window.__wbClockOffset = 0;
    var scratch = { version: 4, workouts: [], sessions: [] };
    var opts = { track: true };
    if (state.focusEntry) opts.programId = state.focusEntry;
    opts.reschedule = {
      role: function () { return state && state.role; },
      entries: function () { return (data() && data().programs) || []; },
      go: options && options.go
    };
    WBPlayer.mount(app, workout, scratch, function () {}, leavePlayer, opts);
    window.scrollTo(0, 0);
  }
  function applyChrome() {
    if (titleEl && !(state && state.screen === 'player')) titleEl.textContent = 'Calendar';
    if (!backBtn) return;
    backBtn.hidden = !(state && (state.screen === 'player' || state.playerLive));
  }
  function returnsToList(sheet) {
    if (!sheet || !sheet.date) return false;
    if (sheet.type === 'day' && (sheet.entryId || sheet.loggedId)) return true;
    if (sheet.type === 'add' && sheet.returnTo === 'list') return true;
    return false;
  }
  function overlayDepth() {
    if (!state) return 0;
    if (state.playerLive || state.screen === 'player') return 1;
    if (!state.sheet) return 0;
    if (returnsToList(state.sheet)) return 2;
    return 1;
  }
  function pushTrap() {
    try {
      history.pushState({ wbProgramsOverlay: 1 }, '', location.href);
      historyDepth++;
    } catch (e) {}
  }
  function consumeOne() {
    if (!historyDepth) return;
    var ours = false;
    try { ours = !!(history.state && history.state.wbProgramsOverlay === 1); } catch (e) {}
    if (!ours) { historyDepth = 0; return; }
    historyDepth--;
    ignorePop++;
    try { history.back(); } catch (e2) { ignorePop = Math.max(0, ignorePop - 1); }
  }
  function syncHistory() {
    if (!state) return;
    var want = overlayDepth();
    var guard = 0;
    while (historyDepth < want && guard < 4) { pushTrap(); guard++; }
    guard = 0;
    while (historyDepth > want && guard < 4) { consumeOne(); guard++; }
  }
  function showList(date) {
    state.sheet = { type: 'list', date: date };
    state.hint = '';
    render();
  }
  function closeSheetLayer() {
    if (!state || !state.sheet) return;
    if (returnsToList(state.sheet)) { showList(state.sheet.date); return; }
    state.sheet = null;
    render();
  }
  // Browser back already popped one overlay entry. An in-progress tracked
  // workout uses the End button's confirm and finish path, then returns to
  // the calendar. Cancel puts the history entry back and leaves the player running.
  // A workout or add window opened from the day list returns to that list.
  function onProgramsPop() {
    if (ignorePop) { ignorePop--; return; }
    if (!historyDepth || !state) return;
    historyDepth--;
    if (state.playerLive || state.screen === 'player') {
      var live = window.__wbPlayer;
      if (live && live.track !== false && !live.done && window.WBPlayer) {
        WBPlayer.requestEnd();
        live = window.__wbPlayer;
        if (state.playerLive && live && !live.done) {
          pushTrap();
          return;
        }
      }
      if (state.playerLive || state.screen === 'player') leavePlayer();
      return;
    }
    if (state.sheet) closeSheetLayer();
  }
  function render() {
    if (!app || !state) return;
    document.body.classList.add('pv-on');
    if (state.screen === 'player') {
      openRealPlayer(state.playerMode !== 'view');
      applyChrome();
      if (state.screen === 'player') syncHistory();
      return;
    }
    closeRealPlayer();
    app.innerHTML = homeHtml();
    applyChrome();
    app.onclick = onClick;
    app.onchange = onChange;
    app.oninput = onInput;
    app.onpointerdown = onPointerDown;
    syncHistory();
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
    if (!date) return;
    showList(date);
  }
  function openEntry(row) {
    if (!row) return;
    var drafts = {};
    drafts[row.id] = { start: row.start || '', end: row.end || '', error: '' };
    state.sheet = { type: 'day', date: row.date, entryId: row.id, drafts: drafts };
    state.hint = '';
    render();
  }
  function openLogged(row) {
    if (!row) return;
    state.sheet = { type: 'day', date: row.date, entryId: '', loggedId: row.id, workoutId: row.workoutId, ownerId: row.ownerId };
    state.hint = '';
    render();
  }
  var TIME_KEY = 'wb.addWorkoutTimes.v1';
  function timeBag() {
    try {
      var raw = localStorage.getItem(TIME_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }
  function rememberedClock() {
    var id = (state && state.userId) || 'self';
    var row = timeBag()[id];
    if (row) {
      var times = P.validTimes(row.start, row.end);
      if (times.ok) return { start: times.start, end: times.end };
    }
    return { start: '09:00', end: '10:00' };
  }
  function rememberClock(start, end) {
    var id = (state && state.userId) || 'self';
    var all = timeBag();
    all[id] = { start: start, end: end };
    try { localStorage.setItem(TIME_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function clockParts(value, fallbackH, fallbackM, fallbackAp) {
    var shown = P.clock12(value);
    if (!shown) return { h: fallbackH, m: fallbackM, ap: fallbackAp };
    var bits = shown.text.split(':');
    return { h: bits[0] || fallbackH, m: bits[1] || fallbackM, ap: shown.ap || fallbackAp };
  }
  function openAdd(date, workoutId, dropped, fromList) {
    var remembered = rememberedClock();
    var start = clockParts(remembered.start, '09', '00', 'AM');
    var end = clockParts(remembered.end, '10', '00', 'AM');
    state.sheet = {
      type: 'add',
      date: date,
      workoutId: workoutId || '',
      dropped: !!dropped && !!workoutId,
      startH: start.h,
      startM: start.m,
      startAp: start.ap,
      endH: end.h,
      endM: end.m,
      endAp: end.ap,
      presence: '',
      error: '',
      bad: null,
      ownerId: viewingAll() ? (state.userId || 'self') : '',
      invites: [],
      returnTo: fromList ? 'list' : ''
    };
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
      function readPart(which, part) {
        var el = document.querySelector('#pv-sheet input[data-clock="' + which + '"][data-part="' + part + '"]');
        return el ? el.value : '';
      }
      state.sheet.startH = readPart('start', 'h');
      state.sheet.startM = readPart('start', 'm');
      state.sheet.endH = readPart('end', 'h');
      state.sheet.endM = readPart('end', 'm');
      var startAp = document.querySelector('#pv-sheet [data-ampm="start"].on');
      var endAp = document.querySelector('#pv-sheet [data-ampm="end"].on');
      if (startAp) state.sheet.startAp = startAp.getAttribute('data-ap') === 'PM' ? 'PM' : 'AM';
      if (endAp) state.sheet.endAp = endAp.getAttribute('data-ap') === 'PM' ? 'PM' : 'AM';
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
    if (!sheet.workoutId) { sheet.error = 'Pick a workout.'; sheet.bad = null; render(); return; }
    var startBits = clockIssue(sheet.startH, sheet.startM);
    var endBits = clockIssue(sheet.endH, sheet.endM);
    if (startBits.bad.length || endBits.bad.length) {
      sheet.bad = { start: startBits.bad, end: endBits.bad };
      sheet.error = (startBits.empty || endBits.empty) ? 'Fill in the highlighted fields.' : 'Use an hour from 1 to 12 and minutes from 00 to 59.';
      render();
      return;
    }
    sheet.bad = null;
    var start = P.clock24(startBits.h + ':' + startBits.m, sheet.startAp);
    var end = P.clock24(endBits.h + ':' + endBits.m, sheet.endAp);
    if (!start.ok || !end.ok) {
      sheet.bad = { start: start.ok ? [] : ['h', 'm'], end: end.ok ? [] : ['h', 'm'] };
      sheet.error = (start.empty || end.empty) ? 'Fill in the highlighted fields.' : 'Use an hour from 1 to 12 and minutes from 00 to 59.';
      render();
      return;
    }
    var times = P.validTimes(start.value, end.value);
    if (!times.ok) { sheet.error = times.error; render(); return; }
    var workout = workoutById(sheet.workoutId);
    if (!workout) { sheet.error = 'Pick a workout.'; render(); return; }
    var owner = ownerId();
    if (viewingAll()) {
      var picked = document.getElementById('pv-add-who');
      owner = (picked && picked.value) || sheet.ownerId || state.userId || 'self';
    }
    if (!canEditOwner(owner)) { sheet.error = 'You cannot add to that calendar.'; render(); return; }
    if (workout.circuit && !ownerIsSelf(owner)) { sheet.error = 'You cannot add to that calendar.'; render(); return; }
    var invites = null;
    if (workout.circuit && ownerIsSelf(owner)) invites = Array.isArray(sheet.invites) ? sheet.invites.slice() : [];
    var placed = P.place(data().programs, {
      id: window.WB.uid('pg'),
      ownerId: owner,
      workoutId: workout.id,
      workoutName: workout.name,
      items: workout.circuit ? [circuitMarker(workout.id)] : workout.items,
      date: sheet.date,
      start: times.start,
      end: times.end,
      presence: sheet.presence,
      invites: invites
    });
    if (placed.duplicate) { sheet.error = 'That workout is already on this day.'; render(); return; }
    if (!placed.created) { sheet.error = placed.error || 'Pick a workout.'; render(); return; }
    rememberClock(times.start, times.end);
    var backTo = sheet.returnTo === 'list' ? sheet.date : '';
    state.sheet = null;
    state.cursor = sheet.date;
    state.month = sheet.date.slice(0, 7);
    savePrograms(placed.programs, 'Saved on this device.');
    if (backTo) state.sheet = { type: 'list', date: backTo };
    render();
    var created = placed.created;
    pushRemote(created).then(function (result) {
      if (!result || result.skipped || result.ok !== false) return;
      if (!state) return;
      state.remote = (result.error && result.error.message) || 'Could not save that day.';
      render();
    });
  }
  function saveEntryTimes(id) {
    readSheetTimes();
    var sheet = state.sheet;
    if (!sheet || sheet.type !== 'day' || !sheet.drafts || !sheet.drafts[id] || !data()) return false;
    if (!canEditRow(entryById(id))) return false;
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
    if (!sheet || !data() || !id || !canEditRow(entryById(id))) return;
    var date = sheet.date;
    var result = P.remove(data().programs, id);
    if (!result.removed) { render(); return; }
    pushEpoch[id] = (pushEpoch[id] || 0) + 1;
    noteDrop(id, result.removed.ownerId);
    savePrograms(result.programs, 'Removed from this day.');
    dropRemote(result.removed);
    if (date) state.sheet = { type: 'list', date: date };
    else state.sheet = null;
    render();
  }
  function dropOn(kind, id, date) {
    if (!date || !data()) return;
    if (kind === 'session') {
      var current = entryById(id);
      if (!current || !canEditRow(current)) return;
      var owner = current.ownerId;
      var result = P.move(data().programs, id, date);
      if (result.moved && result.moved.ownerId !== owner) return;
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
    if (!canEditHere()) return;
    var workout = workoutById(id);
    if (!workout) return;
    openAdd(date, workout.id, true);
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
  function startSheetGrab(e) {
    if (!state || !state.sheet) return;
    var startY = e.clientY;
    var card = e.target.closest('.pv-sheet-card');
    function move(ev) {
      var dy = Math.max(0, ev.clientY - startY);
      if (card) card.style.transform = 'translateY(' + dy + 'px)';
    }
    function up(ev) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (card) card.style.transform = '';
      if (ev.clientY - startY > 48) closeSheetLayer();
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest && e.target.closest('[data-sheet-grab]')) { startSheetGrab(e); return; }
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
        refreshAddNotice();
        render();
        return;
      }
      if (state.sheet.type === 'day' && canEditRow(entryById(radio.getAttribute('data-entry')))) {
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
    if (e.target.id === 'pv-add-who' && state.sheet && state.sheet.type === 'add') {
      readSheetTimes();
      state.sheet.ownerId = e.target.value;
      if (!ownerIsSelf(state.sheet.ownerId) && circuitById(state.sheet.workoutId)) state.sheet.workoutId = '';
      render();
      return;
    }
    if (e.target.id !== 'pv-client') return;
    clientViewToken++;
    state.clientId = e.target.value;
    state.clientShare = null;
    state.clientShareFresh = false;
    state.remoteSessions = [];
    state.hint = '';
    state.sheet = null;
    state.screen = 'home';
    render();
    loadClientShare(++loadToken);
  }
  function clockIssue(hour, minute) {
    var h = String(hour == null ? '' : hour).trim();
    var m = String(minute == null ? '' : minute).trim();
    var hn = /^\d{1,2}$/.test(h) ? Number(h) : NaN;
    var mn = /^\d{2}$/.test(m) ? Number(m) : NaN;
    var bad = [];
    if (!(hn >= 1 && hn <= 12)) bad.push('h');
    if (!(mn >= 0 && mn <= 59)) bad.push('m');
    return { h: h, m: m, bad: bad, empty: !h || !m };
  }
  function clockPartOk(part, value) {
    if (part === 'h') return /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 12;
    return /^\d{2}$/.test(value) && Number(value) <= 59;
  }
  function refreshAddNotice() {
    var sheet = state.sheet;
    if (!sheet || sheet.type !== 'add') return;
    var marked = sheet.bad && ((sheet.bad.start && sheet.bad.start.length) || (sheet.bad.end && sheet.bad.end.length));
    if (!marked) {
      sheet.error = '';
      sheet.bad = null;
      return;
    }
    var startBits = clockIssue(sheet.startH, sheet.startM);
    var endBits = clockIssue(sheet.endH, sheet.endM);
    if (startBits.bad.length || endBits.bad.length) {
      sheet.bad = { start: startBits.bad, end: endBits.bad };
      sheet.error = (startBits.empty || endBits.empty) ? 'Fill in the highlighted fields.' : 'Use an hour from 1 to 12 and minutes from 00 to 59.';
      return;
    }
    sheet.bad = null;
    sheet.error = '';
  }
  function runnableWorkout(id) {
    var workout = workoutById(id);
    if (workout && workout.circuit) return true;
    if (!workout || !window.WB || !WB.validateExercise) return true;
    return !(workout.items || []).some(function (it) {
      var c = it.modeConfig || {};
      if (!Number.isInteger(it.sets) || it.sets < 1) return true;
      if (it.mode === 'reps' || it.mode === 'intervals' || it.mode === 'timer') {
        if (c.repsType === 'number' && !(Number.isInteger(c.count) && c.count >= 1)) return true;
        if (c.repsType === 'range' && (!(Number.isInteger(c.min) && c.min >= 1) || !(Number.isInteger(c.max) && c.max >= 1))) return true;
      }
      if (it.mode === 'intervals' && !(c.workSec > 0)) return true;
      if (it.mode === 'timer' && (!(c.workSec > 0) || !(typeof c.restSec === 'number' && c.restSec >= 0))) return true;
      if (it.mode === 'stopwatch' && c.lapsEnabled !== false && !(Number.isInteger(c.lapCount) && c.lapCount >= 1)) return true;
      return false;
    });
  }
  function cloneList(items) {
    try { return JSON.parse(JSON.stringify(items)); } catch (e) { return items; }
  }
  function playableCopy(workout, fallbackId, fallbackName) {
    if (!workout || !Array.isArray(workout.items) || !workout.items.length) return null;
    return {
      id: String(workout.id || fallbackId || ''),
      name: workout.name || fallbackName || 'Workout',
      items: cloneList(workout.items)
    };
  }
  // The copy stored on that client's calendar entry. Never the trainer's library.
  function clientEntrySnapshot(ownerId, workoutId) {
    var found = null;
    var rows = data() && data().programs;
    (rows || []).forEach(function (row) {
      if (!row || row.ownerId !== ownerId || String(row.workoutId || '') !== String(workoutId || '')) return;
      var play = playableCopy({ id: row.workoutId, name: row.workoutName, items: row.items }, workoutId, row.workoutName);
      if (play) found = play;
    });
    return found;
  }
  function completedClientRow(node) {
    if (!viewingAll() || !state || !state.sheet || state.sheet.type !== 'day' || !node) return null;
    var entryId = node.getAttribute('data-entry') || '';
    var row = entryId ? entryById(entryId) : (state.sheet.loggedId ? loggedById(state.sheet.loggedId) : null);
    if (!row || !row.ownerId) return null;
    var selfId = state.userId || 'self';
    if (row.ownerId === selfId || row.ownerId === 'self') return null;
    if (!clientById(row.ownerId)) return null;
    if (entryId && !P.entryDone(row, sessions())) return null;
    return row;
  }
  function showClientPlayer(workout) {
    state.focusClientPlay = workout;
    state.focusWorkout = workout.id;
    state.focusEntry = '';
    state.playerMode = 'view';
    state.screen = 'player';
    state.sheet = null;
    render();
  }
  function openClientCompleted(row) {
    if (!row || !state || !state.sheet || state.sheet.type !== 'day') return;
    var entryId = state.sheet.entryId || '';
    if (entryId && canEditRow(row)) {
      readSheetTimes();
      var draft = state.sheet.drafts && state.sheet.drafts[entryId];
      var edited = draft && ((draft.start || '') !== (row.start || '') || (draft.end || '') !== (row.end || ''));
      if (edited && !saveEntryTimes(entryId)) return;
      if (!state.sheet || state.sheet.type !== 'day') return;
    }
    var request = ++clientViewToken;
    var generation = loadToken;
    var loggedId = state.sheet.loggedId || '';
    var date = state.sheet.date || '';
    state.sheet.viewRequest = request;
    state.sheet.openError = '';
    var owner = row.ownerId;
    var workoutId = String(row.workoutId || '');
    var load = options && options.loadClientWorkout;
    var pending = load
      ? Promise.resolve().then(function () { return load(owner, workoutId); })
      : Promise.resolve(null);
    function finish(workout) {
      if (!state || request !== clientViewToken || generation !== loadToken) return;
      var sheet = state.sheet;
      if (!viewingAll() || !sheet || sheet.type !== 'day' || sheet.viewRequest !== request) return;
      if ((sheet.entryId || '') !== entryId || (sheet.loggedId || '') !== loggedId || (sheet.date || '') !== date) return;
      var play = playableCopy(workout, workoutId, row.workoutName) || playableCopy({
        id: row.workoutId,
        name: row.workoutName,
        items: row.items
      }, workoutId, row.workoutName) || clientEntrySnapshot(owner, workoutId);
      if (!play) {
        sheet.openError = 'Could not open that workout.';
        render();
        return;
      }
      showClientPlayer(play);
    }
    pending.then(finish, function () { finish(null); });
  }
  function playFrom(node, mode) {
    state.focusClientPlay = null;
    var workoutId = node.getAttribute(mode === 'view' ? 'data-view-wo' : 'data-run');
    var entryId = node.getAttribute('data-entry') || '';
    if (state.sheet && state.sheet.type === 'day' && canEdit() && entryId) {
      readSheetTimes();
      var draft = state.sheet.drafts && state.sheet.drafts[entryId];
      var row = entryById(entryId);
      var edited = draft && row && ((draft.start || '') !== (row.start || '') || (draft.end || '') !== (row.end || ''));
      if (edited && !saveEntryTimes(entryId)) return;
    }
    var circuit = circuitById(workoutId);
    if (circuit) {
      if (!P.isTrainer(state.role)) {
        if (state.sheet) {
          state.sheet.openError = 'Could not open that workout.';
          render();
        }
        return;
      }
      if (options && options.go) {
        options.go('#/circuits/' + encodeURIComponent(circuit.id) + (mode === 'view' ? '/view' : '/prepare') + '?from=calendar');
      }
      return;
    }
    if (mode === 'run' && !runnableWorkout(workoutId)) {
      if (options && options.toast) options.toast('Fill in every number before running this workout.');
      return;
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
  function onInput(e) {
    if (!state || !state.sheet || state.sheet.type !== 'add') return;
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var which = el.getAttribute('data-clock');
    var part = el.getAttribute('data-part');
    if ((which !== 'start' && which !== 'end') || (part !== 'h' && part !== 'm')) return;
    var next = String(el.value || '').replace(/\D/g, '').slice(0, 2);
    if (next !== el.value) el.value = next;
    state.sheet[(which === 'end' ? 'end' : 'start') + (part === 'h' ? 'H' : 'M')] = next;
    if (!clockPartOk(part, next)) return;
    el.classList.remove('is-empty');
    el.removeAttribute('aria-invalid');
    var removed = false;
    if (state.sheet.bad && state.sheet.bad[which]) {
      var before = state.sheet.bad[which].length;
      state.sheet.bad[which] = state.sheet.bad[which].filter(function (p) { return p !== part; });
      removed = state.sheet.bad[which].length !== before;
    }
    var left = state.sheet.bad && ((state.sheet.bad.start && state.sheet.bad.start.length) || (state.sheet.bad.end && state.sheet.bad.end.length));
    if (removed && !left) {
      state.sheet.bad = null;
      state.sheet.error = '';
      var note = document.getElementById('pv-sheet-error');
      if (note) note.remove();
    }
  }
  function onClick(e) {
    if (!state) return;
    if (e.target.id === 'pv-sheet') { closeSheetLayer(); return; }
    var ampm = e.target.closest('[data-ampm]');
    if (ampm && state.sheet && state.sheet.type === 'add') {
      readSheetTimes();
      var which = ampm.getAttribute('data-ampm');
      var ap = ampm.getAttribute('data-ap') === 'PM' ? 'PM' : 'AM';
      if (which === 'end') state.sheet.endAp = ap;
      else state.sheet.startAp = ap;
      refreshAddNotice();
      render();
      return;
    }
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
    var invite = e.target.closest('[data-invite]');
    if (invite && state.sheet && state.sheet.type === 'add') {
      var inviteId = invite.getAttribute('data-invite');
      var list = (state.sheet.invites || []).slice();
      var at = list.indexOf(inviteId);
      if (at >= 0) list.splice(at, 1);
      else list.push(inviteId);
      state.sheet.invites = list;
      render();
      return;
    }
    var pick = e.target.closest('[data-pick]');
    if (pick && state.sheet && state.sheet.type === 'add') {
      readSheetTimes();
      state.sheet.workoutId = pick.getAttribute('data-pick');
      refreshAddNotice();
      render();
      return;
    }
    var sheetBtn = e.target.closest('[data-sheet]');
    if (sheetBtn && state.sheet) {
      var action = sheetBtn.getAttribute('data-sheet');
      if (action === 'cancel') { closeSheetLayer(); return; }
      if (action === 'save') { confirmAdd(); return; }
      if (action === 'times') { saveEntryTimes(sheetBtn.getAttribute('data-entry')); return; }
      if (action === 'remove') { removeScheduled(sheetBtn.getAttribute('data-entry')); return; }
      if (action === 'add-day') {
        if (!canEditHere() || !state.sheet || !state.sheet.date) return;
        openAdd(state.sheet.date, '', false, true);
        return;
      }
      if (action === 'add') {
        var again = entryById(sheetBtn.getAttribute('data-entry'));
        var addDate = (again && again.date) || state.sheet.date;
        if (!addDate) { state.sheet = null; render(); return; }
        openAdd(addDate, '', false, true);
        return;
      }
    }
    var loggedBtn = e.target.closest('[data-open-logged]');
    if (loggedBtn && state.sheet && state.sheet.type === 'list') {
      var logged = loggedById(loggedBtn.getAttribute('data-open-logged'));
      if (logged) openLogged(logged);
      return;
    }
    var rowBtn = e.target.closest('[data-open-entry]');
    if (rowBtn && state.sheet && state.sheet.type === 'list') {
      var picked = entryById(rowBtn.getAttribute('data-open-entry'));
      if (picked) openEntry(picked);
      return;
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
    if (presenceBtn && canEditRow(entryById(presenceBtn.getAttribute('data-presence')))) {
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
    if (view) {
      var doneRow = completedClientRow(view);
      if (doneRow) { openClientCompleted(doneRow); return; }
      playFrom(view, 'view');
      return;
    }
    var run = e.target.closest('[data-run]');
    if (run) playFrom(run, 'run');
  }
  function guestClock(value) {
    var match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
    return match ? match[1] + ':' + match[2] : '';
  }
  function shapeGuest(row, clientId) {
    var day = String(row && (row.day || row.date) || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !clientId) return null;
    var name = String(row.circuit_name || row.circuitName || '').replace(/^\s+|\s+$/g, '');
    if (!name || name.indexOf('@') !== -1) name = 'Circuit';
    var start = guestClock(row.starts_at || row.start || '');
    var end = guestClock(row.ends_at || row.end || '');
    var placement = String(row.placement_id || row.placementId || '').replace(/^\s+|\s+$/g, '');
    var workoutId = placement
      ? 'guest:' + placement + ':' + clientId
      : 'guest:' + day + ':' + start + ':' + name;
    return {
      id: workoutId,
      ownerId: clientId,
      workoutId: workoutId,
      workoutName: name,
      items: [{ source: 'circuit', guest: true }],
      date: day,
      start: start,
      end: end,
      presence: 'trainer',
      guestCircuit: true
    };
  }
  function pullGuestCircuits() {
    if (!options || !options.loadGuestCircuits || !state) return;
    if (viewingAll()) {
      if (state.circuitGuests.length) {
        state.circuitGuests = [];
        if (state.ready && state.screen === 'home' && !state.playerLive) render();
      }
      return;
    }
    var id = ownerId();
    if (!id) return;
    var token = loadToken;
    Promise.resolve().then(function () { return options.loadGuestCircuits(id); }).then(function (rows) {
      if (!state || token !== loadToken) return;
      var out = [];
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        var shaped = shapeGuest(row, id);
        if (shaped) out.push(shaped);
      });
      state.circuitGuests = out;
      if (state.ready && state.screen === 'home' && !state.playerLive) render();
    }, function () {
      if (!state || token !== loadToken) return;
      state.circuitGuests = [];
    });
  }
  function showCalendar() {
    if (!state) return;
    state.ready = true;
    render();
    pullRemote();
    pullSessions();
    pullGuestCircuits();
  }
  function enthusiastClients() {
    return (state.clients || []).filter(isEnthusiastClient);
  }
  function loadAllShares(token) {
    var people = enthusiastClients();
    if (!people.length || !options.loadClient) { showCalendar(); return; }
    Promise.all(people.map(function (client) {
      return Promise.resolve().then(function () { return options.loadClient(client.id); }).then(function (status) {
        return { id: client.id, status: status || null };
      }, function () {
        return { id: client.id, status: null };
      });
    })).then(function (rows) {
      if (!state || token !== loadToken) return;
      var shares = {};
      rows.forEach(function (row) { shares[row.id] = row.status; });
      state.shares = shares;
      state.clientShareFresh = false;
      showCalendar();
    });
  }
  function rememberClientShare(status) {
    state.clientShare = status;
    state.clientShareFresh = true;
    if (!state.shares) state.shares = {};
    if (state.clientId) state.shares[state.clientId] = status;
  }
  function loadClientShare(token) {
    if (!state || token !== loadToken) return;
    if (viewingAll()) { loadAllShares(token); return; }
    if (!P.isTrainer(state.role) || !state.clientId || !options.loadClient) {
      showCalendar();
      return;
    }
    var requested = state.clientId;
    Promise.resolve().then(function () { return options.loadClient(requested); }).then(function (status) {
      if (!state || token !== loadToken || state.clientId !== requested) return;
      rememberClientShare(status || { shared: false, enthusiast: false, linked: true });
      state.ready = true;
      render();
      if (canSee()) { pullRemote(); pullSessions(); pullGuestCircuits(); }
    }, function () {
      if (!state || token !== loadToken || state.clientId !== requested) return;
      // Unknown share stays hidden. Do not read that person's sessions.
      rememberClientShare(null);
      state.ready = true;
      render();
      if (canSee()) { pullRemote(); pullSessions(); pullGuestCircuits(); }
    });
  }
  function pullCircuits(token) {
    if (!options || !options.loadCircuits) return;
    Promise.resolve().then(options.loadCircuits).then(function (rows) {
      if (!state || token !== loadToken) return;
      state.circuits = Array.isArray(rows) ? rows : [];
      if (state.ready && state.screen === 'home' && !state.playerLive) render();
    }, function () {
      if (!state || token !== loadToken) return;
      state.circuits = [];
    });
  }
  function refresh() {
    var token = ++loadToken;
    pullCircuits(token);
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
          if (state.clientId === 'all') {
            if (!clients.length) state.clientId = '';
          } else if (state.clientId && !clients.some(function (row) { return row.id === state.clientId; })) {
            state.clientId = clients.length ? 'all' : '';
          } else if (!state.clientId && clients.length) {
            state.clientId = 'all';
          }
          loadClientShare(token);
        });
      }
      if (state.role === 'enthusiast' && options.loadShare) {
        return Promise.resolve().then(options.loadShare).then(function (row) {
          if (!state || token !== loadToken) return;
          state.shareOn = row && typeof row.on === 'boolean' ? row.on : null;
          showCalendar();
        }, function () {
          if (!state || token !== loadToken) return;
          showCalendar();
        });
      }
      showCalendar();
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
    if (state.sheet) { closeSheetLayer(); return true; }
    if (state.screen === 'home') return false;
    state.screen = 'home';
    render();
    return true;
  }
  function mount(opts) {
    window.removeEventListener('popstate', onProgramsPop);
    historyDepth = 0;
    ignorePop = 0;
    clearDrag();
    options = opts || {};
    app = options.app;
    titleEl = options.titleEl;
    backBtn = options.backBtn;
    state = fresh();
    if (data() && !Array.isArray(data().programs)) data().programs = [];
    window.addEventListener('popstate', onProgramsPop);
    render();
    refresh();
  }
  function unmount() {
    window.removeEventListener('popstate', onProgramsPop);
    historyDepth = 0;
    ignorePop = 0;
    loadToken += 1;
    clientViewToken += 1;
    clearDrag();
    if (state && state.playerLive && window.WBPlayer) WBPlayer.unmount();
    document.body.classList.remove('playing');
    document.body.classList.remove('pv-on');
    if (app) {
      app.onpointerdown = null;
      app.onclick = null;
      app.onchange = null;
      app.oninput = null;
    }
    state = null;
    options = null;
  }
  window.WBPreview = { mount: mount, unmount: unmount, back: back, openView: openView, calendarOnPhone: calendarOnPhone, clientSelectHtml: clientSelectHtml };
})();
