/* Photos the user adds for their own exercises. Stored in this browser only. */
(function (root) {
  'use strict';
  var DB_NAME = 'wb.exercise-images';
  var STORE = 'images';
  var cache = {};

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('Photos are not available in this browser')); return; }
      var req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open photo storage')); };
    });
  }
  function put(key, blob) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('Could not save the photo')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('Could not save the photo')); };
      });
    });
  }
  function get(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error || new Error('Could not read the photo')); };
      });
    });
  }
  function remove(key) {
    if (!key) return Promise.resolve();
    if (cache[key]) {
      try { root.URL.revokeObjectURL(cache[key]); } catch (e) {}
      delete cache[key];
    }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('Could not remove the photo')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('Could not remove the photo')); };
      });
    }).catch(function () {});
  }
  function peek(key) { return key && cache[key] ? cache[key] : ''; }
  function url(key) {
    if (!key) return Promise.resolve('');
    if (cache[key]) return Promise.resolve(cache[key]);
    return get(key).then(function (blob) {
      if (!blob) return '';
      var u = root.URL.createObjectURL(blob);
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

  var api = { DB_NAME: DB_NAME, put: put, get: get, remove: remove, peek: peek, url: url, bind: bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WBMedia = api;
})(typeof window !== 'undefined' ? window : this);
