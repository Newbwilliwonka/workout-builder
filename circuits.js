/* Group Circuit Training. List, set-up, and the handoff into a live session.
   Browser: window.WBCircuits. */
(function (root) {
  'use strict';

  var ctx = null;
  var draft = null;
  var savedJson = '';
  var roundsFollows = true;
  var rows = [];
  var loadError = '';
  var formError = [];
  var picking = '';
  var libQuery = '';
  var libRows = [];
  var libStatus = '';
  var libError = false;
  var libToken = 0;
  var libTimer = null;
  var manualExercise = '';
  var prepare = false;
  var classClients = [];
  var classSpot = {};
  var clockText = null;
  var busy = false;
  var loadToken = 0;
  var arrowObserver = null;
  var arrowFrame = 0;

  function model() { return root.WBCircuit; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hashParts() {
    var body = '';
    try { body = String(location.hash || '').replace(/^#\/?/, '').split('?')[0]; }
    catch (e) { body = ''; }
    return body.split('/');
  }
  function snapshot(doc) {
    return {
      name: doc.name,
      stations: doc.stations,
      order: doc.order,
      clock: doc.clock
    };
  }
  function fromCalendar() {
    var q = '';
    try { q = String(location.hash || '').split('?')[1] || ''; } catch (e) {}
    return /(^|&)from=calendar(&|$)/.test(q);
  }
  function dirty() {
    if (!draft) return false;
    return JSON.stringify(snapshot(draft)) !== savedJson;
  }
  function clockTextFrom(clock) {
    var C = model();
    var work = C.splitClock(clock.workSec);
    var move = C.splitClock(clock.moveSec);
    return {
      wm: String(work.m),
      ws: pad(work.s),
      mm: String(move.m),
      ms: pad(move.s),
      rounds: String(clock.rounds)
    };
  }
  function applyClockText() {
    var C = model();
    if (!draft || !clockText) return;
    var roundsRaw = String(clockText.rounds == null ? '' : clockText.rounds).replace(/^\s+|\s+$/g, '');
    draft.clock = {
      workSec: C.joinClock(clockText.wm, clockText.ws),
      moveSec: C.joinClock(clockText.mm, clockText.ms),
      rounds: /^\d+$/.test(roundsRaw) ? Number(roundsRaw) : null
    };
  }
  function followRounds() {
    if (!roundsFollows || !draft) return;
    var C = model();
    if (clockText) {
      var work = C.joinClock(clockText.wm, clockText.ws);
      var move = C.joinClock(clockText.mm, clockText.ms);
      if (work != null) draft.clock.workSec = work;
      if (move != null) draft.clock.moveSec = move;
    }
    draft.clock = C.syncRounds(draft.clock, draft.stations.length, true);
    var next = clockTextFrom(draft.clock);
    if (clockText) {
      if (C.joinClock(clockText.wm, clockText.ws) == null) { next.wm = clockText.wm; next.ws = clockText.ws; }
      if (C.joinClock(clockText.mm, clockText.ms) == null) { next.mm = clockText.mm; next.ms = clockText.ms; }
    }
    clockText = next;
  }
  function countLabel(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }
  function off() { return busy ? ' disabled' : ''; }
  function editorCols() {
    return 3;
  }
  function shownStations() {
    if (!draft || !model().fitLayout) return (draft && draft.stations) || [];
    return model().fitLayout(draft.stations, 3);
  }
  function shownRows(stations) {
    var used = 0;
    (stations || []).forEach(function (s) {
      if (s && typeof s.row === 'number' && s.row + 1 > used) used = s.row + 1;
    });
    return Math.max(2, used + 1);
  }
  function stillUrl(id) {
    var base = root.WBAuth && root.WBAuth.gifBase;
    if (root.WB && root.WB.exerciseStillUrl) return root.WB.exerciseStillUrl(id, base || '');
    return '';
  }
  function thumbHtml(row) {
    var url = stillUrl(row.id);
    if (!url) {
      return '<span class="lib-thumb" aria-hidden="true"><svg class="lib-thumb-ph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect><circle cx="9" cy="10" r="1.5" fill="currentColor"></circle><path d="M3 16l5-4 4 3 3-2 6 5" fill="none" stroke="currentColor" stroke-width="1.8"></path></svg></span>';
    }
    return '<span class="lib-thumb" aria-hidden="true"><img alt="" loading="lazy" src="' + esc(url) + '"></span>';
  }
  function libHit(row) {
    var meta = [row.body_part, row.equipment, row.target].filter(Boolean).join(' · ');
    return '<div class="lib-hit" data-act="pick" data-id="' + esc(row.id) + '" data-name="' + esc(row.name || '') + '">' +
      thumbHtml(row) +
      '<button type="button" class="lib-hit-main"><span class="name">' + esc(row.name || '') + '</span>' +
      (meta ? '<span class="mute">' + esc(meta) + '</span>' : '') +
      '</button></div>';
  }
  function libResultsHtml() {
    var q = String(libQuery || '').replace(/^\s+|\s+$/g, '');
    if (libStatus) return '<p class="' + (libError ? 'errs' : 'mute') + '">' + esc(libStatus) + '</p>';
    if (q.length < 2) return '<p class="mute">Type at least 2 letters.</p>';
    if (!libRows.length) return '<p class="mute">No exercises match that search.</p>';
    return libRows.map(libHit).join('');
  }
  function paintLib() {
    var box = document.getElementById('circuit-lib-results');
    if (box) box.innerHTML = libResultsHtml();
  }
  function scheduleSearch() {
    if (libTimer) clearTimeout(libTimer);
    libTimer = setTimeout(runSearch, 280);
  }
  function runSearch() {
    libTimer = null;
    var q = String(libQuery || '').replace(/^\s+|\s+$/g, '');
    var token = ++libToken;
    if (q.length < 2) {
      libRows = [];
      libStatus = '';
      libError = false;
      paintLib();
      return;
    }
    var search = root.WBAuth && root.WBAuth.searchExercises;
    if (!search) {
      libRows = [];
      libStatus = 'The exercise library is not ready yet.';
      libError = true;
      paintLib();
      return;
    }
    libStatus = 'Searching…';
    libError = false;
    paintLib();
    search(q, {}, 20, 0).then(function (list) {
      if (token !== libToken) return;
      libRows = Array.isArray(list) ? list : [];
      libStatus = '';
      libError = false;
      paintLib();
    }, function (err) {
      if (token !== libToken) return;
      libRows = [];
      libStatus = (err && err.message) || 'Could not search the exercise library.';
      libError = true;
      paintLib();
    });
  }
  function tileHtml(station) {
    var C = model();
    var n = C.stationNumber(draft.order, station.id);
    var exercise = station.exercise;
    var name = exercise && exercise.name ? exercise.name : 'Choose exercise';
    var manual = exercise && exercise.source === 'manual' ? '<span class="circuit-tag">manual</span>' : '';
    return '<span class="' + (n ? 'circuit-num' : 'circuit-num is-open') + '">' + (n ? String(n) : '·') + '</span>' +
      '<button type="button" class="circuit-x" data-act="remove" data-id="' + esc(station.id) + '" aria-label="Remove station"' + off() + '>×</button>' +
      '<div class="circuit-ex"><span class="circuit-name">' + esc(name) + '</span>' + manual + '</div>' +
      '<button type="button" class="circuit-change" data-act="change" data-id="' + esc(station.id) + '" aria-label="Change exercise"' + off() + '>' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>';
  }
  function pickerHtml() {
    if (!picking || !draft) return '';
    var station = (draft.stations || []).filter(function (s) { return s && s.id === picking; })[0];
    if (!station) return '';
    var n = model().stationNumber(draft.order, station.id);
    return '<div class="card" id="circuit-picker"><div class="name">' + (n ? 'Station ' + n : 'Choose an exercise') + '</div>' +
      '<label for="circuit-lib-q">Exercise library</label>' +
      '<input id="circuit-lib-q" value="' + esc(libQuery) + '" placeholder="Search exercises" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"' + off() + '>' +
      '<div id="circuit-lib-results">' + libResultsHtml() + '</div>' +
      '<label for="circuit-ex-name">Or type a name</label>' +
      '<input id="circuit-ex-name" value="' + esc(manualExercise) + '" placeholder="Exercise name" maxlength="80" autocomplete="off"' + off() + '>' +
      '<button type="button" class="pri" data-act="manual-exercise" style="width:100%;margin-top:8px"' + off() + '>Use this name</button></div>';
  }
  function phaseHtml(kind, label, minId, secId, minVal, secVal) {
    return '<div class="circuit-phase ' + kind + '"><div class="kicker">' + label + '</div><div class="time wb-digits">' +
      '<input id="' + minId + '" data-clear="1" data-req="1" type="text" inputmode="numeric" pattern="[0-9]*" aria-label="' + label + ' minutes" value="' + esc(minVal) + '" autocomplete="off"' + off() + '>' +
      '<span>:</span>' +
      '<input id="' + secId + '" data-clear="1" data-req="1" type="text" inputmode="numeric" pattern="[0-9]*" aria-label="' + label + ' seconds" value="' + esc(secVal) + '" autocomplete="off"' + off() + '>' +
      '</div></div>';
  }
  function errorsHtml() {
    if (!formError.length) return '';
    return '<div class="errs" id="circuit-err">' + formError.map(esc).join('<br>') + '</div>';
  }
  function stopArrows() {
    if (arrowObserver) { arrowObserver.disconnect(); arrowObserver = null; }
    if (arrowFrame) { cancelAnimationFrame(arrowFrame); arrowFrame = 0; }
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
    if (!board || !draft || !C) return;
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
      tiles[tile.getAttribute('data-grid-id') || tile.getAttribute('data-station')] = box;
    });
    var html = '<defs><marker id="circuit-arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#1e293b"></path></marker></defs>';
    C.loopEdges(draft.order).forEach(function (edge) {
      var a = tiles[edge.from];
      var b = tiles[edge.to];
      if (!a || !b) return;
      var points = retractEnds(C.arrowPoints(a, b, cells, edge.close), 6);
      if (!points || points.length < 2) return;
      html += '<polyline points="' + points.map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ') + '" fill="none" stroke="#1e293b" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" marker-end="url(#circuit-arrowhead)"></polyline>';
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
  function paintList() {
    if (!ctx) return;
    ctx.titleEl.textContent = 'Group Circuit Training';
    ctx.backBtn.hidden = false;
    var h = '<button class="pri" type="button" id="circuit-new" data-act="new" style="width:100%;margin-bottom:12px">+ New circuit</button>';
    if (loadError) h += '<div class="errs">' + esc(loadError) + '</div>';
    if (!rows.length && !loadError) h += '<div class="empty" id="circuit-empty">No circuits yet.<br>Tap “New circuit” to set one up.</div>';
    rows.forEach(function (row, i) {
      if (!row) return;
      var n = stationCount(row);
      var last = i === rows.length - 1;
      h += '<div class="card" data-circuit="' + esc(row.id) + '">' +
        '<div class="name" data-act="open" data-id="' + esc(row.id) + '" style="cursor:pointer">' + esc(row.name || 'Circuit') + '</div>' +
        '<div class="mute">' + esc(countLabel(n, 'station')) + '</div><div class="actions">' +
        '<button type="button" class="sm" data-act="up" data-id="' + esc(row.id) + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button type="button" class="sm" data-act="down" data-id="' + esc(row.id) + '" aria-label="Move down"' + (last ? ' disabled' : '') + '>▼</button>' +
        '<button type="button" class="pri sm" data-act="open" data-id="' + esc(row.id) + '">Edit</button>' +
        '<button type="button" class="sm" data-act="view" data-id="' + esc(row.id) + '"' + (n ? '' : ' disabled') + '>View</button>' +
        '<button type="button" class="sm" data-act="run" data-id="' + esc(row.id) + '"' + (n ? '' : ' disabled') + '>Run</button>' +
        '<button type="button" class="sm danger" data-act="del" data-id="' + esc(row.id) + '">Delete</button></div></div>';
    });
    ctx.app.innerHTML = h;
    ctx.app.oninput = null;
    ctx.app.onkeydown = null;
    ctx.app.onpointerdown = null;
    ctx.app.onclick = onClick;
  }
  function paintMissing() {
    if (!ctx) return;
    ctx.titleEl.textContent = 'Set up circuit';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = errorsHtml() + '<button type="button" data-act="cancel">Back</button>';
    ctx.app.oninput = null;
    ctx.app.onkeydown = null;
    ctx.app.onpointerdown = null;
    ctx.app.onclick = onClick;
  }
  function paint() {
    if (!ctx || !draft) return paintMissing();
    var C = model();
    ctx.titleEl.textContent = 'Set up circuit';
    ctx.backBtn.hidden = false;
    if (!clockText) clockText = clockTextFrom(draft.clock);
    var h = '<div class="circuit-setup">' + errorsHtml();
    h += '<label class="circuit-name-label" for="circuit-name">Circuit name</label>' +
      '<input id="circuit-name" class="circuit-name-input" value="' + esc(draft.name) + '" maxlength="80" autocomplete="off" placeholder="Morning circuit"' + off() + '>';
    h += '<div class="circuit-section"><h2>Stations</h2>' +
      '<button type="button" class="circuit-sm ghost" data-act="add"' + off() + '>+ Add station</button>' +
      '<button type="button" class="circuit-sm" id="circuit-clear" data-act="clear"' + (busy || !draft.order.length ? ' disabled' : '') + '>Clear order</button></div>';
    h += '<div class="circuit-hint" id="circuit-hint">Create and name your stations, then tap each station to set up the order of flow.</div>';
    h += '<div class="circuit-board' + (busy ? ' is-busy' : '') + '" id="circuit-board"><svg class="circuit-arrows" aria-hidden="true"></svg><div id="circuit-grid"></div></div>';
    h += pickerHtml();
    h += '<div class="circuit-clock">' +
      phaseHtml('work', 'Work', 'circuit-work-m', 'circuit-work-s', clockText.wm, clockText.ws) +
      phaseHtml('move', 'Move', 'circuit-move-m', 'circuit-move-s', clockText.mm, clockText.ms) +
      '<div class="circuit-phase rounds"><label class="kicker" for="circuit-rounds">Rounds</label>' +
      '<input id="circuit-rounds" class="wb-digits" data-clear="1" data-req="1" type="text" inputmode="numeric" pattern="[0-9]*" value="' + esc(clockText.rounds) + '" autocomplete="off"' + off() + '></div></div>' +
      '<p class="circuit-track" id="circuit-track">Tracking: time per station (editable)</p>';
    h += '<div class="circuit-actions">' +
      '<button type="button" class="pri circuit-start" data-act="save"' + (busy ? ' disabled' : '') + '>Save</button>' +
      '<button type="button" class="circuit-quiet" data-act="cancel"' + (busy ? ' disabled' : '') + '>Cancel</button></div></div>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = onClick;
    ctx.app.onpointerdown = null;
    ctx.app.oninput = onInput;
    ctx.app.onkeydown = onKey;
    var grid = document.getElementById('circuit-grid');
    if (grid && root.WBGrid) {
      var shown = shownStations();
      root.WBGrid.mount(grid, {
        cols: editorCols(),
        rows: shownRows(shown),
        label: 'Circuit stations',
        items: shown.map(function (station) {
          var exercise = station.exercise;
          return {
            id: station.id,
            col: station.col,
            row: station.row,
            label: exercise && exercise.name ? exercise.name : 'Station',
            html: tileHtml(station)
          };
        }),
        onTap: onTap,
        onMove: onMove
      });
    }
    watchArrows();
  }
  function onTap(id) {
    if (!draft || busy) return;
    var next = model().tapStation(draft.stations, draft.order, id);
    if (next.join(',') === (draft.order || []).join(',')) return;
    draft.order = next;
    formError = [];
    paint();
  }
  function onMove(id, col, row) {
    if (!draft || busy) return;
    var moved = model().moveStation(draft, id, col, row);
    if (!moved.ok) { if (ctx) ctx.toast(moved.error); return; }
    draft = moved.circuit;
    paint();
  }
  function onAdd() {
    if (busy || !draft) return;
    var added = model().addStation(draft, editorCols(draft.stations));
    if (!added.ok) { if (ctx) ctx.toast(added.error); return; }
    draft = added.circuit;
    followRounds();
    picking = added.station.id;
    libQuery = '';
    libRows = [];
    libStatus = '';
    libError = false;
    manualExercise = '';
    formError = [];
    paint();
    var box = document.getElementById('circuit-lib-q');
    if (box) box.focus();
  }
  function onRemove(id) {
    if (busy || !draft) return;
    draft = model().removeStation(draft, id);
    if (picking === id) picking = '';
    followRounds();
    formError = [];
    paint();
  }
  function onChangeExercise(id) {
    if (busy || !draft) return;
    picking = picking === id ? '' : id;
    libQuery = '';
    libRows = [];
    libStatus = '';
    libError = false;
    manualExercise = '';
    paint();
    if (picking) {
      var box = document.getElementById('circuit-lib-q');
      if (box) box.focus();
    }
  }
  function onPick(id, name) {
    if (busy || !draft) return;
    var set = model().setExercise(draft, picking, { source: 'library', libraryId: id, name: name });
    if (!set.ok) { formError = [set.error]; paint(); return; }
    draft = set.circuit;
    picking = '';
    formError = [];
    paint();
  }
  function onManualExercise() {
    if (busy || !draft) return;
    var field = document.getElementById('circuit-ex-name');
    if (field) manualExercise = field.value;
    var set = model().setExercise(draft, picking, { source: 'manual', name: manualExercise });
    if (!set.ok) { formError = [set.error]; paint(); return; }
    draft = set.circuit;
    picking = '';
    manualExercise = '';
    formError = [];
    paint();
  }
  function markEmptyClock() {
    ['circuit-work-m', 'circuit-work-s', 'circuit-move-m', 'circuit-move-s', 'circuit-rounds'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var empty = String(el.value == null ? '' : el.value).trim() === '';
      if (empty) {
        el.classList.add('is-empty');
        el.setAttribute('aria-invalid', 'true');
      } else {
        el.classList.remove('is-empty');
        el.removeAttribute('aria-invalid');
      }
    });
  }
  function onSave() {
    if (!draft || busy || !ctx) return;
    var name = document.getElementById('circuit-name');
    if (name) draft.name = name.value;
    applyClockText();
    var payload = model().toPayload(draft);
    if (!payload.ok) {
      formError = payload.errors.filter(function (msg) {
        if (msg === 'Enter the work time.' && String(clockText.wm || '').trim() !== '' && String(clockText.ws || '').trim() !== '') return false;
        if (msg === 'Enter the move time.' && String(clockText.mm || '').trim() !== '' && String(clockText.ms || '').trim() !== '') return false;
        if (msg === 'Enter the rounds.' && String(clockText.rounds || '').trim() !== '') return false;
        return true;
      });
      if (!formError.length) formError = payload.errors;
      paint();
      markEmptyClock();
      return;
    }
    if (!root.WBAuth || !root.WBAuth.saveCircuit) {
      formError = ['Group circuits are not available yet. Apply the circuits SQL in the Supabase SQL editor.'];
      paint();
      return;
    }
    busy = true;
    formError = [];
    paint();
    var row = { name: payload.name, data: payload.data };
    if (payload.id) row.id = payload.id;
    root.WBAuth.saveCircuit(row).then(function () {
      busy = false;
      savedJson = JSON.stringify({
        name: payload.name,
        stations: payload.data.stations,
        order: payload.data.order,
        clock: payload.data.clock
      });
      if (ctx) ctx.toast('Saved');
      if (ctx) ctx.go('#/circuits');
    }, function (err) {
      busy = false;
      formError = [(err && err.message) || 'Could not save that circuit.'];
      if (ctx) paint();
    });
  }
  function onCancel() {
    if (!ctx) return;
    if (draft && dirty() && !confirm('Leave without saving?')) return;
    ctx.go('#/circuits');
  }
  function onDelete(id) {
    var row = rows.filter(function (item) { return item && String(item.id) === String(id); })[0];
    var name = row && row.name ? row.name : 'this circuit';
    if (!confirm('Delete “' + name + '”? This cannot be undone.')) return;
    if (!root.WBAuth || !root.WBAuth.deleteCircuit) return;
    root.WBAuth.deleteCircuit(id).then(function () {
      if (ctx) ctx.toast('Deleted');
      loadList();
    }, function (err) {
      loadError = (err && err.message) || 'Could not delete that circuit.';
      paintList();
    });
  }
  function onRun(id) {
    if (!ctx) return;
    var target = id || (draft && draft.id);
    if (!target) return;
    if (id && !stationCount(rowById(id))) return;
    ctx.go('#/circuits/' + target + '/prepare' + (fromCalendar() ? '?from=calendar' : ''));
  }
  function onView(id) {
    if (!ctx || !id || !stationCount(rowById(id))) return;
    ctx.go('#/circuits/' + id + '/view?from=list');
  }
  function moveCircuit(id, dir) {
    var i = -1;
    rows.forEach(function (row, at) { if (row && String(row.id) === String(id)) i = at; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    var held = rows[i];
    rows[i] = rows[j];
    rows[j] = held;
    writeCircuitOrder(rows);
    paintList();
  }
  function onClick(e) {
    var button = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!button || button.disabled || busy) return;
    var act = button.getAttribute('data-act');
    if (act === 'new') return ctx.go('#/circuits/new');
    if (act === 'up' || act === 'down') return moveCircuit(button.getAttribute('data-id'), act === 'up' ? -1 : 1);
    if (act === 'run') return onRun(button.getAttribute('data-id'));
    if (act === 'view') return onView(button.getAttribute('data-id'));
    if (act === 'open') return ctx.go('#/circuits/' + button.getAttribute('data-id'));
    if (act === 'del') return onDelete(button.getAttribute('data-id'));
    if (act === 'add') return onAdd();
    if (act === 'clear') {
      if (!draft) return;
      draft.order = model().clearOrder();
      formError = [];
      paint();
      return;
    }
    if (act === 'remove') return onRemove(button.getAttribute('data-id'));
    if (act === 'change') return onChangeExercise(button.getAttribute('data-id'));
    if (act === 'pick') return onPick(button.getAttribute('data-id'), button.getAttribute('data-name'));
    if (act === 'manual-exercise') return onManualExercise();
    if (act === 'manual-open' && prepare) return onPrepareManual();
    if (act === 'start-class') return onStartClass();
    if (act === 'save') return onSave();
    if (act === 'cancel') return onCancel();
  }
  function onInput(e) {
    var field = e.target;
    if (busy || !field || !draft) return;
    if (String(field.value == null ? '' : field.value).trim() !== '') {
      field.classList.remove('is-empty');
      field.removeAttribute('aria-invalid');
    }
    if (field.id === 'circuit-name') { draft.name = field.value; return; }
    if (!clockText) clockText = clockTextFrom(draft.clock);
    if (field.id === 'circuit-work-m' || field.id === 'circuit-work-s' || field.id === 'circuit-move-m' || field.id === 'circuit-move-s') {
      if (field.id === 'circuit-work-m') clockText.wm = field.value;
      if (field.id === 'circuit-work-s') clockText.ws = field.value;
      if (field.id === 'circuit-move-m') clockText.mm = field.value;
      if (field.id === 'circuit-move-s') clockText.ms = field.value;
      var work = model().joinClock(clockText.wm, clockText.ws);
      var move = model().joinClock(clockText.mm, clockText.ms);
      if (work != null) draft.clock.workSec = work;
      if (move != null) draft.clock.moveSec = move;
      return;
    }
    if (field.id === 'circuit-rounds') {
      clockText.rounds = field.value;
      roundsFollows = false;
      var roundsRaw = String(field.value || '').replace(/^\s+|\s+$/g, '');
      if (/^\d+$/.test(roundsRaw)) draft.clock.rounds = Number(roundsRaw);
      return;
    }
    if (field.id === 'circuit-lib-q') { libQuery = field.value; scheduleSearch(); return; }
    if (field.id === 'circuit-ex-name') { manualExercise = field.value; return; }
  }
  function onKey(e) {
    if (busy || e.key !== 'Enter') return;
    if (e.target && e.target.id === 'circuit-ex-name') { e.preventDefault(); onManualExercise(); }
  }
  var CIRCUIT_ORDER_KEY = 'wb.circuitOrder.v1';
  function readCircuitOrder() {
    try {
      var raw = JSON.parse(localStorage.getItem(CIRCUIT_ORDER_KEY) || '[]');
      return Array.isArray(raw) ? raw.map(function (id) { return String(id); }) : [];
    } catch (e) { return []; }
  }
  function writeCircuitOrder(list) {
    try {
      localStorage.setItem(CIRCUIT_ORDER_KEY, JSON.stringify((list || []).map(function (row) {
        return String(row && row.id || '');
      }).filter(Boolean)));
    } catch (e) {}
  }
  function sortCircuits(list) {
    var order = readCircuitOrder();
    if (!order.length) return list;
    var rank = {};
    order.forEach(function (id, i) { rank[id] = i; });
    var known = [];
    var fresh = [];
    (list || []).forEach(function (row) {
      var id = row && row.id != null ? String(row.id) : '';
      if (id && Object.prototype.hasOwnProperty.call(rank, id)) known.push(row);
      else fresh.push(row);
    });
    known.sort(function (a, b) { return rank[String(a.id)] - rank[String(b.id)]; });
    return fresh.concat(known);
  }
  function rowById(id) {
    var found = null;
    rows.forEach(function (row) { if (!found && row && String(row.id) === String(id)) found = row; });
    return found;
  }
  function stationCount(row) {
    var stations = row && row.data && row.data.stations;
    return Array.isArray(stations) ? stations.length : 0;
  }
  function unavailable(err) {
    return (err && err.message) || 'Group circuits are not available yet. Apply the circuits SQL in the Supabase SQL editor.';
  }
  function loadList() {
    var token = ++loadToken;
    if (!ctx) return;
    ctx.titleEl.textContent = 'Group Circuit Training';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    ctx.app.onclick = null;
    var pending;
    try {
      pending = root.WBAuth && root.WBAuth.circuits ? root.WBAuth.circuits() : Promise.reject(new Error(unavailable()));
    } catch (e) { pending = Promise.reject(e); }
    Promise.resolve(pending).then(function (list) {
      if (token !== loadToken || !ctx) return;
      rows = sortCircuits(Array.isArray(list) ? list : []);
      loadError = '';
      paintList();
    }, function (err) {
      if (token !== loadToken || !ctx) return;
      rows = [];
      loadError = unavailable(err);
      paintList();
    });
  }
  function beginDraft(next, follows) {
    draft = next;
    roundsFollows = follows;
    clockText = clockTextFrom(draft.clock);
    savedJson = JSON.stringify(snapshot(draft));
    formError = [];
    picking = '';
    libQuery = '';
    libRows = [];
    libStatus = '';
    manualExercise = '';
    busy = false;
    paint();
  }
  function loadEditor(id) {
    var token = ++loadToken;
    if (!ctx) return;
    ctx.titleEl.textContent = 'Set up circuit';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    ctx.app.onclick = null;
    var circuitP;
    try {
      circuitP = id ? (root.WBAuth && root.WBAuth.circuits ? root.WBAuth.circuits() : Promise.reject(new Error(unavailable()))) : Promise.resolve([]);
    } catch (e) { circuitP = Promise.reject(e); }
    Promise.resolve(circuitP).then(function (list) {
      if (token !== loadToken || !ctx) return;
      list = Array.isArray(list) ? list : [];
      if (!id) return beginDraft(model().blank(), true);
      var row = list.filter(function (item) { return item && String(item.id) === String(id); })[0];
      if (!row) {
        draft = null;
        formError = ['That circuit was not found.'];
        paintMissing();
        return;
      }
      var opened = model().fromRow(row);
      if (!opened.ok) {
        draft = null;
        formError = opened.errors.length ? opened.errors : ['That circuit could not be opened.'];
        paintMissing();
        return;
      }
      beginDraft(opened.value, false);
    }, function (err) {
      if (token !== loadToken || !ctx) return;
      draft = null;
      formError = [unavailable(err)];
      paintMissing();
    });
  }
  function classKey(person) { return model().personKey(person); }
  function chipHtml(person) {
    var C = model();
    var manual = person.source === 'manual';
    var color = manual ? '' : C.avatarColor(person.name);
    return '<button type="button" class="c-person' + (manual ? ' is-manual' : '') + '" data-person="' + esc(classKey(person)) + '" data-label="' + esc(C.initials(person.name)) + '" aria-label="' + esc(person.name) + '">' +
      '<span class="c-ava' + (manual ? ' is-manual' : '') + '"' + (color ? ' style="background:' + color + '"' : '') + ' aria-hidden="true">' + esc(C.initials(person.name)) + '</span></button>';
  }
  function peopleAt(stationId, bench) {
    var html = '';
    classClients.forEach(function (person) {
      var spot = classSpot[classKey(person)];
      var onBench = !!(spot && spot.bench);
      var onStation = !!(spot && spot.stationId && !spot.bench);
      if (bench && onBench) html += chipHtml(person);
      if (!bench && onStation && spot.stationId === stationId) html += chipHtml(person);
    });
    return html;
  }
  function trayHtml() {
    var html = '';
    classClients.forEach(function (person) {
      var spot = classSpot[classKey(person)];
      if (spot && (spot.bench || spot.stationId)) return;
      html += chipHtml(person);
    });
    return html;
  }
  function prepareGrid() {
    var C = model();
    var shown = shownStations();
    var cols = editorCols();
    var rows = shownRows(shown);
    var byPos = {};
    shown.forEach(function (s) { if (s) byPos[s.col + ',' + s.row] = s; });
    var h = '<div class="circuit-board" id="circuit-board"><svg class="circuit-arrows" aria-hidden="true"></svg>' +
      '<div class="wb-grid" role="grid" aria-label="Circuit stations" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">';
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var station = byPos[c + ',' + r];
        h += '<div class="wb-cell" role="gridcell" data-col="' + c + '" data-row="' + r + '"' + (station ? ' data-station="' + esc(station.id) + '"' : '') + '>';
        if (station) {
          var n = C.stationNumber(draft.order, station.id);
          var exercise = station.exercise;
          var name = exercise && exercise.name ? exercise.name : 'Station';
          h += '<div class="wb-tile" data-station="' + esc(station.id) + '">' +
            '<span class="circuit-num">' + (n || '·') + '</span>' +
            '<div class="circuit-ex"><span class="circuit-name">' + esc(name) + '</span></div>' +
            '<div class="c-faces">' + peopleAt(station.id, false) + '</div></div>';
        }
        h += '</div>';
      }
    }
    return h + '</div></div>';
  }
  function paintPrepare() {
    if (!ctx || !draft) return paintMissing();
    ctx.titleEl.textContent = 'Prepare Class';
    ctx.backBtn.hidden = false;
    var h = '<div class="circuit-prepare" id="circuit-prepare">' + errorsHtml();
    h += prepareGrid();
    h += '<div class="circuit-hint" id="circuit-hint">Drag your clients to their station.</div>';
    h += '<div class="circuit-clients" id="circuit-prepare-clients"><div class="circuit-section"><h2>Clients</h2>' +
      '<button type="button" class="circuit-sm ghost" data-act="manual-open">+ Manual client</button></div>' +
      '<div class="circuit-people">' + trayHtml() + '</div></div>';
    h += '<div class="circuit-prepare-bench" data-bench="1"><div class="circuit-bench-label">Bench</div>' +
      '<p>During class, drag a client to the Bench to pull them out of the rotation, or back onto a station to rejoin.</p>' +
      '<div class="c-faces">' + peopleAt('', true) + '</div></div>';
    h += '<button type="button" class="pri circuit-start" data-act="start-class"' + (classReady() ? '' : ' disabled') + '>Start</button></div>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = onClick;
    ctx.app.oninput = null;
    ctx.app.onkeydown = null;
    ctx.app.onpointerdown = onPreparePointer;
    watchArrows();
  }
  function placeClass(key, stationId) {
    classSpot[key] = stationId ? { stationId: stationId } : {};
    paintPrepare();
  }
  function benchClass(key) {
    classSpot[key] = { bench: true };
    paintPrepare();
  }
  function onPreparePointer(e) {
    if (!prepare || (e.button != null && e.button !== 0)) return;
    var chip = e.target.closest ? e.target.closest('[data-person]') : null;
    if (!chip || !ctx || !ctx.app.contains(chip)) return;
    var key = chip.getAttribute('data-person');
    var pointerId = e.pointerId;
    var startX = e.clientX;
    var startY = e.clientY;
    var moved = false;
    var ghost = null;
    try { chip.setPointerCapture(pointerId); } catch (err) {}
    if (e.cancelable) e.preventDefault();
    function release() {
      try { if (chip.hasPointerCapture && chip.hasPointerCapture(pointerId)) chip.releasePointerCapture(pointerId); } catch (err2) {}
    }
    function move(ev) {
      if (ev.pointerId !== pointerId) return;
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 8) return;
      if (!moved) {
        moved = true;
        ghost = document.createElement('div');
        ghost.className = 'wb-ghost';
        ghost.textContent = chip.getAttribute('data-label') || '';
        document.body.appendChild(ghost);
      }
      if (ev.cancelable) ev.preventDefault();
      ghost.style.left = (ev.clientX + 10) + 'px';
      ghost.style.top = (ev.clientY + 12) + 'px';
    }
    function up(ev) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      release();
      if (ghost) ghost.style.display = 'none';
      var under = moved ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      if (!moved || !under || !under.closest) return;
      if (under.closest('[data-bench]')) return benchClass(key);
      var station = under.closest('[data-station]');
      if (station) placeClass(key, station.getAttribute('data-station'));
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  function onPrepareManual() {
    var typed = '';
    try { typed = window.prompt('Client name') || ''; } catch (e) { typed = ''; }
    if (!typed) return;
    var added = model().addManualClient(classClients, typed);
    if (!added.ok) { formError = [added.error]; paintPrepare(); return; }
    classClients = added.clients;
    formError = [];
    paintPrepare();
  }
  function classReady() {
    return classClients.length > 0;
  }
  function onStartClass() {
    if (!ctx || !draft || !draft.id || !classReady()) return;
    var C = model();
    var assigned = {};
    classClients.forEach(function (person) {
      var key = classKey(person);
      var spot = classSpot[key];
      if (spot && spot.stationId && !spot.bench) assigned[key] = { stationId: spot.stationId };
      else assigned[key] = { bench: true };
    });
    try {
      localStorage.setItem('wb.circuit.class', JSON.stringify({
        circuitId: draft.id,
        clients: classClients,
        assigned: assigned
      }));
    } catch (e) {
      formError = ['Could not start the class. Your placements are still here.'];
      paintPrepare();
      return;
    }
    ctx.go('#/circuits/' + draft.id + '/run' + (fromCalendar() ? '?from=calendar' : ''));
  }
  function loadPrepare(id) {
    var token = ++loadToken;
    prepare = true;
    if (!ctx) return;
    ctx.titleEl.textContent = 'Prepare Class';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    var circuitP;
    var rosterP;
    try {
      circuitP = root.WBAuth && root.WBAuth.circuits ? root.WBAuth.circuits() : Promise.reject(new Error(unavailable()));
    } catch (e) { circuitP = Promise.reject(e); }
    try {
      rosterP = root.WBAuth && root.WBAuth.roster ? root.WBAuth.roster() : Promise.resolve({ clients: [] });
    } catch (e2) { rosterP = Promise.resolve({ clients: [] }); }
    Promise.all([
      Promise.resolve(circuitP),
      Promise.resolve(rosterP).then(function (res) { return res; }, function () { return { clients: [] }; })
    ]).then(function (pair) {
      if (token !== loadToken || !ctx) return;
      var list = Array.isArray(pair[0]) ? pair[0] : [];
      var row = list.filter(function (item) { return item && String(item.id) === String(id); })[0];
      if (!row) {
        draft = null;
        formError = ['That circuit was not found.'];
        paintMissing();
        return;
      }
      var opened = model().fromRow(row);
      if (!opened.ok) {
        draft = null;
        formError = opened.errors.length ? opened.errors : ['That circuit could not be opened.'];
        paintMissing();
        return;
      }
      draft = opened.value;
      classClients = [];
      ((pair[1] && pair[1].clients) || []).forEach(function (person) {
        var linked = model().linkedClient(person);
        if (linked) classClients.push(linked);
      });
      classSpot = {};
      formError = [];
      paintPrepare();
    }, function (err) {
      if (token !== loadToken || !ctx) return;
      draft = null;
      formError = [unavailable(err)];
      paintMissing();
    });
  }
  function markPage() { try { document.body.classList.add('circuit-on'); } catch (e) {} }
  function clearPage() { try { document.body.classList.remove('circuit-on'); } catch (e2) {} }
  function mount(next) {
    stop();
    ctx = next || null;
    markPage();
    if (!ctx) return;
    ctx.backBtn.hidden = false;
    if (!root.WBCircuit || !root.WBGrid) {
      ctx.titleEl.textContent = 'Group Circuit Training';
      ctx.app.innerHTML = '<div class="card" id="circuit-wait"><div class="name">Not available yet</div><p class="mute">Group circuits are not available yet.</p></div>';
      return;
    }
    var parts = hashParts();
    if (parts[0] !== 'circuits' || !parts[1]) return loadList();
    if (parts[2] === 'prepare') return loadPrepare(parts[1]);
    if (parts[1] === 'new') return loadEditor('');
    return loadEditor(parts[1]);
  }
  function stop() {
    clearPage();
    loadToken++;
    libToken++;
    if (libTimer) { clearTimeout(libTimer); libTimer = null; }
    stopArrows();
    if (ctx && ctx.app) {
      var grid = ctx.app.querySelector ? ctx.app.querySelector('#circuit-grid') : null;
      if (grid && root.WBGrid) root.WBGrid.unmount(grid);
      ctx.app.onclick = null;
      ctx.app.oninput = null;
      ctx.app.onkeydown = null;
    }
    ctx = null;
    draft = null;
    prepare = false;
    classClients = [];
    classSpot = {};
    busy = false;
  }
  function back() {
    if (!ctx) return false;
    var parts = hashParts();
    if (parts[0] !== 'circuits' || !parts[1]) return false;
    if (prepare || parts[2] === 'prepare') {
      ctx.go(fromCalendar() ? '#/programs' : '#/circuits');
      return true;
    }
    onCancel();
    return true;
  }

  var api = { mount: mount, stop: stop, back: back };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBCircuits = api;
})(typeof window !== 'undefined' ? window : globalThis);
