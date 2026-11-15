/* Profile name, photo, location, and bio. No network. Browser: window.WBProfile. Node: require. */
(function (root) {
  'use strict';
  var BIO_MAX = 150;
  var NAME_MAX = 80;
  var PHOTO_EDGE = 256;
  var PROMPT = 'To protect your email account from spammers, please enter a name in your profile before proceeding.';
  var EMPTY = 'Fill in the highlighted fields.';

  function clean(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Only a profile loaded with the new columns can force the name window.
  // Older stubs and a database that does not have the columns yet stay usable.
  function needsName(profile) {
    return !!(profile && profile.profileReady === true && !clean(profile.display_name));
  }
  function locationRequired(profile) {
    if (!profile) return false;
    var membership = profile.membership || '';
    if (membership === 'trainer' || membership === 'master_trainer') return true;
    if (membership === 'free_client' || membership === 'enthusiast') return false;
    return profile.intended_plan === 'trainer' || profile.intended_plan === 'master_trainer';
  }
  // A name is any non-empty text, including a nickname. Nothing else is checked.
  function validate(input) {
    input = input || {};
    var name = clean(input.display_name);
    var city = clean(input.city);
    var state = clean(input.state);
    var online = !!input.online_only;
    var bio = String(input.bio == null ? '' : input.bio);
    if (bio.length > BIO_MAX) bio = bio.slice(0, BIO_MAX);
    bio = clean(bio);
    if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX);
    var empty = {};
    if (!name) empty.name = true;
    if (locationRequired(input) && !online) {
      if (!city) empty.city = true;
      if (!state) empty.state = true;
    }
    var ok = !empty.name && !empty.city && !empty.state;
    return {
      ok: ok,
      empty: empty,
      message: ok ? '' : EMPTY,
      fields: {
        display_name: name || null,
        city: city || null,
        state: state || null,
        online_only: online,
        bio: bio || null
      }
    };
  }
  // Person records use name. Workout records use a different helper so a
  // workout title is not shown as a person's name.
  function label(row) {
    if (!row || typeof row !== 'object') return '';
    var name = clean(row.display_name || row.trainerName || row.name || '');
    if (name) return name;
    return clean(row.email || row.trainerEmail || '');
  }
  function fromTrainer(workout) {
    if (!workout) return '';
    var name = clean(workout.sourceTrainerName || '');
    if (name) return name;
    return clean(workout.sourceTrainerEmail || '');
  }
  function personIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.4" fill="currentColor"></circle><path fill="currentColor" d="M4.8 19.2c.8-3.2 3.3-4.8 7.2-4.8s6.4 1.6 7.2 4.8c.2.6-.3 1.1-.9 1.1H5.7c-.6 0-1.1-.5-.9-1.1z"></path></svg>';
  }
  function sheetHtml(opts) {
    opts = opts || {};
    var bio = String(opts.bio || '');
    if (bio.length > BIO_MAX) bio = bio.slice(0, BIO_MAX);
    var h = '<div class="pv-sheet" id="profile-sheet" data-required="' + (opts.required ? '1' : '0') + '">';
    h += '<div class="pv-sheet-card" role="dialog" aria-modal="true" aria-labelledby="profile-title">';
    if (opts.required) h += '<p class="profile-note" id="profile-prompt">' + esc(PROMPT) + '</p>';
    h += '<div class="profile-scroll">';
    h += '<h3 class="name" id="profile-title">Profile</h3>';
    if (opts.unavailable) h += '<p class="errs" id="profile-unavailable">Profile details are not available yet. Apply the profile SQL in the Supabase SQL editor.</p>';
    h += '<div class="avatar" id="profile-photo" aria-hidden="true">' + (opts.photoUrl ? '<img alt="" src="' + esc(opts.photoUrl) + '">' : personIcon()) + '</div>';
    h += '<label class="file-btn">Upload photo<input id="profile-file" type="file" accept="image/*"></label>';
    h += '<label for="profile-name">Name</label><input id="profile-name" maxlength="' + NAME_MAX + '" autocomplete="nickname" value="' + esc(opts.display_name || '') + '">';
    h += '<div class="loc-row"><div class="field"><label for="profile-city">City</label><input id="profile-city" maxlength="80" autocomplete="address-level2" value="' + esc(opts.city || '') + '"></div>';
    h += '<div class="field"><label for="profile-state">State</label><input id="profile-state" maxlength="80" autocomplete="address-level1" value="' + esc(opts.state || '') + '"></div>';
    h += '<label class="checkline"><input id="profile-online" class="tick" type="checkbox"' + (opts.online_only ? ' checked' : '') + '>Online only</label></div>';
    h += '<label for="profile-bio">Bio</label><textarea id="profile-bio" maxlength="' + BIO_MAX + '" rows="3" placeholder="Specialties, service areas, certifications">' + esc(bio) + '</textarea>';
    h += '<p class="mute bio-count" id="profile-count">' + bio.length + '/' + BIO_MAX + '</p>';
    h += '<p class="errs" id="profile-error" hidden>Fill in the highlighted fields.</p>';
    h += '<button type="button" class="pri" id="profile-save"' + (opts.unavailable ? ' disabled' : '') + '>Save</button>';
    if (!opts.required) h += '<button type="button" id="profile-cancel">Cancel</button>';
    h += '</div></div></div>';
    return h;
  }
  function preparePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || String(file.type).indexOf('image/') !== 0) {
        reject(new Error('Choose a photo.'));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) {
          URL.revokeObjectURL(url);
          reject(new Error('Could not read that photo.'));
          return;
        }
        var scale = Math.min(1, PHOTO_EDGE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) {
            reject(new Error('Could not prepare that photo.'));
            return;
          }
          resolve(blob);
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read that photo.'));
      };
      img.src = url;
    });
  }
  function fillAvatars(scope) {
    var auth = root.WBAuth;
    if (!scope || !scope.querySelectorAll || !auth || !auth.avatarUrl) return;
    var nodes = scope.querySelectorAll('[data-avatar-path]');
    Array.prototype.forEach.call(nodes, function (node) {
      var path = node.getAttribute('data-avatar-path') || '';
      if (!path) return;
      Promise.resolve().then(function () { return auth.avatarUrl(path); }).then(function (url) {
        if (!url || !node.isConnected) return;
        node.classList.add('has-photo');
        node.innerHTML = '<img alt="" src="' + esc(url) + '">';
      }, function () {});
    });
  }

  var api = {
    BIO_MAX: BIO_MAX,
    NAME_MAX: NAME_MAX,
    PHOTO_EDGE: PHOTO_EDGE,
    PROMPT: PROMPT,
    EMPTY: EMPTY,
    needsName: needsName,
    locationRequired: locationRequired,
    validate: validate,
    label: label,
    fromTrainer: fromTrainer,
    personIcon: personIcon,
    sheetHtml: sheetHtml,
    preparePhoto: preparePhoto,
    fillAvatars: fillAvatars
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBProfile = api;
})(typeof window !== 'undefined' ? window : global);
