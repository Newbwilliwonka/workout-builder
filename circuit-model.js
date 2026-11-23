/* Group circuit rules. No DOM and no network.
   Browser: window.WBCircuit. Node: require('./circuit-model.js').
   A circuit is stations on a grid, one closed loop, a client list, and a clock.
   Tracking is time per station. There are no reps and no weight. */
(function (root) {
  'use strict';

  var COLS = 4;
  var ROWS = 6;
  var STATION_MAX = COLS * ROWS;
  var NAME_MAX = 80;
  var CLIENT_MAX = 40;
  var CLOCK_MAX = 60 * 60;
  var ROUNDS_MAX = 99;
  var DATA_MAX = 80000;
  var WORK_DEFAULT = 45;
  var MOVE_DEFAULT = 15;
  var LIBRARY_ID = /^[A-Za-z0-9_-]{1,32}$/;
  var STATION_ID = /^st_[a-z0-9]{6,20}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var BANNED = { reps: 1, weight: 1, sets: 1, rest: 1, restSec: 1, repetitions: 1, mode: 1, modeConfig: 1 };

  function clean(value) {
    return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function newId() {
    var s = '';
    while (s.length < 12) s += Math.random().toString(36).slice(2);
    return 'st_' + s.replace(/[^a-z0-9]/g, '').slice(0, 10);
  }
  function utf8Length(text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function bytesOf(value) {
    try { return utf8Length(JSON.stringify(value)); }
    catch (e) { return DATA_MAX + 1; }
  }
  function exactKeys(obj, keys) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var got = Object.keys(obj).sort();
    var want = keys.slice().sort();
    if (got.length !== want.length) return false;
    for (var i = 0; i < got.length; i++) if (got[i] !== want[i]) return false;
    return true;
  }
  function exerciseKeysOk(exercise) {
    if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise)) return false;
    if (exercise.source === 'library') return exactKeys(exercise, ['source', 'name', 'libraryId']);
    if (exercise.source === 'manual') {
      if (exactKeys(exercise, ['source', 'name'])) return true;
      return exactKeys(exercise, ['source', 'name', 'libraryId']) && exercise.libraryId == null;
    }
    return false;
  }
  function hasBanned(value, depth) {
    if (!value || typeof value !== 'object' || depth > 8) return false;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) if (hasBanned(value[i], depth + 1)) return true;
      return false;
    }
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      if (BANNED[keys[k]]) return true;
      if (hasBanned(value[keys[k]], depth + 1)) return true;
    }
    return false;
  }
  function integer(value, lo, hi) {
    if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value) {
      if (value < lo || value > hi) return null;
      return value;
    }
    if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
      var n = Number(value);
      if (n >= lo && n <= hi) return n;
    }
    return null;
  }
  function publicName(value) {
    var text = clean(value);
    if (!text || text.indexOf('@') !== -1) return 'Client';
    return text.length > NAME_MAX ? text.slice(0, NAME_MAX) : text;
  }
  function initial(value) {
    return publicName(value).charAt(0).toUpperCase();
  }
  function blank() {
    return {
      name: '',
      stations: [],
      order: [],
      clients: [],
      clock: { workSec: WORK_DEFAULT, moveSec: MOVE_DEFAULT, rounds: 0 }
    };
  }
  function splitClock(sec) {
    var n = integer(sec, 0, CLOCK_MAX);
    if (n == null) n = 0;
    return { m: Math.floor(n / 60), s: n % 60 };
  }
  function joinClock(min, sec) {
    var m = clean(min);
    var s = clean(sec);
    if (!/^\d{1,4}$/.test(m) || !/^\d{1,2}$/.test(s)) return null;
    var mv = Number(m);
    var sv = Number(s);
    if (sv > 59) return null;
    var total = mv * 60 + sv;
    if (total > CLOCK_MAX) return null;
    return total;
  }
  function syncRounds(clock, count, follows) {
    var base = clock || {};
    var next = {
      workSec: base.workSec == null ? WORK_DEFAULT : base.workSec,
      moveSec: base.moveSec == null ? MOVE_DEFAULT : base.moveSec,
      rounds: base.rounds == null ? 0 : base.rounds
    };
    if (follows) next.rounds = count > 0 ? count : 0;
    return next;
  }
  function nextCell(stations) {
    var used = {};
    (stations || []).forEach(function (s) {
      if (s && typeof s.col === 'number' && typeof s.row === 'number') used[s.col + ',' + s.row] = 1;
    });
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (!used[c + ',' + r]) return { col: c, row: r };
      }
    }
    return null;
  }
  function addStation(doc) {
    var cell = nextCell(doc && doc.stations);
    if (!cell) return { ok: false, error: 'The grid is full.' };
    var next = clone(doc || blank());
    var station = { id: newId(), col: cell.col, row: cell.row, exercise: null };
    next.stations = (next.stations || []).concat([station]);
    return { ok: true, circuit: next, station: station };
  }
  function normalizeExercise(exercise) {
    if (!exercise || typeof exercise !== 'object') return null;
    var source = exercise.source === 'library' ? 'library' : (exercise.source === 'manual' ? 'manual' : '');
    var name = clean(exercise.name);
    if (!source || !name || name.indexOf('@') !== -1 || name.length > NAME_MAX) return null;
    if (source === 'manual') return { source: 'manual', name: name, libraryId: null };
    var libraryId = clean(exercise.libraryId);
    if (!LIBRARY_ID.test(libraryId)) return null;
    return { source: 'library', name: name, libraryId: libraryId };
  }
  function setExercise(doc, id, exercise) {
    var cleaned = normalizeExercise(exercise);
    if (!cleaned) return { ok: false, error: 'Choose an exercise.' };
    var next = clone(doc || blank());
    var found = false;
    next.stations = (next.stations || []).map(function (s) {
      if (!s || s.id !== id) return s;
      found = true;
      var copy = clone(s);
      copy.exercise = cleaned;
      return copy;
    });
    if (!found) return { ok: false, error: 'That station is not on the grid.' };
    return { ok: true, circuit: next };
  }
  function removeStation(doc, id) {
    var next = clone(doc || blank());
    next.stations = (next.stations || []).filter(function (s) { return s && s.id !== id; });
    next.order = (next.order || []).filter(function (item) { return item !== id; });
    return next;
  }
  function moveStation(doc, id, col, row) {
    col = integer(col, 0, COLS - 1);
    row = integer(row, 0, ROWS - 1);
    if (col == null || row == null) return { ok: false, error: 'Move that station onto the grid.' };
    var taken = (doc && doc.stations || []).some(function (s) {
      return s && s.id !== id && s.col === col && s.row === row;
    });
    if (taken) return { ok: false, error: 'That square is taken.' };
    var next = clone(doc || blank());
    var found = false;
    next.stations = (next.stations || []).map(function (s) {
      if (!s || s.id !== id) return s;
      found = true;
      var copy = clone(s);
      copy.col = col;
      copy.row = row;
      return copy;
    });
    if (!found) return { ok: false, error: 'That station is not on the grid.' };
    return { ok: true, circuit: next };
  }
  function tapStation(stations, order, id) {
    var known = (stations || []).some(function (s) { return s && s.id === id; });
    var next = (order || []).slice();
    if (!known || next.indexOf(id) >= 0) return next;
    next.push(id);
    return next;
  }
  function clearOrder() { return []; }
  function stationNumber(order, id) {
    var at = (order || []).indexOf(id);
    return at < 0 ? 0 : at + 1;
  }
  function loopComplete(stations, order) {
    var ids = [];
    (stations || []).forEach(function (s) { if (s && s.id) ids.push(String(s.id)); });
    if (!Array.isArray(order) || order.length !== ids.length) return false;
    var seen = {};
    for (var i = 0; i < order.length; i++) {
      var id = String(order[i]);
      if (seen[id] || ids.indexOf(id) < 0) return false;
      seen[id] = 1;
    }
    return true;
  }
  // The last edge closes the loop, from the last station back to the first.
  function loopEdges(order) {
    var edges = [];
    if (!Array.isArray(order) || order.length < 2) return edges;
    for (var i = 0; i < order.length - 1; i++) {
      edges.push({ from: order[i], to: order[i + 1], close: false });
    }
    edges.push({ from: order[order.length - 1], to: order[0], close: true });
    return edges;
  }
  function linkedClient(person) {
    var id = String(person && person.id || '');
    if (!UUID.test(id)) return null;
    return { source: 'linked', id: id, name: publicName(person.name || person.display_name) };
  }
  function toggleLinked(clients, person) {
    var row = linkedClient(person);
    var next = (clients || []).slice();
    if (!row) return next;
    var at = -1;
    for (var i = 0; i < next.length; i++) {
      if (next[i] && next[i].source === 'linked' && String(next[i].id) === row.id) at = i;
    }
    if (at >= 0) next.splice(at, 1);
    else next.push(row);
    return next;
  }
  function addManualClient(clients, name) {
    var shown = clean(name);
    if (!shown || shown.indexOf('@') !== -1) return { ok: false, error: 'Enter a name.' };
    if (shown.length > NAME_MAX) return { ok: false, error: 'That name is too long.' };
    var dup = (clients || []).some(function (c) {
      return c && c.source === 'manual' && String(c.name || '').toLowerCase() === shown.toLowerCase();
    });
    if (dup) return { ok: false, error: 'That client is already on this circuit.' };
    if ((clients || []).length >= CLIENT_MAX) return { ok: false, error: 'Too many clients.' };
    return { ok: true, clients: (clients || []).concat([{ source: 'manual', name: shown }]) };
  }
  function removeManualClient(clients, name) {
    var shown = clean(name).toLowerCase();
    return (clients || []).filter(function (c) {
      return !(c && c.source === 'manual' && String(c.name || '').toLowerCase() === shown);
    });
  }
  function summary(doc) {
    return {
      name: doc && doc.name ? String(doc.name) : '',
      stations: doc && Array.isArray(doc.stations) ? doc.stations.length : 0,
      clients: doc && Array.isArray(doc.clients) ? doc.clients.length : 0
    };
  }
  function fail(errors) {
    var unique = [];
    (errors || []).forEach(function (item) {
      if (item && unique.indexOf(item) < 0) unique.push(item);
    });
    if (!unique.length) unique.push('That circuit could not be saved.');
    return { ok: false, errors: unique };
  }
  function guard(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return fail(['That circuit could not be saved.']);
    if (bytesOf(doc) > DATA_MAX) return fail(['This circuit is too large.']);
    if (hasBanned(doc, 0)) return fail(['Take out reps and weight. Circuits track time only.']);
    var errors = [];
    var name = clean(doc.name);
    if (!name || name.indexOf('@') !== -1) errors.push('Name this circuit.');
    else if (name.length > NAME_MAX) errors.push('That name is too long.');
    if (doc.id != null && doc.id !== '' && !UUID.test(String(doc.id))) errors.push('That circuit could not be saved.');
    if (!Array.isArray(doc.stations)) errors.push('Add a station.');
    var stations = [];
    var seenIds = {};
    var positions = {};
    (Array.isArray(doc.stations) ? doc.stations : []).forEach(function (station) {
      if (!station || typeof station !== 'object') { errors.push('That circuit could not be saved.'); return; }
      if (!exactKeys(station, ['id', 'col', 'row', 'exercise'])) errors.push('That circuit could not be saved.');
      if (!exerciseKeysOk(station.exercise)) errors.push('Choose an exercise for every station.');
      var id = String(station.id || '');
      if (!STATION_ID.test(id) || seenIds[id]) errors.push('That circuit could not be saved.');
      var col = integer(station.col, 0, COLS - 1);
      var row = integer(station.row, 0, ROWS - 1);
      if (col == null || row == null) errors.push('Move that station onto the grid.');
      else if (positions[col + ',' + row]) errors.push('Two stations are on the same square.');
      else positions[col + ',' + row] = 1;
      var exercise = normalizeExercise(station.exercise);
      if (!exercise) errors.push('Choose an exercise for every station.');
      if (STATION_ID.test(id)) seenIds[id] = 1;
      if (exercise && col != null && row != null && STATION_ID.test(id) && !stations.some(function (s) { return s.id === id; })) {
        stations.push({ id: id, col: col, row: row, exercise: exercise });
      }
    });
    if (Array.isArray(doc.stations) && doc.stations.length < 1) errors.push('Add a station.');
    if (Array.isArray(doc.stations) && doc.stations.length > STATION_MAX) errors.push('The grid is full.');
    var order = [];
    var orderStations = stations.length === (Array.isArray(doc.stations) ? doc.stations.length : -1) ? stations : (doc.stations || []);
    if (!Array.isArray(doc.order) || !loopComplete(orderStations, doc.order)) {
      errors.push('Tap every station to close the loop.');
    } else {
      doc.order.forEach(function (id) { order.push(String(id)); });
    }
    if (!Array.isArray(doc.clients)) errors.push('That circuit could not be saved.');
    var clients = [];
    var linked = {};
    var manuals = {};
    (Array.isArray(doc.clients) ? doc.clients : []).forEach(function (client) {
      if (!client || typeof client !== 'object') { errors.push('That circuit could not be saved.'); return; }
      if (client.source === 'linked') {
        if (!exactKeys(client, ['source', 'id', 'name'])) errors.push('That circuit could not be saved.');
        var id = String(client.id || '');
        var shown = clean(client.name);
        if (!UUID.test(id) || !shown || shown.indexOf('@') !== -1 || shown.length > NAME_MAX) errors.push('Name every client.');
        else if (linked[id]) errors.push('That client is already on this circuit.');
        else {
          linked[id] = 1;
          clients.push({ source: 'linked', id: id, name: shown });
        }
      } else if (client.source === 'manual') {
        if (!exactKeys(client, ['source', 'name'])) errors.push('That circuit could not be saved.');
        var manual = clean(client.name);
        if (!manual || manual.indexOf('@') !== -1 || manual.length > NAME_MAX) errors.push('Name every client.');
        else if (manuals[manual.toLowerCase()]) errors.push('That client is already on this circuit.');
        else {
          manuals[manual.toLowerCase()] = 1;
          clients.push({ source: 'manual', name: manual });
        }
      } else errors.push('That circuit could not be saved.');
    });
    if (clients.length > CLIENT_MAX) errors.push('Too many clients.');
    var clockIn = doc.clock;
    var clock = null;
    if (!clockIn || typeof clockIn !== 'object' || Array.isArray(clockIn)) errors.push('Enter the work time.');
    else {
      if (!exactKeys(clockIn, ['workSec', 'moveSec', 'rounds'])) errors.push('That circuit could not be saved.');
      var workSec = integer(clockIn.workSec, 0, CLOCK_MAX);
      var moveSec = integer(clockIn.moveSec, 0, CLOCK_MAX);
      var rounds = integer(clockIn.rounds, 1, ROUNDS_MAX);
      if (workSec == null) errors.push('Enter the work time.');
      if (moveSec == null) errors.push('Enter the move time.');
      if (rounds == null) errors.push('Enter the rounds.');
      if (workSec != null && moveSec != null && rounds != null) clock = { workSec: workSec, moveSec: moveSec, rounds: rounds };
    }
    if (errors.length || !clock) return fail(errors);
    var value = { name: name, stations: stations, order: order, clients: clients, clock: clock };
    if (doc.id) value.id = String(doc.id);
    if (bytesOf({ stations: stations, order: order, clients: clients, clock: clock }) > DATA_MAX) {
      return fail(['This circuit is too large.']);
    }
    return { ok: true, errors: [], value: value };
  }
  function toPayload(doc) {
    var checked = guard(doc);
    if (!checked.ok) return checked;
    return {
      ok: true,
      id: checked.value.id || '',
      name: checked.value.name,
      data: {
        stations: checked.value.stations,
        order: checked.value.order,
        clients: checked.value.clients,
        clock: checked.value.clock
      }
    };
  }
  function fromRow(row) {
    if (!row || typeof row !== 'object') return fail(['That circuit could not be opened.']);
    var data = row.data || {};
    return guard({
      id: row.id,
      name: row.name,
      stations: data.stations,
      order: data.order,
      clients: data.clients,
      clock: data.clock
    });
  }

  var api = {
    COLS: COLS,
    ROWS: ROWS,
    STATION_MAX: STATION_MAX,
    NAME_MAX: NAME_MAX,
    CLIENT_MAX: CLIENT_MAX,
    CLOCK_MAX: CLOCK_MAX,
    ROUNDS_MAX: ROUNDS_MAX,
    DATA_MAX: DATA_MAX,
    WORK_DEFAULT: WORK_DEFAULT,
    MOVE_DEFAULT: MOVE_DEFAULT,
    clean: clean,
    publicName: publicName,
    initial: initial,
    blank: blank,
    splitClock: splitClock,
    joinClock: joinClock,
    syncRounds: syncRounds,
    nextCell: nextCell,
    addStation: addStation,
    normalizeExercise: normalizeExercise,
    setExercise: setExercise,
    removeStation: removeStation,
    moveStation: moveStation,
    tapStation: tapStation,
    clearOrder: clearOrder,
    stationNumber: stationNumber,
    loopComplete: loopComplete,
    loopEdges: loopEdges,
    linkedClient: linkedClient,
    toggleLinked: toggleLinked,
    addManualClient: addManualClient,
    removeManualClient: removeManualClient,
    summary: summary,
    guard: guard,
    toPayload: toPayload,
    fromRow: fromRow
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBCircuit = api;
})(typeof window !== 'undefined' ? window : globalThis);
