/* Shared snap grid. Stations, and later cone drills, drag on the same cells.
   Pointer drag matches the calendar: 8px before a drag starts, pointer capture,
   a ghost, and elementFromPoint to find the cell underneath.
   touch-action: none belongs on the tiles only, so the page can still scroll. */
(function (root) {
  'use strict';

  var DRAG_PX = 8;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function unmount(host) {
    if (!host || !host._wbGrid) return;
    var state = host._wbGrid;
    host.removeEventListener('pointerdown', state.down);
    host.removeEventListener('keydown', state.key);
    if (state.move) document.removeEventListener('pointermove', state.move);
    if (state.finish) {
      document.removeEventListener('pointerup', state.finish);
      document.removeEventListener('pointercancel', state.finish);
    }
    if (state.ghost && state.ghost.parentNode) state.ghost.parentNode.removeChild(state.ghost);
    host._wbGrid = null;
  }
  function render(options) {
    var cols = options.cols || 4;
    var rows = options.rows || 6;
    var byPos = {};
    (options.items || []).forEach(function (item) {
      if (!item) return;
      byPos[item.col + ',' + item.row] = item;
    });
    var h = '<div class="wb-grid" role="grid" aria-label="' + esc(options.label || 'Grid') + '" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">';
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var item = byPos[c + ',' + r];
        h += '<div class="wb-cell" role="gridcell" data-col="' + c + '" data-row="' + r + '">';
        if (item) {
          h += '<div class="wb-tile" tabindex="0" data-grid-id="' + esc(item.id) + '" data-label="' + esc(item.label || '') + '">';
          h += item.html || '';
          h += '</div>';
        }
        h += '</div>';
      }
    }
    return h + '</div>';
  }
  function cellUnder(ev, ghost) {
    if (ghost) ghost.style.display = 'none';
    var under = document.elementFromPoint(ev.clientX, ev.clientY);
    if (ghost) ghost.style.display = '';
    if (!under || !under.closest) return null;
    return under.closest('.wb-cell');
  }
  function clearOver(host) {
    var marked = host.querySelectorAll('.wb-over');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('wb-over');
  }
  function mount(host, options) {
    if (!host) return;
    unmount(host);
    options = options || {};
    host.innerHTML = render(options);
    var state = { move: null, finish: null, ghost: null };
    function endGesture() {
      if (state.move) document.removeEventListener('pointermove', state.move);
      if (state.finish) {
        document.removeEventListener('pointerup', state.finish);
        document.removeEventListener('pointercancel', state.finish);
      }
      state.move = null;
      state.finish = null;
      if (state.ghost && state.ghost.parentNode) state.ghost.parentNode.removeChild(state.ghost);
      state.ghost = null;
      clearOver(host);
      var dragging = host.querySelector('.wb-dragging');
      if (dragging) dragging.classList.remove('wb-dragging');
    }
    function down(e) {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, a, input, select, textarea, label')) return;
      var tile = e.target.closest ? e.target.closest('.wb-tile') : null;
      if (!tile || !host.contains(tile)) return;
      if (state.move) return;
      var id = tile.getAttribute('data-grid-id');
      var pointerId = e.pointerId;
      var startX = e.clientX;
      var startY = e.clientY;
      var origin = tile.closest('.wb-cell');
      var startCol = origin ? Number(origin.getAttribute('data-col')) : -1;
      var startRow = origin ? Number(origin.getAttribute('data-row')) : -1;
      var live = false;
      function move(ev) {
        if (ev.pointerId !== pointerId || !state.move) return;
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (!live) {
          if (Math.abs(dx) + Math.abs(dy) < DRAG_PX) return;
          live = true;
          tile.classList.add('wb-dragging');
          var ghost = document.createElement('div');
          ghost.className = 'wb-ghost';
          ghost.textContent = tile.getAttribute('data-label') || 'Item';
          document.body.appendChild(ghost);
          state.ghost = ghost;
          try { tile.setPointerCapture(pointerId); } catch (err) {}
        }
        ev.preventDefault();
        state.ghost.style.left = (ev.clientX + 10) + 'px';
        state.ghost.style.top = (ev.clientY + 12) + 'px';
        clearOver(host);
        var cell = cellUnder(ev, state.ghost);
        if (!cell || !host.contains(cell)) return;
        var other = cell.querySelector('.wb-tile');
        if (other && other.getAttribute('data-grid-id') !== id) return;
        cell.classList.add('wb-over');
      }
      function finish(ev) {
        var moved = live;
        var cell = moved ? cellUnder(ev, state.ghost) : null;
        endGesture();
        if (!moved) {
          if (options.onTap) options.onTap(id);
          return;
        }
        function eatClick(click) {
          click.preventDefault();
          click.stopPropagation();
          document.removeEventListener('click', eatClick, true);
        }
        document.addEventListener('click', eatClick, true);
        setTimeout(function () { document.removeEventListener('click', eatClick, true); }, 0);
        if (!cell || !host.contains(cell) || !options.onMove) return;
        var other = cell.querySelector('.wb-tile');
        if (other && other.getAttribute('data-grid-id') !== id) return;
        var col = Number(cell.getAttribute('data-col'));
        var row = Number(cell.getAttribute('data-row'));
        if (col === startCol && row === startRow) return;
        options.onMove(id, col, row);
      }
      state.move = move;
      state.finish = finish;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    }
    function key(e) {
      var tile = e.target && e.target.closest ? e.target.closest('.wb-tile') : null;
      if (!tile || !host.contains(tile) || e.target !== tile) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (options.onTap) options.onTap(tile.getAttribute('data-grid-id'));
    }
    state.down = down;
    state.key = key;
    host._wbGrid = state;
    host.addEventListener('pointerdown', down);
    host.addEventListener('keydown', key);
  }

  var api = { DRAG_PX: DRAG_PX, mount: mount, unmount: unmount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBGrid = api;
})(typeof window !== 'undefined' ? window : globalThis);
