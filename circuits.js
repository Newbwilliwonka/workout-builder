/* Group Circuit Training. List and set-up only. The live clock is a later step.
   Browser: window.WBCircuits. */
(function (root) {
  'use strict';

  var ctx = null;
  var draft = null;
  var savedJson = '';
  var roundsFollows = true;
  var rows = [];
  var roster = [];
  var rosterError = '';
  var loadError = '';
  var formError = [];
  var picking = '';
  var libQuery = '';
  var libRows = [];
  var libStatus = '';
  var libError = false;
  var libToken = 0;
  var libTimer = null;
  var manualOpen = false;
  var manualName = '';
  var manualExercise = '';
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
      clients: doc.clients,
      clock: doc.clock
    };
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
  function editorCols(stations) {
    var C = model();
    var width = 480;
    try {
      if (ctx && ctx.app && ctx.app.clientWidth) width = ctx.app.clientWidth;
      else if (root.innerWidth) width = root.innerWidth;
    } catch (e) {}
    var fit = width < 520 ? 3 : C.COLS;
    var used = 0;
    (stations || []).forEach(function (s) {
      if (s && typeof s.col === 'number' && s.col + 1 > used) used = s.col + 1;
    });
    var cols = Math.max(fit, used);
    return cols > C.COLS ? C.COLS : cols;
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
  function rosterRows() {
    var C = model();
    var out = [];
    (roster || []).forEach(function (person) {
      var row = C.linkedClient(person);
      if (row) out.push(row);
    });
    return out;
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
      '<button type="button" class="circuit-change" data-act="change" data-id="' + esc(station.id) + '"' + off() + '>Change</button>';
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
  function clientsHtml() {
    var C = model();
    var h = '<div class="circuit-people" id="circuit-people">';
    rosterRows().forEach(function (person) {
      var on = (draft.clients || []).some(function (c) { return c && c.source === 'linked' && c.id === person.id; });
      h += '<button type="button" class="circuit-person' + (on ? ' on' : '') + '" data-act="client" data-id="' + esc(person.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + off() + '>' +
        '<span class="ava" aria-hidden="true">' + esc(C.initial(person.name)) + '</span>' +
        '<span class="circuit-person-name">' + esc(person.name) + '</span></button>';
    });
    (draft.clients || []).forEach(function (client) {
      if (!client || client.source !== 'manual') return;
      h += '<button type="button" class="circuit-person on" data-act="manual-chip" data-name="' + esc(client.name) + '" aria-label="Remove ' + esc(client.name) + '"' + off() + '>' +
        '<span class="ava" aria-hidden="true">' + esc(C.initial(client.name)) + '</span>' +
        '<span class="circuit-person-name">' + esc(client.name) + '</span>' +
        '<span class="circuit-tag">manual</span></button>';
    });
    h += '</div>';
    if (!rosterRows().length && !rosterError) h += '<p class="mute">No linked clients yet.</p>';
    if (rosterError) h += '<p class="mute">' + esc(rosterError) + '</p>';
    h += '<button type="button" data-act="manual-open"' + off() + '>+ Manual client</button>';
    if (manualOpen) {
      h += '<label for="circuit-client-name">Client name</label>' +
        '<input id="circuit-client-name" value="' + esc(manualName) + '" placeholder="Name" maxlength="80" autocomplete="name"' + off() + '>' +
        '<button type="button" class="pri" data-act="manual-add" style="width:100%;margin-top:8px"' + off() + '>Add client</button>';
    }
    return h;
  }
  function phaseHtml(kind, label, minId, secId, minVal, secVal) {
    return '<div class="circuit-phase ' + kind + '"><div class="kicker">' + label + '</div><div class="time">' +
      '<input id="' + minId + '" type="text" inputmode="numeric" pattern="[0-9]*" aria-label="' + label + ' minutes" value="' + esc(minVal) + '" autocomplete="off"' + off() + '>' +
      '<span>:</span>' +
      '<input id="' + secId + '" type="text" inputmode="numeric" pattern="[0-9]*" aria-label="' + label + ' seconds" value="' + esc(secVal) + '" autocomplete="off"' + off() + '>' +
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
      tiles[tile.getAttribute('data-grid-id')] = spot;
    });
    var html = '<defs><marker id="circuit-arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#2563eb"></path></marker></defs>';
    C.loopEdges(draft.order).forEach(function (edge) {
      var a = tiles[edge.from];
      var b = tiles[edge.to];
      if (!a || !b) return;
      var points = C.arrowPoints(a, b, cells, edge.close);
      if (!points || points.length < 2) return;
      html += '<polyline points="' + points.map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ') + '" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" marker-end="url(#circuit-arrowhead)"></polyline>';
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
    var C = model();
    var h = '<button class="pri" type="button" id="circuit-new" data-act="new" style="width:100%;margin-bottom:12px">+ New circuit</button>';
    if (loadError) h += '<div class="errs">' + esc(loadError) + '</div>';
    if (!rows.length && !loadError) h += '<div class="empty" id="circuit-empty">No circuits yet.<br>Tap “New circuit” to set one up.</div>';
    rows.forEach(function (row) {
      if (!row) return;
      var data = row.data || {};
      var info = C.summary({ name: row.name, stations: data.stations, clients: data.clients });
      h += '<div class="card" data-circuit="' + esc(row.id) + '"><div class="name">' + esc(row.name || 'Circuit') + '</div>' +
        '<div class="mute">' + esc(countLabel(info.stations, 'station')) + ' · ' + esc(countLabel(info.clients, 'client')) + '</div>' +
        '<div class="actions"><button type="button" class="pri sm" data-act="open" data-id="' + esc(row.id) + '">Open</button>' +
        '<button type="button" class="sm danger" data-act="del" data-id="' + esc(row.id) + '">Delete</button></div></div>';
    });
    ctx.app.innerHTML = h;
    ctx.app.oninput = null;
    ctx.app.onkeydown = null;
    ctx.app.onclick = onClick;
  }
  function paintMissing() {
    if (!ctx) return;
    ctx.titleEl.textContent = 'Set up circuit';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = errorsHtml() + '<button type="button" data-act="cancel">Back</button>';
    ctx.app.oninput = null;
    ctx.app.onkeydown = null;
    ctx.app.onclick = onClick;
  }
  function paint() {
    if (!ctx || !draft) return paintMissing();
    var C = model();
    ctx.titleEl.textContent = 'Set up circuit';
    ctx.backBtn.hidden = false;
    if (!clockText) clockText = clockTextFrom(draft.clock);
    var h = errorsHtml();
    h += '<div class="card"><label for="circuit-name">Circuit name</label>' +
      '<input id="circuit-name" value="' + esc(draft.name) + '" maxlength="80" autocomplete="off" placeholder="Morning circuit"' + off() + '></div>';
    h += '<div class="card"><div class="row">' +
      '<button type="button" class="pri grow" data-act="add"' + off() + '>+ Add station</button>' +
      '<button type="button" id="circuit-clear" data-act="clear"' + (busy || !draft.order.length ? ' disabled' : '') + '>Clear order</button></div>' +
      '<p class="mute" id="circuit-hint">Tap stations in order to draw the loop.</p>' +
      '<div class="circuit-board' + (busy ? ' is-busy' : '') + '" id="circuit-board"><svg class="circuit-arrows" aria-hidden="true"></svg><div id="circuit-grid"></div></div></div>';
    h += pickerHtml();
    h += '<div class="card"><div class="name">Clients</div>' + clientsHtml() + '</div>';
    h += '<div class="card"><div class="name">Clock</div><div class="circuit-clock">' +
      phaseHtml('work', 'Work', 'circuit-work-m', 'circuit-work-s', clockText.wm, clockText.ws) +
      phaseHtml('move', 'Move', 'circuit-move-m', 'circuit-move-s', clockText.mm, clockText.ms) +
      '<div class="circuit-phase rounds"><label for="circuit-rounds">Rounds</label>' +
      '<input id="circuit-rounds" type="text" inputmode="numeric" pattern="[0-9]*" value="' + esc(clockText.rounds) + '" autocomplete="off"' + off() + '></div></div>' +
      '<p class="mute" id="circuit-track">Tracking: time per station (automatic)</p></div>';
    h += '<div class="row"><button type="button" class="pri grow" data-act="save"' + (busy ? ' disabled' : '') + '>Save</button>' +
      '<button type="button" class="grow" data-act="cancel"' + (busy ? ' disabled' : '') + '>Cancel</button></div>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = onClick;
    ctx.app.oninput = onInput;
    ctx.app.onkeydown = onKey;
    var grid = document.getElementById('circuit-grid');
    if (grid && root.WBGrid) {
      root.WBGrid.mount(grid, {
        cols: editorCols(draft.stations),
        rows: C.visibleRows(draft.stations),
        label: 'Circuit stations',
        items: (draft.stations || []).map(function (station) {
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
  function onClient(id) {
    if (busy || !draft) return;
    var person = (roster || []).filter(function (item) { return item && String(item.id) === String(id); })[0];
    if (!person) return;
    draft.clients = model().toggleLinked(draft.clients, person);
    formError = [];
    paint();
  }
  function onManualAdd() {
    if (busy || !draft) return;
    var field = document.getElementById('circuit-client-name');
    if (field) manualName = field.value;
    var added = model().addManualClient(draft.clients, manualName);
    if (!added.ok) { formError = [added.error]; paint(); return; }
    draft.clients = added.clients;
    manualName = '';
    manualOpen = false;
    formError = [];
    paint();
  }
  function onManualChip(name) {
    if (busy || !draft) return;
    draft.clients = model().removeManualClient(draft.clients, name);
    paint();
  }
  function onSave() {
    if (!draft || busy || !ctx) return;
    var name = document.getElementById('circuit-name');
    if (name) draft.name = name.value;
    applyClockText();
    var payload = model().toPayload(draft);
    if (!payload.ok) { formError = payload.errors; paint(); return; }
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
        clients: payload.data.clients,
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
  function onClick(e) {
    var button = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!button || button.disabled || busy) return;
    var act = button.getAttribute('data-act');
    if (act === 'new') return ctx.go('#/circuits/new');
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
    if (act === 'client') return onClient(button.getAttribute('data-id'));
    if (act === 'manual-open') { manualOpen = !manualOpen; paint(); return; }
    if (act === 'manual-add') return onManualAdd();
    if (act === 'manual-chip') return onManualChip(button.getAttribute('data-name'));
    if (act === 'save') return onSave();
    if (act === 'cancel') return onCancel();
  }
  function onInput(e) {
    var field = e.target;
    if (busy || !field || !draft) return;
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
    if (field.id === 'circuit-client-name') { manualName = field.value; return; }
  }
  function onKey(e) {
    if (busy || e.key !== 'Enter') return;
    if (e.target && e.target.id === 'circuit-ex-name') { e.preventDefault(); onManualExercise(); }
    if (e.target && e.target.id === 'circuit-client-name') { e.preventDefault(); onManualAdd(); }
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
      rows = Array.isArray(list) ? list : [];
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
    manualOpen = false;
    manualName = '';
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
    var rosterP;
    try {
      circuitP = id ? (root.WBAuth && root.WBAuth.circuits ? root.WBAuth.circuits() : Promise.reject(new Error(unavailable()))) : Promise.resolve([]);
    } catch (e) { circuitP = Promise.reject(e); }
    try {
      rosterP = root.WBAuth && root.WBAuth.roster ? root.WBAuth.roster() : Promise.resolve({ clients: [] });
    } catch (e2) { rosterP = Promise.reject(e2); }
    var rosterSafe = Promise.resolve(rosterP).then(function (res) {
      return { ok: true, body: res };
    }, function () {
      return { ok: false, body: { clients: [] } };
    });
    Promise.all([circuitP, rosterSafe]).then(function (pair) {
      if (token !== loadToken || !ctx) return;
      var list = Array.isArray(pair[0]) ? pair[0] : [];
      roster = (pair[1].body && pair[1].body.clients) || [];
      rosterError = pair[1].ok ? '' : 'Linked clients could not be loaded.';
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
  function mount(next) {
    stop();
    ctx = next || null;
    if (!ctx) return;
    ctx.backBtn.hidden = false;
    if (!root.WBCircuit || !root.WBGrid) {
      ctx.titleEl.textContent = 'Group Circuit Training';
      ctx.app.innerHTML = '<div class="card" id="circuit-wait"><div class="name">Not available yet</div><p class="mute">Group circuits are not available yet.</p></div>';
      return;
    }
    var parts = hashParts();
    if (parts[0] !== 'circuits' || !parts[1]) return loadList();
    if (parts[1] === 'new') return loadEditor('');
    return loadEditor(parts[1]);
  }
  function stop() {
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
    busy = false;
  }
  function back() {
    if (!ctx) return false;
    var parts = hashParts();
    if (parts[0] !== 'circuits' || !parts[1]) return false;
    onCancel();
    return true;
  }

  var api = { mount: mount, stop: stop, back: back };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBCircuits = api;
})(typeof window !== 'undefined' ? window : globalThis);
