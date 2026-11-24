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
  function columnCount(cols) {
    var width = integer(cols, 1, COLS);
    return width == null ? COLS : width;
  }
  // Rows on screen: every row that has a station, plus one empty row, and never fewer than 2.
  function visibleRows(stations) {
    var used = 0;
    (stations || []).forEach(function (s) {
      if (s && typeof s.row === 'number' && s.row + 1 > used) used = s.row + 1;
    });
    var shown = Math.max(2, used + 1);
    return shown > ROWS ? ROWS : shown;
  }
  function nextCell(stations, cols) {
    var width = columnCount(cols);
    var used = {};
    (stations || []).forEach(function (s) {
      if (s && typeof s.col === 'number' && typeof s.row === 'number') used[s.col + ',' + s.row] = 1;
    });
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < width; c++) {
        if (!used[c + ',' + r]) return { col: c, row: r };
      }
    }
    return null;
  }
  function addStation(doc, cols) {
    var cell = nextCell(doc && doc.stations, cols);
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
  function cellAt(cells, col, row) {
    if (!cells) return null;
    if (col != null && row != null && cells[col + ',' + row]) return cells[col + ',' + row];
    var found = null;
    Object.keys(cells).forEach(function (key) {
      var cell = cells[key];
      if (!cell) return;
      if (row != null && cell.row !== row) return;
      if (col != null && cell.col !== col) return;
      found = cell;
    });
    return found;
  }
  function rowGapY(cells, row) {
    var upper = cellAt(cells, null, row);
    var lower = cellAt(cells, null, row + 1);
    if (upper && lower) return (upper.bottom + lower.top) / 2;
    if (upper) return upper.bottom + Math.max(4, (upper.bottom - upper.top) * 0.08);
    if (lower) return lower.top - Math.max(4, (lower.bottom - lower.top) * 0.08);
    return 0;
  }
  function colGapX(cells, col) {
    var left = cellAt(cells, col, null);
    var right = cellAt(cells, col + 1, null);
    if (left && right) return (left.right + right.left) / 2;
    if (left) return left.right + Math.max(4, (left.right - left.left) * 0.08);
    if (right) return right.left - Math.max(4, (right.right - right.left) * 0.08);
    return 0;
  }
  function clampNum(n, lo, hi) {
    if (hi < lo) return (lo + hi) / 2;
    return Math.max(lo, Math.min(hi, n));
  }
  function dedupePoints(points) {
    var out = [];
    (points || []).forEach(function (p) {
      var prev = out[out.length - 1];
      if (!prev || Math.abs(prev[0] - p[0]) > 0.4 || Math.abs(prev[1] - p[1]) > 0.4) out.push(p);
    });
    return out;
  }
  function pullTip(points) {
    var last = points.length - 1;
    if (last < 1) return points;
    var prev = points[last - 1];
    var tip = points[last];
    var dx = tip[0] - prev[0];
    var dy = tip[1] - prev[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var back = Math.min(7, len * 0.45);
    points[last] = [tip[0] - dx / len * back, tip[1] - dy / len * back];
    return points;
  }
  // Orthogonal route that stays in the gutters between cells.
  // a and b are the cells the stations occupy. The line leaves one's edge,
  // travels the gaps, and arrives at the other's edge.
  function arrowPoints(a, b, cells, close) {
    if (!a || !b) return [];
    var shift = close ? 5 : -5;
    if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
      var y = clampNum((a.cy + b.cy) / 2 + shift, Math.max(a.top, b.top) + 6, Math.min(a.bottom, b.bottom) - 6);
      if (a.col < b.col) return [[a.right, y], [b.left, y]];
      return [[a.left, y], [b.right, y]];
    }
    if (a.col === b.col && Math.abs(a.row - b.row) === 1) {
      var x = clampNum((a.cx + b.cx) / 2 + shift, Math.max(a.left, b.left) + 6, Math.min(a.right, b.right) - 6);
      if (a.row < b.row) return [[x, a.bottom], [x, b.top]];
      return [[x, a.top], [x, b.bottom]];
    }
    // The return trip on a shared column goes up the outside gutter, so it is
    // not hidden behind the stations sitting between the last square and the first.
    if (close && a.col === b.col) {
      var onLeft = !cellAt(cells, a.col - 1, a.row);
      var laneX = onLeft ? a.left - Math.max(6, (a.right - a.left) * 0.08) : (colGapX(cells, a.col) || a.right + 8);
      var yA = clampNum(a.cy + shift, a.top + 8, a.bottom - 8);
      var yB = clampNum(b.cy - shift, b.top + 8, b.bottom - 8);
      var edgeA = onLeft ? a.left : a.right;
      var edgeB = onLeft ? b.left : b.right;
      return pullTip(dedupePoints([
        [edgeA, yA],
        [laneX, yA],
        [laneX, yB],
        [edgeB, yB]
      ]));
    }
    // A 4-across wrap parks its arrowhead in the gap under the first station.
    // The closing arrow must not arrive through that same gap.
    if (close && b.row < a.row && cellAt(cells, b.col, b.row + 1)) {
      var outside = b.left - Math.max(10, (b.right - b.left) * 0.12);
      var drop = a.bottom + Math.max(8, (a.bottom - a.top) * 0.1);
      var mid = clampNum(b.cy, b.top + 8, b.bottom - 8);
      var leave = clampNum(a.cx, a.left + 8, a.right - 8);
      return pullTip(dedupePoints([
        [leave, a.bottom],
        [leave, drop],
        [outside, drop],
        [outside, mid],
        [b.left, mid]
      ]));
    }
    var up = b.row < a.row;
    var exitY = up ? a.top : a.bottom;
    var enterY = a.row < b.row ? b.top : b.bottom;
    var gyA = up ? rowGapY(cells, a.row - 1) : rowGapY(cells, a.row);
    var gyB = a.row < b.row ? rowGapY(cells, b.row - 1) : (a.row > b.row ? rowGapY(cells, b.row) : gyA);
    var lane = close ? 3 : -3;
    gyA += lane;
    gyB += lane;
    var exitX = clampNum(a.cx + shift, a.left + 8, a.right - 8);
    var enterX = clampNum(b.cx - shift, b.left + 8, b.right - 8);
    var vx = a.col === b.col ? colGapX(cells, a.col) : colGapX(cells, Math.min(a.col, b.col));
    if (!vx) vx = a.left - 8;
    return pullTip(dedupePoints([
      [exitX, exitY],
      [exitX, gyA],
      [vx, gyA],
      [vx, gyB],
      [enterX, gyB],
      [enterX, enterY]
    ]));
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

  // ---------- live session: placement, rotation, time ----------
  var AVATAR_COLORS = ['#2563eb', '#7c3aed', '#d97706', '#0d9488', '#db2777', '#4f46e5', '#64748b', '#059669'];
  var STAND_MS = 5000;

  function personKey(client) {
    if (!client) return '';
    if (client.source === 'linked') return 'l:' + String(client.id || '');
    return 'm:' + clean(client.name).toLowerCase();
  }
  function initials(value) {
    var text = publicName(value);
    var parts = text.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    return (parts[0] || text || 'C').charAt(0).toUpperCase();
  }
  function firstName(value) {
    var text = publicName(value);
    var parts = text.split(/\s+/).filter(Boolean);
    return parts[0] || text;
  }
  function avatarColor(value) {
    var text = publicName(value);
    var n = 0;
    for (var i = 0; i < text.length; i++) n = (n * 33 + text.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[n % AVATAR_COLORS.length];
  }
  // Round r (1-based) stands on loop[(start + r - 1) mod N].
  function stationAt(order, startIndex, round) {
    var n = (order || []).length;
    if (!n) return -1;
    var start = Math.floor(Number(startIndex) || 0);
    var r = Math.floor(Number(round) || 1);
    if (r < 1) r = 1;
    return ((start + r - 1) % n + n) % n;
  }
  function assignmentReady(clients, assigned) {
    var list = clients || [];
    if (!list.length) return false;
    for (var i = 0; i < list.length; i++) {
      var spot = assigned && assigned[personKey(list[i])];
      if (!spot) return false;
      if (spot.bench) continue;
      if (!spot.stationId) return false;
    }
    return true;
  }
  function phaseInfo(elapsedMs, clock) {
    var t = Math.max(0, Number(elapsedMs) || 0);
    var stand = STAND_MS;
    var work = Math.max(0, Number(clock && clock.workSec) || 0) * 1000;
    var move = Math.max(0, Number(clock && clock.moveSec) || 0) * 1000;
    var n = Math.max(0, Math.floor(Number(clock && clock.rounds) || 0));
    function pack(name, round, start, end) {
      return { name: name, round: round, phaseStart: start, phaseEnd: end, dur: Math.max(0, end - start) };
    }
    if (n < 1) return pack('done', 0, t, t);
    if (t < stand) return pack('standoff', 1, 0, stand);
    var u = t - stand;
    var total = move > 0 ? (n - 1) * (work + move) + work : n * work;
    if (u >= total) return pack('done', n, stand + total, stand + total);
    if (!(move > 0)) {
      var step = work > 0 ? work : total;
      var r0 = step > 0 ? Math.floor(u / step) + 1 : 1;
      var start0 = stand + (r0 - 1) * step;
      return pack('work', r0, start0, start0 + step);
    }
    var pre = (n - 1) * (work + move);
    if (u >= pre) return pack('work', n, stand + pre, stand + pre + work);
    var cycle = work + move;
    var r = Math.floor(u / cycle) + 1;
    var into = u - (r - 1) * cycle;
    var base = stand + (r - 1) * cycle;
    if (into < work) return pack('work', r, base, base + work);
    return pack('move', r, base + work, base + cycle);
  }
  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }
  function personBy(state, key) {
    var people = state.people || [];
    for (var i = 0; i < people.length; i++) if (people[i].key === key) return people[i];
    return null;
  }
  function stationIdFor(state, person, round) {
    var idx = stationAt(state.order, person.startIndex, round);
    return idx < 0 ? '' : state.order[idx];
  }
  function closeSlice(person, atMs) {
    if (!person || !person.slice) return;
    var add = Math.max(0, atMs - person.slice.from);
    var id = person.slice.stationId;
    if (id && add > 0) person.ms[id] = (person.ms[id] || 0) + add;
    person.slice = null;
  }
  function openSlice(person, stationId, atMs) {
    if (!person || person.benched || person.slice || !stationId) return;
    person.slice = { stationId: stationId, from: atMs };
  }
  function ensureWork(state, info, atMs) {
    (state.people || []).forEach(function (p) {
      if (p.benched || p.slice) return;
      openSlice(p, stationIdFor(state, p, info.round), Math.max(atMs, info.phaseStart));
    });
  }
  function advanceSession(state, elapsedMs) {
    var next = cloneState(state);
    var target = Math.max(next.elapsedMs || 0, Number(elapsedMs) || 0);
    var guard = 0;
    while (guard++ < 1000 && !next.done && next.elapsedMs < target) {
      var info = phaseInfo(next.elapsedMs, next.clock);
      if (info.name === 'done') break;
      if (info.dur <= 0) {
        next.elapsedMs = Math.max(info.phaseEnd, next.elapsedMs + 1);
        continue;
      }
      if (target < info.phaseEnd) {
        if (info.name === 'work') ensureWork(next, info, next.elapsedMs);
        next.elapsedMs = target;
        break;
      }
      if (info.name === 'work') {
        ensureWork(next, info, next.elapsedMs);
        next.people.forEach(function (p) { closeSlice(p, info.phaseEnd); });
      }
      next.elapsedMs = info.phaseEnd;
    }
    var nowInfo = phaseInfo(next.elapsedMs, next.clock);
    next.phase = nowInfo.name;
    next.round = nowInfo.round || next.round;
    if (nowInfo.name === 'done') {
      next.people.forEach(function (p) { closeSlice(p, next.elapsedMs); });
      next.done = true;
      next.running = false;
    } else if (nowInfo.name === 'work') ensureWork(next, nowInfo, next.elapsedMs);
    else next.people.forEach(function (p) { closeSlice(p, next.elapsedMs); });
    return next;
  }
  function beginRun(doc, assigned) {
    var order = (doc.order || []).slice();
    var people = (doc.clients || []).map(function (c) {
      var key = personKey(c);
      var spot = (assigned && assigned[key]) || {};
      var startIndex = 0;
      if (spot.stationId) {
        var at = order.indexOf(spot.stationId);
        if (at >= 0) startIndex = at;
      }
      return {
        key: key,
        source: c.source,
        id: c.source === 'linked' ? c.id : null,
        name: publicName(c.name),
        startIndex: startIndex,
        benched: !!spot.bench,
        ms: {},
        slice: null
      };
    });
    return {
      phase: 'standoff',
      round: 1,
      elapsedMs: 0,
      running: true,
      done: false,
      people: people,
      clock: {
        workSec: doc.clock.workSec,
        moveSec: doc.clock.moveSec,
        rounds: doc.clock.rounds
      },
      order: order
    };
  }
  function benchPerson(state, key, elapsedMs) {
    var next = advanceSession(state, elapsedMs);
    var person = personBy(next, key);
    if (!person || person.benched) return next;
    closeSlice(person, next.elapsedMs);
    person.benched = true;
    return next;
  }
  function rejoinPerson(state, key, elapsedMs) {
    var next = advanceSession(state, elapsedMs);
    var person = personBy(next, key);
    if (!person || !person.benched) return next;
    person.benched = false;
    var info = phaseInfo(next.elapsedMs, next.clock);
    if (info.name === 'work') openSlice(person, stationIdFor(next, person, info.round), next.elapsedMs);
    return next;
  }
  function jumpSession(state, elapsedMs) {
    var next = cloneState(state);
    next.people.forEach(function (p) { closeSlice(p, next.elapsedMs); });
    next.elapsedMs = Math.max(next.elapsedMs, Number(elapsedMs) || 0);
    var info = phaseInfo(next.elapsedMs, next.clock);
    next.phase = info.name;
    next.round = info.round || next.round;
    if (info.name === 'done') {
      next.done = true;
      next.running = false;
    } else if (info.name === 'work') ensureWork(next, info, next.elapsedMs);
    return next;
  }
  function skipPhase(state, elapsedMs) {
    var at = advanceSession(state, elapsedMs);
    var info = phaseInfo(at.elapsedMs, at.clock);
    if (info.name === 'done' || info.dur <= 0) return at;
    return jumpSession(at, info.phaseEnd);
  }
  function finishSession(state, elapsedMs) {
    var next = advanceSession(state, elapsedMs);
    next.people.forEach(function (p) { closeSlice(p, next.elapsedMs); });
    next.done = true;
    next.phase = 'done';
    next.running = false;
    return next;
  }
  function spotStation(state, person) {
    var round = state && state.phase === 'standoff' ? 1 : (state.round || 1);
    return stationIdFor(state, person, round);
  }
  function sessionSummary(state, stations) {
    var names = {};
    (stations || []).forEach(function (s) {
      if (s && s.id) names[s.id] = (s.exercise && s.exercise.name) || 'Station';
    });
    var orderIndex = {};
    (state.order || []).forEach(function (id, i) { orderIndex[id] = i; });
    return {
      people: (state.people || []).map(function (p) {
        var rows = [];
        var totalMs = 0;
        Object.keys(p.ms || {}).forEach(function (id) {
          var ms = p.ms[id] || 0;
          if (p.slice && p.slice.stationId === id) ms += 0;
          totalMs += ms;
          var seconds = Math.round(ms / 1000);
          if (seconds <= 0) return;
          rows.push({ stationId: id, name: names[id] || 'Station', seconds: seconds });
        });
        rows.sort(function (a, b) { return (orderIndex[a.stationId] || 0) - (orderIndex[b.stationId] || 0); });
        var total = 0;
        rows.forEach(function (row) { total += row.seconds; });
        return { key: p.key, source: p.source, id: p.id || null, name: p.name, stations: rows, total: total };
      })
    };
  }
  function sessionRecord(doc, state, startedAt, endedAt) {
    var summary = sessionSummary(state, doc && doc.stations);
    return {
      circuitId: doc && doc.id ? String(doc.id) : '',
      name: doc && doc.name ? String(doc.name) : '',
      startedAt: startedAt == null ? null : startedAt,
      endedAt: endedAt == null ? null : endedAt,
      clock: {
        workSec: state.clock.workSec,
        moveSec: state.clock.moveSec,
        rounds: state.clock.rounds
      },
      people: summary.people
    };
  }
  // timerSchedule(work, move, rounds, true) includes a trailing move. A circuit has no move after the last round.
  function withoutFinalMove(schedule, workSec, moveSec, rounds) {
    var work = Number(workSec) || 0;
    var move = Number(moveSec) || 0;
    var n = Math.floor(Number(rounds) || 0);
    var copy = (schedule || []).map(function (ev) { return { t: ev.t, kind: ev.kind }; });
    if (!(move > 0) || n < 1) return copy;
    var end = 5 + (n - 1) * (work + move) + work;
    var out = [];
    copy.forEach(function (ev) {
      if (ev.t > end + 0.001) return;
      if (Math.abs(ev.t - end) < 0.001 && ev.kind === 'go') out.push({ t: ev.t, kind: 'done' });
      else out.push(ev);
    });
    return out;
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
    visibleRows: visibleRows,
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
    arrowPoints: arrowPoints,
    linkedClient: linkedClient,
    toggleLinked: toggleLinked,
    addManualClient: addManualClient,
    removeManualClient: removeManualClient,
    summary: summary,
    guard: guard,
    toPayload: toPayload,
    fromRow: fromRow,
    personKey: personKey,
    initials: initials,
    firstName: firstName,
    avatarColor: avatarColor,
    stationAt: stationAt,
    assignmentReady: assignmentReady,
    phaseInfo: phaseInfo,
    beginRun: beginRun,
    advanceSession: advanceSession,
    benchPerson: benchPerson,
    rejoinPerson: rejoinPerson,
    skipPhase: skipPhase,
    finishSession: finishSession,
    spotStation: spotStation,
    sessionSummary: sessionSummary,
    sessionRecord: sessionRecord,
    withoutFinalMove: withoutFinalMove
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBCircuit = api;
})(typeof window !== 'undefined' ? window : globalThis);
