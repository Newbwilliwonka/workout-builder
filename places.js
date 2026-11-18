/* Place search for the service pin and Near me. Leaflet + OpenStreetMap.
   Nominatim is queried on submit or after the pin stops moving, at most once
   a second. No key. Browser: window.WBPlaces. Node: require. */
(function (root) {
  'use strict';

  var NOMINATIM = 'https://nominatim.openstreetmap.org';
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var MIN_GAP = 1100;
  var REVERSE_WAIT = 1000;
  var PRIVACY_NOTE = 'Your exact pin is private. It is only used so clients can find you in the Trainer Hub search. Only your city and state are shown publicly.';
  var NEAR_NOTE = 'Your location is used only for this search and is not saved.';
  var ATTR = 'Maps and place names © OpenStreetMap contributors';

  var tail = Promise.resolve();
  var lastStart = 0;
  var pinToken = 0;
  var profileMap = null;
  var reverseTimer = null;

  function clean(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
  }
  function finite(n) {
    return typeof n === 'number' && isFinite(n);
  }
  function placeFromAddress(address) {
    address = address || {};
    var city = clean(address.city || address.town || address.village || address.hamlet || address.municipality || address.city_district);
    var region = clean(address.state || address.region || address.state_district || address.province || address.county);
    var country = clean(address.country);
    return { city: city, region: region, country: country, ok: !!(city && region && country) };
  }
  function publicLabel(city, region) {
    var c = clean(city);
    var r = clean(region);
    if (c && r) return c + ', ' + r;
    return c || r;
  }
  // First call can go out immediately. The next waits so we stay under
  // Nominatim's one-request-per-second limit.
  function gate() {
    var job = tail.then(function () {
      var wait = Math.max(0, lastStart + MIN_GAP - Date.now());
      return new Promise(function (resolve) {
        setTimeout(function () {
          lastStart = Date.now();
          resolve();
        }, wait);
      });
    });
    tail = job.then(function () { return null; }, function () { return null; });
    return job;
  }
  function nominatim(path) {
    var fetchFn = root.fetch;
    if (!fetchFn) return Promise.reject(new Error('Place search is not available.'));
    return gate().then(function () {
      return fetchFn(NOMINATIM + path, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Accept-Language': 'en' }
      });
    }).then(function (res) {
      if (!res || !res.ok) throw new Error('Place search is busy. Try again in a moment.');
      return res.json();
    });
  }
  function readHit(hit) {
    if (!hit) throw new Error('No place found. Try a city or address.');
    var lat = Number(hit.lat);
    var lng = Number(hit.lon);
    if (!finite(lat) || !finite(lng)) throw new Error('No place found. Try a city or address.');
    var place = placeFromAddress(hit.address);
    return {
      latitude: lat,
      longitude: lng,
      city: place.city,
      region: place.region,
      country: place.country,
      ok: place.ok
    };
  }
  function searchPlace(query) {
    var q = clean(query);
    if (q.length < 2) return Promise.reject(new Error('Enter a city or address.'));
    var path = '/search?format=jsonv2&addressdetails=1&limit=1&q=' + encodeURIComponent(q);
    return nominatim(path).then(function (rows) {
      if (rows && rows.error) throw new Error('No place found. Try a city or address.');
      return readHit(rows && rows[0]);
    });
  }
  function reversePlace(lat, lng) {
    if (!finite(Number(lat)) || !finite(Number(lng))) {
      return Promise.reject(new Error('Drop a pin on the map.'));
    }
    var path = '/reverse?format=jsonv2&addressdetails=1&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
    return nominatim(path).then(function (hit) {
      if (hit && hit.error) throw new Error('That spot has no city and state. Try another.');
      return readHit(hit);
    });
  }
  function cancelReverse() {
    if (reverseTimer) {
      clearTimeout(reverseTimer);
      reverseTimer = null;
    }
  }
  function scheduleReverse(token, lat, lng) {
    cancelReverse();
    return new Promise(function (resolve, reject) {
      reverseTimer = setTimeout(function () {
        reverseTimer = null;
        if (token !== pinToken) return;
        reversePlace(lat, lng).then(resolve, reject);
      }, REVERSE_WAIT);
    });
  }
  function destroyProfilePin() {
    pinToken += 1;
    cancelReverse();
    if (profileMap) {
      try { profileMap.remove(); } catch (e) {}
      profileMap = null;
    }
  }
  function bindProfilePin() {
    destroyProfilePin();
    var token = pinToken;
    var mapEl = root.document && root.document.getElementById('pin-map');
    var form = root.document && root.document.getElementById('pin-search');
    if (!mapEl) return;
    var L = root.L;
    var draft = null;
    var marker = null;
    var touched = false;

    function el(id) { return root.document.getElementById(id); }
    function setPublic(city, region, status) {
      var node = el('pin-public');
      if (!node) return;
      if (status) {
        node.textContent = status;
        return;
      }
      var label = publicLabel(city, region);
      node.textContent = label ? ('Public location: ' + label) : 'No pin yet. Search or tap the map.';
    }
    function setError(msg) {
      var node = el('pin-error');
      if (!node) return;
      if (!msg) {
        node.hidden = true;
        node.textContent = '';
        return;
      }
      node.hidden = false;
      node.textContent = msg;
    }
    function setSaveEnabled(on) {
      var button = el('pin-save');
      if (button) button.disabled = !on;
    }
    function setRemoveVisible(on) {
      var button = el('pin-remove');
      if (!button) return;
      button.hidden = !on;
    }
    if (!L || !L.map) {
      setError('The map could not load.');
      return;
    }
    var map = L.map(mapEl, { scrollWheelZoom: false, attributionControl: true }).setView([39.8, -98.6], 4);
    profileMap = map;
    L.tileLayer(TILES, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    function showMarker(lat, lng, zoom) {
      if (!profileMap) return;
      if (!marker) {
        marker = L.circleMarker([lat, lng], {
          radius: 9,
          color: '#1e3a8a',
          weight: 2,
          fillColor: '#2563eb',
          fillOpacity: 1
        }).addTo(profileMap);
      } else {
        marker.setLatLng([lat, lng]);
      }
      if (zoom) profileMap.setView([lat, lng], zoom);
      else profileMap.panTo([lat, lng]);
    }
    function applyHit(hit, zoom) {
      draft = {
        latitude: hit.latitude,
        longitude: hit.longitude,
        city: hit.city,
        region: hit.region,
        country: hit.country
      };
      showMarker(hit.latitude, hit.longitude, zoom || 0);
      if (!hit.ok) {
        setPublic('', '', '');
        setSaveEnabled(false);
        setError('That spot has no city and state. Try another.');
        return;
      }
      setPublic(hit.city, hit.region, '');
      setError('');
      setSaveEnabled(true);
    }

    map.on('click', function (e) {
      if (!e || !e.latlng || token !== pinToken) return;
      touched = true;
      var lat = e.latlng.lat;
      var lng = e.latlng.lng;
      showMarker(lat, lng, 0);
      setSaveEnabled(false);
      setError('');
      setPublic('', '', 'Finding city and state…');
      scheduleReverse(token, lat, lng).then(function (hit) {
        if (token !== pinToken) return;
        applyHit(hit, 0);
      }, function (err) {
        if (token !== pinToken) return;
        setSaveEnabled(false);
        setError((err && err.message) || 'Could not find a city and state for that pin.');
      });
    });

    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      touched = true;
      cancelReverse();
      var input = el('pin-query');
      var button = el('pin-go');
      if (!input || token !== pinToken) return;
      if (button) button.disabled = true;
      setError('');
      searchPlace(input.value).then(function (hit) {
        if (token !== pinToken) return null;
        if (hit.ok) {
          applyHit(hit, 13);
          return null;
        }
        return reversePlace(hit.latitude, hit.longitude);
      }).then(function (again) {
        if (token !== pinToken) return;
        if (button) button.disabled = false;
        if (again) applyHit(again, 13);
      }, function (err) {
        if (token !== pinToken) return;
        if (button) button.disabled = false;
        setError((err && err.message) || 'No place found. Try a city or address.');
      });
    });

    var saveBtn = el('pin-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      if (!draft || !draft.city || !draft.region || !draft.country || token !== pinToken) return;
      var auth = root.WBAuth;
      if (!auth || !auth.saveServiceLocation) {
        setError('Service location is not available yet. Apply the near-me SQL in the Supabase SQL editor.');
        return;
      }
      saveBtn.disabled = true;
      auth.saveServiceLocation(draft).then(function (row) {
        if (token !== pinToken) return;
        if (row && row.city) {
          draft.city = row.city;
          draft.region = row.region || draft.region;
          draft.country = row.country || draft.country;
          setPublic(draft.city, draft.region, '');
        }
        setRemoveVisible(true);
        setSaveEnabled(false);
        setError('');
      }, function (err) {
        if (token !== pinToken) return;
        setSaveEnabled(true);
        setError((err && err.message) || 'Could not save that pin.');
      });
    });

    var removeBtn = el('pin-remove');
    if (removeBtn) removeBtn.addEventListener('click', function () {
      var auth = root.WBAuth;
      if (!auth || !auth.removeServiceLocation) {
        setError('Service location is not available yet. Apply the near-me SQL in the Supabase SQL editor.');
        return;
      }
      removeBtn.disabled = true;
      auth.removeServiceLocation().then(function () {
        if (token !== pinToken) return;
        draft = null;
        if (marker && profileMap) {
          profileMap.removeLayer(marker);
          marker = null;
        }
        setRemoveVisible(false);
        setSaveEnabled(false);
        setPublic('', '', '');
        setError('');
        removeBtn.disabled = false;
      }, function (err) {
        if (token !== pinToken) return;
        removeBtn.disabled = false;
        setError((err && err.message) || 'Could not remove that pin.');
      });
    });

    setTimeout(function () {
      if (profileMap && token === pinToken) profileMap.invalidateSize();
    }, 60);

    var auth = root.WBAuth;
    if (!auth || !auth.myServiceLocations) return;
    auth.myServiceLocations().then(function (rows) {
      if (token !== pinToken || touched) return;
      var list = Array.isArray(rows) ? rows : [];
      var pin = null;
      list.forEach(function (row) {
        if (!row) return;
        if (!pin || Number(row.slot || 1) < Number(pin.slot || 1)) pin = row;
      });
      if (!pin) return;
      var lat = Number(pin.latitude);
      var lng = Number(pin.longitude);
      if (!finite(lat) || !finite(lng)) return;
      draft = {
        latitude: lat,
        longitude: lng,
        city: clean(pin.city),
        region: clean(pin.region || pin.state),
        country: clean(pin.country)
      };
      showMarker(lat, lng, 12);
      setPublic(draft.city, draft.region, '');
      setRemoveVisible(true);
      setSaveEnabled(false);
      setTimeout(function () {
        if (profileMap && token === pinToken) profileMap.invalidateSize();
      }, 60);
    }, function (err) {
      if (token !== pinToken) return;
      var msg = (err && err.message) || '';
      if (/not available yet/i.test(msg)) {
        setError('Service location is not available yet. Apply the near-me SQL in the Supabase SQL editor.');
      }
    });
  }

  var api = {
    MIN_GAP: MIN_GAP,
    REVERSE_WAIT: REVERSE_WAIT,
    PRIVACY_NOTE: PRIVACY_NOTE,
    NEAR_NOTE: NEAR_NOTE,
    ATTR: ATTR,
    NOMINATIM: NOMINATIM,
    TILES: TILES,
    placeFromAddress: placeFromAddress,
    publicLabel: publicLabel,
    searchPlace: searchPlace,
    reversePlace: reversePlace,
    bindProfilePin: bindProfilePin,
    destroyProfilePin: destroyProfilePin
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBPlaces = api;
})(typeof window !== 'undefined' ? window : globalThis);
