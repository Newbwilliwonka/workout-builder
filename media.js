/* Images the user adds for their own exercises. Stored in this browser only. */
(function (root) {
  'use strict';
  var DB_NAME = 'wb.exercise-images';
  var STORE = 'images';
  var cache = {};
  var generation = {};

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('Images are not available in this browser')); return; }
      var req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open image storage')); };
    });
  }
  // A replaced blob must not keep the previous object URL. That URL would keep showing the old image.
  function forgetUrl(key) {
    generation[key] = (generation[key] || 0) + 1;
    if (!cache[key]) return;
    try { root.URL.revokeObjectURL(cache[key]); } catch (e) {}
    delete cache[key];
  }
  function put(key, blob) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = function () { db.close(); forgetUrl(key); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('Could not save the image')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('Could not save the image')); };
      });
    });
  }
  function get(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error || new Error('Could not read the image')); };
      });
    });
  }
  function remove(key) {
    if (!key) return Promise.resolve();
    forgetUrl(key);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('Could not remove the image')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('Could not remove the image')); };
      });
    }).catch(function () {});
  }
  function copy(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) return Promise.resolve(false);
    return get(fromKey).then(function (blob) {
      if (!blob) return false;
      return put(toKey, blob).then(function () { return true; });
    });
  }
  function peek(key) { return key && cache[key] ? cache[key] : ''; }
  function url(key, attempt) {
    if (!key) return Promise.resolve('');
    if (cache[key]) return Promise.resolve(cache[key]);
    if ((attempt || 0) > 4) return Promise.resolve('');
    var gen = generation[key] || 0;
    return get(key).then(function (blob) {
      if ((generation[key] || 0) !== gen) return url(key, (attempt || 0) + 1);
      if (cache[key]) return cache[key];
      if (!blob) return '';
      var u = root.URL.createObjectURL(blob);
      if ((generation[key] || 0) !== gen || cache[key]) {
        try { root.URL.revokeObjectURL(u); } catch (e) {}
        if ((generation[key] || 0) !== gen) return url(key, (attempt || 0) + 1);
        return cache[key];
      }
      cache[key] = u;
      return u;
    });
  }
  function bind(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    Array.prototype.forEach.call(rootEl.querySelectorAll('img[data-gif]'), function (img) {
      img.addEventListener('error', function () {
        if (!img.parentNode) return;
        var span = document.createElement('span');
        span.className = 'media-note';
        span.textContent = 'Demo didn\u2019t load.';
        img.replaceWith(span);
      });
    });
    Array.prototype.forEach.call(rootEl.querySelectorAll('[data-local-img]'), function (el) {
      var key = el.getAttribute('data-local-img');
      url(key).then(function (u) {
        if (!u || !el.isConnected) return;
        var img = document.createElement('img');
        img.className = 'ex-gif';
        img.alt = '';
        img.src = u;
        el.replaceWith(img);
      }).catch(function () {});
    });
  }

  var api = { DB_NAME: DB_NAME, put: put, get: get, remove: remove, copy: copy, peek: peek, url: url, bind: bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WBMedia = api;
})(typeof window !== 'undefined' ? window : this);
