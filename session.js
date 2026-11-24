/* Live group circuit. Placement, one shared clock, rotation, bench, and a time summary.
   Nothing is written to the database. Browser: window.WBCircuitSession. */
(function (root) {
  'use strict';

  var KEY = 'wb.circuit.live';
  var ctx = null;
  var doc = null;
  var mode = 'place';
  var view = 'grid';
  var assigned = {};
  var state = null;
  var selected = '';
  var running = false;
  var anchorWall = 0;
  var anchorElapsed = 0;
  var startedAt = null;
  var record = null;
  var tracking = true;
  var sched = null;
  var toneMark = -1;
  var nodes = [];
  var noBeep = false;
  var raf = 0;
  var loadToken = 0;
  var arrowObserver = null;
  var arrowFrame = 0;
  var lastPersist = 0;
  var suppressClick = false;
  var drag = null;

  function model() { return root.WBCircuit; }
  function clockApi() { return root.WBClock; }
  function wall() { return Date.now() + (root.__wbClockOffset || 0); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hashParts() {
    var body = '';
    try { body = String(location.hash || '').replace(/^#\/?/, '').split('?')[0]; }
    catch (e) { body = ''; }
    return body.split('/');
  }
  function markPage() { try { document.body.classList.add('circuit-on'); } catch (e) {} }
  function clearPage() { try { document.body.classList.remove('circuit-on'); } catch (e2) {} }
  function fmtLeft(ms) {
    var sec = Math.ceil(Math.max(0, ms) / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtSec(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function editorCols() {
    return 3;
  }
  function usedRows(stations) {
    var rows = 1;
    (stations || []).forEach(function (s) {
      if (s && typeof s.row === 'number' && s.row + 1 > rows) rows = s.row + 1;
    });
    return rows;
  }
  function liveElapsed() {
    if (!state) return 0;
    if (!running) return state.elapsedMs;
    return anchorElapsed + Math.max(0, wall() - anchorWall);
  }
  function syncAnchor() {
    anchorElapsed = state ? state.elapsedMs : 0;
    anchorWall = wall();
  }
  function stopTones() {
    (nodes || []).forEach(function (o) { try { o.stop(); } catch (e) {} });
    nodes = [];
  }
  function stopArrows() {
    if (arrowObserver) { arrowObserver.disconnect(); arrowObserver = null; }
    if (arrowFrame) { cancelAnimationFrame(arrowFrame); arrowFrame = 0; }
  }
  function findLive(key) {
    var people = state && state.people || [];
    for (var i = 0; i < people.length; i++) if (people[i].key === key) return people[i];
    return null;
  }
  function views() {
    var C = model();
    if (mode === 'place') {
      return (doc.clients || []).map(function (c) {
        var key = C.personKey(c);
        var spot = assigned[key] || {};
        return {
          key: key,
          name: C.publicName(c.name),
          manual: c.source === 'manual',
          benched: !!spot.bench,
          stationId: spot.bench ? '' : (spot.stationId || ''),
          spotId: spot.bench ? (spot.stationId || '') : ''
        };
      });
    }
    if (!state) return [];
    return (state.people || []).map(function (p) {
      var sid = C.spotStation(state, p);
      return {
        key: p.key,
        name: p.name,
        manual: p.source === 'manual',
        benched: !!p.benched,
        stationId: p.benched ? '' : sid,
        spotId: p.benched ? sid : ''
      };
    });
  }
  function personButton(person, picked, compact) {
    var C = model();
    var color = person.manual ? '' : C.avatarColor(person.name);
    return '<button type="button" class="c-person' + (person.manual ? ' is-manual' : '') + (picked ? ' is-picked' : '') + (compact ? ' is-compact' : '') + '" data-person="' + esc(person.key) + '" data-label="' + esc(C.firstName(person.name)) + '" aria-label="' + esc(person.name) + '">' +
      '<span class="c-ava' + (person.manual ? ' is-manual' : '') + '"' + (color ? ' style="background:' + color + '"' : '') + ' aria-hidden="true">' + esc(C.initials(person.name)) + '</span>' +
      (compact ? '' : '<span class="c-name">' + esc(C.firstName(person.name)) + '</span>') + '</button>';
  }
  function spotHtml(person) {
    return '<div class="c-spot" data-person="' + esc(person.key) + '" data-label="' + esc(model().firstName(person.name)) + '">' +
      '<span class="c-spot-ring" aria-hidden="true"></span><span class="c-name">spot</span></div>';
  }
  function facesAt(stationId) {
    var html = '';
    views().forEach(function (person) {
      if (person.stationId === stationId) html += personButton(person, selected === person.key);
      if (person.spotId === stationId) html += spotHtml(person);
    });
    return html ? '<div class="c-faces">' + html + '</div>' : '<div class="c-faces"></div>';
  }
  function iconPause() {
    return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><rect x="3" y="2" width="4.2" height="14" rx="1.2" fill="currentColor"></rect><rect x="10.8" y="2" width="4.2" height="14" rx="1.2" fill="currentColor"></rect></svg>';
  }
  function iconPlay() {
    return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 3.2v11.6c0 .8.9 1.3 1.6.8l8.2-5.8a1 1 0 0 0 0-1.6L6.6 2.4c-.7-.5-1.6 0-1.6.8z"></path></svg>';
  }
  function iconSkip() {
    return '<svg viewBox="0 0 20 18" width="20" height="18" aria-hidden="true"><path fill="currentColor" d="M1.2 2.2v13.6c0 .9 1 1.4 1.7.9l9.2-6.8a1.1 1.1 0 0 0 0-1.8L2.9 1.3C2.2.8 1.2 1.3 1.2 2.2z"></path><rect x="14.6" y="2" width="3.4" height="14" rx="1.1" fill="currentColor"></rect></svg>';
  }
  function toolbarHtml() {
    return '<div class="circuit-toolbar"><div class="circuit-seg" role="tablist" aria-label="View">' +
      '<button type="button" data-act="view" data-view="grid" class="' + (view === 'grid' ? 'on' : '') + '" aria-pressed="' + (view === 'grid' ? 'true' : 'false') + '">Grid</button>' +
      '<button type="button" data-act="view" data-view="list" class="' + (view === 'list' ? 'on' : '') + '" aria-pressed="' + (view === 'list' ? 'true' : 'false') + '">List</button>' +
      '</div></div>';
  }
  function clockHtml() {
    var info = model().phaseInfo(state.elapsedMs, state.clock);
    var left = Math.max(0, info.phaseEnd - state.elapsedMs);
    var workOn = info.name !== 'move';
    var moveOn = info.name === 'move';
    var upcoming = info.name === 'standoff' ? 1 : info.round;
    var thenMove = doc.clock.moveSec > 0 && info.name !== 'move' && upcoming < doc.clock.rounds;
    var thenWork = info.name === 'move';
    var pct = info.dur ? Math.max(0, Math.min(1, (state.elapsedMs - info.phaseStart) / info.dur)) : 0;
    return '<div class="circuit-clock-card" id="circuit-clock-card">' +
      '<div class="circuit-clock-top"><div class="circuit-time wb-digits' + (moveOn ? ' is-move' : '') + '" id="c-time">' + fmtLeft(left) + '</div>' +
      '<div class="circuit-clock-btns">' +
      '<button type="button" class="circuit-icon" data-act="pause" aria-label="' + (running ? 'Pause' : 'Resume') + '">' + (running ? iconPause() : iconPlay()) + '</button>' +
      '<button type="button" class="circuit-icon" data-act="skip" aria-label="Skip">' + iconSkip() + '</button>' +
      '</div></div>' +
      '<div class="circuit-meta">' +
      '<span class="circuit-pill' + (workOn ? ' work' : ' work is-next') + '"' + (workOn ? '' : ' hidden') + '>Work</span>' +
      (thenMove ? '<span class="circuit-then">then</span><span class="circuit-pill move">Move</span>' : '') +
      (moveOn ? '<span class="circuit-pill move">Move</span>' : '') +
      (thenWork ? '<span class="circuit-then">then</span><span class="circuit-pill work is-next">Work</span>' : '') +
      '<span class="circuit-round" id="c-round">Round ' + info.round + ' of ' + doc.clock.rounds + '</span></div>' +
      '<div class="circuit-bar' + (moveOn ? ' is-move' : '') + '"><i id="c-bar" style="width:' + (pct * 100).toFixed(1) + '%"></i></div></div>';
  }
  function stationName(station) {
    return station.exercise && station.exercise.name ? station.exercise.name : 'Station';
  }
  function gridHtml() {
    var shown = model().fitLayout ? model().fitLayout(doc.stations, 3) : (doc.stations || []);
    var cols = editorCols();
    var rows = usedRows(shown);
    var byPos = {};
    shown.forEach(function (s) { if (s) byPos[s.col + ',' + s.row] = s; });
    var h = '<div class="circuit-board" id="circuit-board"><svg class="circuit-arrows" aria-hidden="true"></svg>' +
      '<div class="wb-grid" role="grid" aria-label="Circuit stations" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">';
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var station = byPos[c + ',' + r];
        h += '<div class="wb-cell" role="gridcell" data-col="' + c + '" data-row="' + r + '"' + (station ? ' data-station="' + esc(station.id) + '"' : '') + '>';
        if (station) {
          var n = model().stationNumber(doc.order, station.id);
          h += '<div class="wb-tile" data-station="' + esc(station.id) + '">' +
            '<span class="circuit-num">' + (n || '·') + '</span>' +
            '<div class="circuit-ex"><span class="circuit-name">' + esc(stationName(station)) + '</span></div>' +
            facesAt(station.id) + '</div>';
        }
        h += '</div>';
      }
    }
    return h + '</div></div>';
  }
  function listHtml() {
    var h = '<div class="circuit-loop" id="circuit-loop">';
    (doc.order || []).forEach(function (id) {
      var station = (doc.stations || []).filter(function (s) { return s && s.id === id; })[0];
      if (!station) return;
      var n = model().stationNumber(doc.order, station.id);
      h += '<div class="circuit-loop-row" data-station="' + esc(station.id) + '">' +
        '<span class="circuit-num">' + n + '</span>' +
        '<div class="circuit-loop-main"><div class="circuit-name">' + esc(stationName(station)) + '</div>' +
        facesAt(station.id) + '</div></div>';
    });
    return h + '</div>';
  }
  function unplacedHtml() {
    var pending = views().filter(function (person) { return !person.stationId && !person.benched; });
    if (!pending.length || mode !== 'place') return '';
    var h = '<div class="circuit-unplaced"><div class="circuit-section"><h2>Clients</h2></div><div class="c-faces">';
    pending.forEach(function (person) { h += personButton(person, selected === person.key); });
    return h + '</div></div>';
  }
  function benchHtml() {
    var people = views().filter(function (person) { return person.benched; });
    var h = '<div class="circuit-bench" data-bench="1"><div class="circuit-bench-label">Benched</div>';
    if (!people.length) h += '<div class="circuit-bench-hint">Drag a client here</div>';
    people.forEach(function (person) {
      h += '<div class="circuit-bench-person">' + personButton(person, selected === person.key, true) +
        '<span class="circuit-bench-name">' + esc(model().firstName(person.name)) + '</span></div>';
    });
    if (people.length) h += '<div class="circuit-bench-hint">Drag back in to rejoin</div>';
    return h + '</div>';
  }
  function summaryHtml() {
    var people = record && record.people || [];
    var h = '<div class="circuit-summary" id="circuit-summary">';
    if (!tracking) h += '<p class="tag" id="pv-not-tracked">Preview - not tracked</p>';
    h += '<p class="circuit-sum-title">' + esc(doc.name || 'Circuit') + '</p>';
    if (!people.length) h += '<p class="mute">No clients were in this session.</p>';
    people.forEach(function (person) {
      h += '<div class="card circuit-sum"><div class="circuit-sum-who">' +
        '<span class="c-ava' + (person.source === 'manual' ? ' is-manual' : '') + '"' +
        (person.source === 'manual' ? '' : ' style="background:' + model().avatarColor(person.name) + '"') + '>' +
        esc(model().initials(person.name)) + '</span><span>' + esc(person.name) + '</span></div>';
      (person.stations || []).forEach(function (row) {
        h += '<div class="circuit-sum-row"><span>' + esc(row.name) + '</span><b>' + fmtSec(row.seconds) + '</b></div>';
      });
      h += '<div class="circuit-sum-row is-total"><span>Total</span><b>' + fmtSec(person.total) + '</b></div></div>';
    });
    h += '<button type="button" class="pri circuit-start" data-act="done">Done</button></div>';
    return h;
  }
  function ready() {
    return !!(doc && model().assignmentReady(doc.clients, assigned));
  }
  function paintClock() {
    if (!state || !doc) return;
    var info = model().phaseInfo(state.elapsedMs, state.clock);
    var time = document.getElementById('c-time');
    var bar = document.getElementById('c-bar');
    var round = document.getElementById('c-round');
    if (time) time.textContent = fmtLeft(Math.max(0, info.phaseEnd - state.elapsedMs));
    if (round) round.textContent = 'Round ' + info.round + ' of ' + doc.clock.rounds;
    if (bar && info.dur) bar.style.width = Math.max(0, Math.min(100, (state.elapsedMs - info.phaseStart) / info.dur * 100)) + '%';
  }
  function paint() {
    if (!ctx || !doc) return;
    markPage();
    ctx.backBtn.hidden = false;
    ctx.titleEl.textContent = 'Group Circuit Training';
    if (mode === 'summary') {
      ctx.app.innerHTML = summaryHtml();
      ctx.app.onclick = onClick;
      ctx.app.onpointerdown = null;
      stopArrows();
      return;
    }
    var h = '<div class="circuit-live" id="circuit-live"' + (tracking ? '' : ' data-track="0"') + '>';
    if (mode === 'place') h += '<div class="circuit-hint">Place every client on a starting station.</div>';
    h += toolbarHtml();
    if (mode === 'live') h += clockHtml();
    h += view === 'list' ? listHtml() : gridHtml();
    h += unplacedHtml();
    h += benchHtml();
    if (mode === 'place') {
      h += '<button type="button" class="pri circuit-start" data-act="start"' + ((tracking && ready()) ? '' : ' disabled') + '>Start</button>';
    } else {
      h += '<div class="circuit-end-slot"><button type="button" class="circuit-end" data-act="end">End session</button></div>';
    }
    h += '</div>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = onClick;
    ctx.app.onpointerdown = onPointerDown;
    if (view === 'grid') watchArrows();
    else stopArrows();
  }
  function boardPoint(el, board) {
    var rect = el.getBoundingClientRect();
    var box = board.getBoundingClientRect();
    return {
      left: rect.left - box.left,
      top: rect.top - box.top,
      right: rect.right - box.left,
      bottom: rect.bottom - box.top,
      cx: rect.left - box.left + rect.width / 2,
      cy: rect.top - box.top + rect.height / 2,
      col: Number(el.getAttribute('data-col')),
      row: Number(el.getAttribute('data-row'))
    };
  }
  function retractEnds(points, px) {
    if (!points || points.length < 2) return points;
    function pull(from, to) {
      var dx = to[0] - from[0];
      var dy = to[1] - from[1];
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var back = Math.min(px, len * 0.35);
      return [to[0] - dx / len * back, to[1] - dy / len * back];
    }
    var copy = points.map(function (p) { return [p[0], p[1]]; });
    copy[0] = pull(copy[1], copy[0]);
    copy[copy.length - 1] = pull(copy[copy.length - 2], copy[copy.length - 1]);
    return copy;
  }
  function paintArrows() {
    var board = document.getElementById('circuit-board');
    var C = model();
    if (!board || !doc || !C) return;
    var svg = board.querySelector('.circuit-arrows');
    if (!svg) return;
    var box = board.getBoundingClientRect();
    if (!box.width || !box.height) return;
    svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
    var cells = {};
    var tiles = {};
    Array.prototype.forEach.call(board.querySelectorAll('.wb-cell'), function (cell) {
      var spot = boardPoint(cell, board);
      cells[spot.col + ',' + spot.row] = spot;
      var tile = cell.querySelector('.wb-tile');
      if (!tile) return;
      var box = boardPoint(tile, board);
      box.col = spot.col;
      box.row = spot.row;
      tiles[tile.getAttribute('data-station')] = box;
    });
    var html = '<defs><marker id="session-arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#1e293b"></path></marker></defs>';
    C.loopEdges(doc.order).forEach(function (edge) {
      var a = tiles[edge.from];
      var b = tiles[edge.to];
      if (!a || !b) return;
      var points = retractEnds(C.arrowPoints(a, b, cells, edge.close), 6);
      if (!points || points.length < 2) return;
      html += '<polyline points="' + points.map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ') + '" fill="none" stroke="#1e293b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" marker-end="url(#session-arrowhead)"></polyline>';
    });
    svg.innerHTML = html;
  }
  function watchArrows() {
    stopArrows();
    arrowFrame = requestAnimationFrame(function () {
      arrowFrame = 0;
      paintArrows();
    });
    var board = document.getElementById('circuit-board');
    if (board && root.ResizeObserver) {
      arrowObserver = new root.ResizeObserver(function () { paintArrows(); });
      arrowObserver.observe(board);
    }
  }
  function playDue(toMs) {
    if (!sched) { toneMark = toMs; return; }
    if (noBeep) { toneMark = toMs; return; }
    var prev = toneMark == null ? -1 : toneMark;
    var due = [];
    sched.forEach(function (ev) {
      var ms = ev.t * 1000;
      if (ms > prev && ms <= toMs + 0.5) due.push(ev);
    });
    toneMark = toMs;
    if (!due.length || !clockApi()) return;
    clockApi().fireTone(due[due.length - 1].kind, { nodes: nodes, phase: state && state.phase, vis: null, at: Math.round(toMs) });
  }
  function showSummary() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    stopTones();
    if (clockApi()) clockApi().unlockScreen();
    record = model().sessionRecord(doc, state, startedAt, Date.now());
    mode = 'summary';
    clearStore();
    paint();
  }
  function catchUp(sound) {
    if (mode !== 'live' || !state || !running) return;
    var target = liveElapsed();
    var prevPhase = state.phase;
    var prevRound = state.round;
    if (target > state.elapsedMs) state = model().advanceSession(state, target);
    syncAnchor();
    if (sound) playDue(state.elapsedMs);
    else toneMark = state.elapsedMs;
    if (state.done) return showSummary();
    if (state.phase !== prevPhase || state.round !== prevRound) paint();
    else paintClock();
    var now = wall();
    if (now - lastPersist >= 1000) { lastPersist = now; persist(); }
  }
  function frame() {
    raf = 0;
    if (!ctx || mode !== 'live' || !running) return;
    catchUp(true);
    if (ctx && mode === 'live' && running) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (mode === 'live' && running) raf = requestAnimationFrame(frame);
  }
  function persist() {
    if (!tracking || !doc || mode === 'summary') return;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        circuitId: doc.id || '',
        doc: {
          id: doc.id || '',
          name: doc.name,
          stations: doc.stations,
          order: doc.order,
          clients: doc.clients,
          clock: doc.clock
        },
        mode: mode,
        view: view,
        assigned: assigned,
        state: state,
        running: running,
        wallAt: wall(),
        startedAt: startedAt
      }));
      lastPersist = wall();
    } catch (e) {}
  }
  function readStore() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearStore() {
    if (!tracking) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  function fromCalendar() {
    var q = '';
    try { q = String(location.hash || '').split('?')[1] || ''; } catch (e) {}
    return /(^|&)from=calendar(&|$)/.test(q);
  }
  function armSchedule() {
    var C = model();
    var api = clockApi();
    if (!api || !doc) { sched = []; return; }
    sched = C.withoutFinalMove(
      api.timerSchedule(doc.clock.workSec, doc.clock.moveSec, doc.clock.rounds, true),
      doc.clock.workSec,
      doc.clock.moveSec,
      doc.clock.rounds
    );
  }
  function onStart() {
    if (!ready() || !clockApi()) return;
    state = model().beginRun(doc, assigned);
    startedAt = Date.now();
    running = true;
    mode = 'live';
    syncAnchor();
    armSchedule();
    toneMark = -1;
    nodes = [];
    clockApi().ensureAudio();
    clockApi().lockScreen();
    persist();
    paint();
    kick();
  }
  function onPause() {
    if (mode !== 'live' || !state) return;
    if (clockApi()) clockApi().ensureAudio();
    if (running) {
      state = model().advanceSession(state, liveElapsed());
      running = false;
      syncAnchor();
      stopTones();
      toneMark = state.elapsedMs;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    } else if (!state.done) {
      running = true;
      syncAnchor();
      toneMark = state.elapsedMs;
      if (clockApi()) clockApi().lockScreen();
      kick();
    }
    persist();
    paint();
  }
  function onSkip() {
    if (mode !== 'live' || !state || state.done) return;
    if (clockApi()) clockApi().ensureAudio();
    noBeep = true;
    var was = running;
    var nowMs = was ? liveElapsed() : state.elapsedMs;
    state = model().skipPhase(state, nowMs);
    noBeep = false;
    toneMark = state.elapsedMs;
    stopTones();
    if (state.done) return showSummary();
    running = was;
    syncAnchor();
    persist();
    paint();
    kick();
  }
  function onEnd() {
    if (mode !== 'live' || !state) return;
    if (!confirm('End session?')) return;
    var nowMs = running ? liveElapsed() : state.elapsedMs;
    state = model().finishSession(state, nowMs);
    showSummary();
  }
  function placeKey(key, stationId) {
    if (mode !== 'place' || !stationId) return;
    assigned[key] = { stationId: stationId };
    selected = '';
    persist();
    paint();
  }
  function benchKey(key) {
    if (mode === 'place') {
      var prev = assigned[key] || {};
      assigned[key] = { bench: true };
      if (prev.stationId) assigned[key].stationId = prev.stationId;
      selected = '';
      persist();
      paint();
      return;
    }
    if (mode !== 'live') return;
    var nowMs = running ? liveElapsed() : state.elapsedMs;
    state = model().benchPerson(state, key, nowMs);
    syncAnchor();
    toneMark = state.elapsedMs;
    selected = '';
    persist();
    paint();
  }
  function rejoinKey(key) {
    if (mode !== 'live') return;
    var nowMs = running ? liveElapsed() : state.elapsedMs;
    state = model().rejoinPerson(state, key, nowMs);
    syncAnchor();
    toneMark = state.elapsedMs;
    selected = '';
    persist();
    paint();
  }
  function swallowClick() {
    function eat(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      document.removeEventListener('click', eat, true);
    }
    document.addEventListener('click', eat, true);
    setTimeout(function () { document.removeEventListener('click', eat, true); }, 700);
  }
  function nearBench(x, y) {
    var bench = document.querySelector('.circuit-live [data-bench]');
    if (!bench) return false;
    var rect = bench.getBoundingClientRect();
    return x >= rect.left - 12 && x <= rect.right + 12 && y >= rect.top - 12 && y <= rect.bottom + 36;
  }
  function trackEndTap(e) {
    var pointerId = e.pointerId;
    var startX = e.clientX;
    var startY = e.clientY;
    function finish(ev) {
      if (ev.pointerId !== pointerId) return;
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      if (ev.type === 'pointercancel') return;
      var dist = Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY);
      if (dist >= 8) { swallowClick(); return; }
      if (nearBench(ev.clientX, ev.clientY) || nearBench(startX, startY)) return;
      var under = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!under || !under.closest || !under.closest('[data-act=end]')) return;
      onEnd();
    }
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }
  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    var endBtn = e.target.closest ? e.target.closest('[data-act=end]') : null;
    if (endBtn && ctx && ctx.app.contains(endBtn)) { trackEndTap(e); return; }
    var chip = e.target.closest ? e.target.closest('[data-person]') : null;
    if (!chip || !ctx || !ctx.app.contains(chip)) return;
    if (drag) return;
    var key = chip.getAttribute('data-person');
    var pointerId = e.pointerId;
    var startX = e.clientX;
    var startY = e.clientY;
    var moved = false;
    var ghost = null;
    function move(ev) {
      if (ev.pointerId !== pointerId) return;
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 8) return;
      if (!moved) {
        moved = true;
        ghost = document.createElement('div');
        ghost.className = 'wb-ghost';
        ghost.textContent = chip.getAttribute('data-label') || 'Client';
        document.body.appendChild(ghost);
        try { chip.setPointerCapture(pointerId); } catch (err) {}
      }
      ev.preventDefault();
      ghost.style.left = (ev.clientX + 10) + 'px';
      ghost.style.top = (ev.clientY + 12) + 'px';
    }
    function up(ev) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      drag = null;
      if (ghost) ghost.style.display = 'none';
      var under = moved ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      if (!moved) return;
      swallowClick();
      if (!under || !under.closest) return;
      if (under.closest('[data-bench]')) return benchKey(key);
      if (under.closest('[data-act=end]')) return;
      var station = under.closest('[data-station]');
      if (nearBench(ev.clientX, ev.clientY) && !station) return;
      if (mode === 'place' && station) return placeKey(key, station.getAttribute('data-station'));
      if (mode === 'live') {
        var person = findLive(key);
        if (person && person.benched) return rejoinKey(key);
      }
    }
    drag = true;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  function onClick(e) {
    if (suppressClick) return;
    var button = e.target.closest ? e.target.closest('[data-act]') : null;
    if (button && !button.disabled) {
      var act = button.getAttribute('data-act');
      if (act === 'view') { view = button.getAttribute('data-view') === 'list' ? 'list' : 'grid'; persist(); paint(); return; }
      if (act === 'start') {
        if (!tracking && doc && doc.id && ctx) {
          ctx.go('#/circuits/' + encodeURIComponent(doc.id) + '/prepare' + (fromCalendar() ? '?from=calendar' : ''));
          return;
        }
        return onStart();
      }
      if (act === 'pause') return onPause();
      if (act === 'skip') return onSkip();
      if (act === 'end') return;
      if (act === 'done') { if (ctx) ctx.go('#/circuits'); return; }
      return;
    }
    var personEl = e.target.closest ? e.target.closest('[data-person]') : null;
    if (personEl && personEl.classList.contains('c-spot') && selected && personEl.getAttribute('data-person') !== selected) personEl = null;
    if (personEl) {
      var key = personEl.getAttribute('data-person');
      if (mode === 'live') {
        var live = findLive(key);
        if (live && live.benched && selected === key) return rejoinKey(key);
      }
      selected = selected === key ? '' : key;
      paint();
      return;
    }
    if (e.target.closest && e.target.closest('[data-bench]')) {
      if (!selected) return;
      if (mode === 'live') {
        var picked = findLive(selected);
        if (picked && !picked.benched) benchKey(selected);
        return;
      }
      benchKey(selected);
      return;
    }
    var station = e.target.closest ? e.target.closest('[data-station]') : null;
    if (!station || !selected) return;
    var stationId = station.getAttribute('data-station');
    if (!stationId) return;
    if (mode === 'place') return placeKey(selected, stationId);
    var again = findLive(selected);
    if (again && again.benched) rejoinKey(selected);
  }
  function onVis() {
    if (!ctx || mode !== 'live') return;
    if (document.visibilityState === 'visible' && clockApi()) clockApi().lockScreen();
    if (running) catchUp(true);
  }
  function restore(snap) {
    doc = snap.doc;
    view = snap.view === 'list' ? 'list' : 'grid';
    assigned = snap.assigned || {};
    startedAt = snap.startedAt || null;
    selected = '';
    if (snap.mode === 'live' && snap.state) {
      var extra = snap.running ? Math.max(0, wall() - (snap.wallAt || wall())) : 0;
      state = model().advanceSession(snap.state, (snap.state.elapsedMs || 0) + extra);
      mode = 'live';
      running = !!snap.running && !state.done;
      syncAnchor();
      armSchedule();
      toneMark = state.elapsedMs;
      if (state.done) return showSummary();
      if (clockApi()) clockApi().lockScreen();
      paint();
      kick();
      return;
    }
    mode = 'place';
    state = null;
    running = false;
    paint();
  }
  function unavailable(err) {
    return (err && err.message) || 'Group circuits are not available yet. Apply the circuits SQL in the Supabase SQL editor.';
  }
  function showError(message) {
    if (!ctx) return;
    ctx.titleEl.textContent = 'Group Circuit Training';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<div class="errs">' + esc(message) + '</div><button type="button" id="circuit-back-miss">Back</button>';
    ctx.app.onclick = function () { if (ctx) ctx.go(fromCalendar() ? '#/programs' : '#/circuits'); };
  }
  function takeClass(id) {
    try {
      var raw = localStorage.getItem('wb.circuit.class');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || String(parsed.circuitId) !== String(id)) return null;
      localStorage.removeItem('wb.circuit.class');
      return parsed;
    } catch (e) { return null; }
  }
  function load(id) {
    var token = ++loadToken;
    var handoff = tracking ? takeClass(id) : null;
    if (tracking && !handoff) {
      var snap = readStore();
      if (snap && String(snap.circuitId) === String(id) && snap.doc && snap.mode === 'live') {
        restore(snap);
        return;
      }
      if (ctx) ctx.go('#/circuits/' + encodeURIComponent(id) + '/prepare' + (fromCalendar() ? '?from=calendar' : ''));
      return;
    }
    if (!ctx) return;
    ctx.titleEl.textContent = 'Group Circuit Training';
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    var pending;
    try {
      pending = root.WBAuth && root.WBAuth.circuits ? root.WBAuth.circuits() : Promise.reject(new Error(unavailable()));
    } catch (e) { pending = Promise.reject(e); }
    Promise.resolve(pending).then(function (list) {
      if (token !== loadToken || !ctx) return;
      var row = (list || []).filter(function (item) { return item && String(item.id) === String(id); })[0];
      if (!row) return showError('That circuit was not found.');
      var opened = model().fromRow(row);
      if (!opened.ok) return showError(opened.errors && opened.errors[0] || 'That circuit could not be opened.');
      doc = opened.value;
      assigned = {};
      state = null;
      mode = 'place';
      view = 'grid';
      running = false;
      selected = '';
      record = null;
      if (handoff && Array.isArray(handoff.clients)) {
        doc.clients = handoff.clients;
        assigned = handoff.assigned || {};
        onStart();
        return;
      }
      paint();
    }, function (err) {
      if (token !== loadToken || !ctx) return;
      showError(unavailable(err));
    });
  }
  function mount(next) {
    stop();
    ctx = next || null;
    if (!ctx) return;
    markPage();
    ctx.backBtn.hidden = false;
    document.addEventListener('visibilitychange', onVis);
    if (!root.WBCircuit || !root.WBClock) return showError('Group circuits are not available yet.');
    var parts = hashParts();
    if (parts[0] !== 'circuits' || !parts[1] || (parts[2] !== 'run' && parts[2] !== 'view')) return showError('That circuit was not found.');
    tracking = parts[2] !== 'view';
    load(parts[1]);
  }
  function stop() {
    loadToken++;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    stopTones();
    stopArrows();
    document.removeEventListener('visibilitychange', onVis);
    if (clockApi()) clockApi().unlockScreen();
    if (ctx && ctx.app) {
      ctx.app.onclick = null;
      ctx.app.onpointerdown = null;
    }
    clearPage();
    ctx = null;
    doc = null;
    state = null;
    running = false;
    drag = null;
  }
  function back() {
    if (!ctx) return false;
    var parts = hashParts();
    if (parts[0] !== 'circuits' || (parts[2] !== 'run' && parts[2] !== 'view')) return false;
    if (mode === 'summary') { ctx.go(fromCalendar() ? '#/programs' : '#/circuits'); return true; }
    if (mode === 'live') { onEnd(); return true; }
    clearStore();
    if (fromCalendar()) { ctx.go('#/programs'); return true; }
    ctx.go(doc && doc.id ? '#/circuits/' + doc.id : '#/circuits');
    return true;
  }

  var api = { mount: mount, stop: stop, back: back };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBCircuitSession = api;
})(typeof window !== 'undefined' ? window : globalThis);
