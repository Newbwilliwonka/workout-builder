/* Profile name, photo, location, and bio. No network. Browser: window.WBProfile. Node: require. */
(function (root) {
  'use strict';
  var BIO_MAX = 150;
  var NAME_MAX = 80;
  var PHOTO_EDGE = 256;
  var ADMIN_EMAIL = 'kinisiathletics@gmail.com';
  var CERT_BODY_MAX = 120;
  var CERT_NUMBER_MAX = 80;
  var NOTE_MAX = 280;
  var SERVICES = { in_person: 'In person', online: 'Online', both: 'Both' };
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
  function canListInSearch(profile) {
    if (!profile) return false;
    return profile.membership === 'trainer' || profile.membership === 'master_trainer';
  }
  function canFindTrainers(profile) {
    if (!profile || canListInSearch(profile)) return false;
    var intended = profile.intended_plan || profile.intendedPlan || '';
    if (intended === 'trainer' || intended === 'master_trainer') return false;
    var membership = profile.membership || '';
    if (membership === 'trainer' || membership === 'master_trainer') return false;
    return membership === 'free_client' || membership === 'enthusiast'
      || intended === 'enthusiast' || intended === 'free_client';
  }
  function serviceType(value) {
    var key = clean(value);
    return SERVICES[key] ? key : '';
  }
  function serviceLabel(value) {
    return SERVICES[serviceType(value)] || '';
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
    var listed = !!input.listed;
    var service = serviceType(input.service_type != null ? input.service_type : input.serviceType);
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
    if (canListInSearch(input) && listed && !service) empty.service = true;
    var ok = !empty.name && !empty.city && !empty.state && !empty.service;
    var message = '';
    if (!ok) message = empty.service && !empty.name && !empty.city && !empty.state
      ? 'Choose in person, online, or both.'
      : EMPTY;
    return {
      ok: ok,
      empty: empty,
      message: message,
      fields: {
        display_name: name || null,
        city: city || null,
        state: state || null,
        online_only: online,
        bio: bio || null,
        listed: canListInSearch(input) ? listed : false,
        service_type: canListInSearch(input) ? (service || null) : null
      }
    };
  }
  // An address, or a display string that is an address. The part before @
  // is still the address, so it is not a name either.
  function isEmailAddress(value) {
    return clean(value).indexOf('@') !== -1;
  }
  function safeName(value) {
    var name = clean(value);
    if (!name || isEmailAddress(name)) return '';
    return name;
  }
  // Client, Trainer, or Enthusiast. Used only when there is no display name.
  function roleLabel(row) {
    if (!row || typeof row !== 'object') return '';
    var blob = [
      row.plan,
      row.membership,
      row.intended_plan,
      row.intendedPlan
    ].map(function (part) { return clean(part).toLowerCase(); }).join(' ');
    if (blob.indexOf('enthusiast') !== -1) return 'Enthusiast';
    if (blob.indexOf('trainer') !== -1) return 'Trainer';
    if (blob.indexOf('client') !== -1) return 'Client';
    return '';
  }
  // Another person's label. Display name when they have one. Otherwise the
  // role. Never their email, and never the part before @.
  function label(row) {
    if (!row || typeof row !== 'object') return '';
    var name = safeName(row.display_name) || safeName(row.trainerName) || safeName(row.name);
    if (name) return name;
    return roleLabel(row);
  }
  function fromTrainer(workout) {
    if (!workout) return '';
    return safeName(workout.sourceTrainerName);
  }
  function personIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.4" fill="currentColor"></circle><path fill="currentColor" d="M4.8 19.2c.8-3.2 3.3-4.8 7.2-4.8s6.4 1.6 7.2 4.8c.2.6-.3 1.1-.9 1.1H5.7c-.6 0-1.1-.5-.9-1.1z"></path></svg>';
  }
  function isAdminEmail(email) {
    return clean(email).toLowerCase() === ADMIN_EMAIL;
  }
  // Calendar date in UTC, matching current_date on the Supabase database.
  function todayISO(now) {
    var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    if (isNaN(d.getTime())) d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function isoDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(value));
    if (!m) return '';
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
    return m[1] + '-' + m[2] + '-' + m[3];
  }
  function formatDay(value) {
    var iso = isoDate(value);
    if (!iso) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4);
  }
  // Verified through the expiration date. The next day the seal is gone.
  function isVerified(until, today) {
    var exp = isoDate(until);
    var day = isoDate(today) || todayISO();
    if (!exp) return false;
    return exp >= day;
  }
  function validateVerification(input, today) {
    input = input || {};
    var body = clean(input.cert_body != null ? input.cert_body : input.body);
    var number = clean(input.cert_number != null ? input.cert_number : input.number);
    var expRaw = clean(input.expires_on != null ? input.expires_on : input.expiresOn);
    var exp = isoDate(expRaw);
    var day = isoDate(today) || todayISO();
    var empty = {};
    var message = '';
    if (!body) empty.body = true;
    if (!number) empty.number = true;
    if (body.length > CERT_BODY_MAX) empty.body = true;
    if (number.length > CERT_NUMBER_MAX) empty.number = true;
    if (!expRaw || !exp) empty.expires = true;
    var future = !!(exp && !(exp > day));
    if (future) empty.expires = true;
    var tooLong = body.length > CERT_BODY_MAX || number.length > CERT_NUMBER_MAX;
    var missing = (!body || !number || !expRaw || !exp) && !tooLong && !future;
    if (tooLong) message = 'Certification details are too long.';
    else if (future && body && number) message = 'Expiration date must be in the future.';
    else if (!missing && future) message = 'Expiration date must be in the future.';
    else if (empty.body || empty.number || empty.expires) message = 'Fill in the highlighted fields.';
    var ok = !empty.body && !empty.number && !empty.expires;
    return {
      ok: ok,
      empty: empty,
      message: ok ? '' : message,
      fields: {
        cert_body: body,
        cert_number: number,
        expires_on: exp || expRaw
      }
    };
  }
  function validateDecline(note) {
    var text = clean(note);
    if (!text) return { ok: false, note: '', message: 'Enter a note.' };
    if (text.length > NOTE_MAX) return { ok: false, note: text, message: 'Keep the note short.' };
    return { ok: true, note: text, message: '' };
  }
  function requestStamp(row) {
    return String((row && (row.created_at || row.createdAt)) || '');
  }
  function verificationView(input) {
    input = input || {};
    var show = input.membership === 'master_trainer';
    var today = isoDate(input.today) || todayISO();
    var verified = !!(show && isVerified(input.verifiedUntil != null ? input.verifiedUntil : input.verified_until, today));
    var requests = Array.isArray(input.requests) ? input.requests : [];
    var pending = false;
    var newest = null;
    requests.forEach(function (row) {
      if (!row) return;
      if (row.status === 'pending') pending = true;
      if (!newest || requestStamp(row) >= requestStamp(newest)) newest = row;
    });
    if (!show) return { show: false, verified: false, mode: 'hidden', note: '', link: false };
    if (verified) {
      return {
        show: true,
        verified: true,
        mode: 'verified',
        note: '',
        link: false,
        ends: isoDate(input.verifiedUntil != null ? input.verifiedUntil : input.verified_until)
      };
    }
    if (pending) return { show: true, verified: false, mode: 'pending', note: '', link: false };
    var note = newest && newest.status === 'declined' ? clean(newest.admin_note || newest.adminNote || '') : '';
    if (note) return { show: true, verified: false, mode: 'declined', note: note, link: true };
    return { show: true, verified: false, mode: 'open', note: '', link: true };
  }
  // 12-point certificate starburst. 1em so it matches the name font.
  var SEAL_POINTS = '12.00,1.00 14.17,3.89 17.50,2.47 17.94,6.06 21.53,6.50 20.11,9.83 23.00,12.00 20.11,14.17 21.53,17.50 17.94,17.94 17.50,21.53 14.17,20.11 12.00,23.00 9.83,20.11 6.50,21.53 6.06,17.94 2.47,17.50 3.89,14.17 1.00,12.00 3.89,9.83 2.47,6.50 6.06,6.06 6.50,2.47 9.83,3.89';
  function sealHtml() {
    return '<svg class="seal" viewBox="0 0 24 24" width="1em" height="1em" role="img" aria-label="Verified" focusable="false">' +
      '<polygon fill="#E2A20C" points="' + SEAL_POINTS + '"></polygon>' +
      '<circle cx="12" cy="12" r="5.5" fill="#F6C445"></circle>' +
      '<path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M8.85 12.2l2.05 2.1 4.25-4.55"></path>' +
      '</svg>';
  }
  function nameHtml(name, verified) {
    var text = esc(name == null ? '' : name);
    if (!verified) return text;
    return '<span class="person-name"><span class="nm">' + text + '</span>' + sealHtml() + '</span>';
  }
  function fromTrainerHtml(workout) {
    var name = fromTrainer(workout) || 'Trainer';
    return nameHtml(name, !!(workout && workout.sourceTrainerVerified));
  }
  function verifyAreaHtml(view) {
    view = view || {};
    if (!view.show || view.mode === 'hidden') return '';
    if (view.mode === 'verified') {
      var ends = formatDay(view.ends);
      if (!ends) return '';
      return '<p class="verify-status" id="verify-ends">Verification ends ' + esc(ends) + '</p>';
    }
    if (view.mode === 'pending') return '<p class="verify-status" id="verify-status">Pending review</p>';
    var h = '<div id="verify-area">';
    if (view.note) h += '<p class="verify-note" id="verify-note">' + esc(view.note) + '</p>';
    if (view.unavailable) {
      h += '<p class="mute" id="verify-wait">' + esc(view.unavailable) + '</p></div>';
      return h;
    }
    if (view.link) {
      h += '<button type="button" class="verify-link" id="verify-open">Get verified</button>';
      h += '<form id="verify-form" hidden>';
      h += '<label for="verify-body">Certifying organization</label><input id="verify-body" maxlength="' + CERT_BODY_MAX + '" autocomplete="off" required>';
      h += '<label for="verify-number">Certification number</label><input id="verify-number" maxlength="' + CERT_NUMBER_MAX + '" autocomplete="off" required>';
      h += '<label for="verify-expires">Expiration date</label><input id="verify-expires" type="date" required>';
      h += '<p class="errs" id="verify-error" hidden>Fill in the highlighted fields.</p>';
      h += '<button type="button" class="pri" id="verify-submit">Submit</button>';
      h += '</form>';
    }
    h += '</div>';
    return h;
  }
  function sheetHtml(opts) {
    opts = opts || {};
    var bio = String(opts.bio || '');
    if (bio.length > BIO_MAX) bio = bio.slice(0, BIO_MAX);
    var h = '<div class="pv-sheet" id="profile-sheet" data-required="' + (opts.required ? '1' : '0') + '">';
    h += '<div class="pv-sheet-card" role="dialog" aria-modal="true" aria-labelledby="profile-title">';
    if (opts.required) h += '<p class="profile-note" id="profile-prompt">' + esc(PROMPT) + '</p>';
    h += '<div class="profile-scroll">';
    if (opts.verified && clean(opts.display_name)) h += '<h3 class="name" id="profile-title">' + nameHtml(opts.display_name, true) + '</h3>';
    else h += '<h3 class="name" id="profile-title">Profile</h3>';
    if (opts.unavailable) h += '<p class="errs" id="profile-unavailable">Profile details are not available yet. Apply the profile SQL in the Supabase SQL editor.</p>';
    h += '<div class="avatar" id="profile-photo" aria-hidden="true">' + (opts.photoUrl ? '<img alt="" src="' + esc(opts.photoUrl) + '">' : personIcon()) + '</div>';
    h += '<label class="file-btn">Upload photo<input id="profile-file" type="file" accept="image/*"></label>';
    h += '<label for="profile-name">Name</label><input id="profile-name" maxlength="' + NAME_MAX + '" autocomplete="nickname" value="' + esc(opts.display_name || '') + '">';
    h += '<div class="loc-row"><div class="field"><label for="profile-city">City</label><input id="profile-city" maxlength="80" autocomplete="address-level2" value="' + esc(opts.city || '') + '"></div>';
    h += '<div class="field"><label for="profile-state">State</label><input id="profile-state" maxlength="80" autocomplete="address-level1" value="' + esc(opts.state || '') + '"></div>';
    h += '<label class="checkline"><input id="profile-online" class="tick" type="checkbox"' + (opts.online_only ? ' checked' : '') + '>Online only</label></div>';
    if (opts.canList) {
      var listedOn = !!opts.listed;
      var selected = serviceType(opts.service_type != null ? opts.service_type : opts.serviceType);
      h += '<div class="switch-row" id="profile-listing">';
      h += '<button type="button" class="switch' + (listedOn ? ' on' : '') + '" id="profile-listed" role="switch" aria-checked="' + (listedOn ? 'true' : 'false') + '" aria-label="Show me in trainer search"><i></i></button>';
      h += '<div class="grow"><div class="name">Show me in trainer search</div>';
      h += '<p class="mute">Clients and enthusiasts can request to message you.</p></div></div>';
      h += '<label for="profile-service">Service</label><select id="profile-service">';
      h += '<option value=""' + (selected ? '' : ' selected') + '>Choose</option>';
      h += '<option value="in_person"' + (selected === 'in_person' ? ' selected' : '') + '>In person</option>';
      h += '<option value="online"' + (selected === 'online' ? ' selected' : '') + '>Online</option>';
      h += '<option value="both"' + (selected === 'both' ? ' selected' : '') + '>Both</option>';
      h += '</select>';
    }
    h += '<label for="profile-bio">Bio</label><textarea id="profile-bio" maxlength="' + BIO_MAX + '" rows="3" placeholder="Specialties, service areas, certifications">' + esc(bio) + '</textarea>';
    h += '<p class="mute bio-count" id="profile-count">' + bio.length + '/' + BIO_MAX + '</p>';
    if (opts.master) {
      h += '<div id="verify-slot">';
      if (opts.verified) {
        h += verifyAreaHtml({
          show: true,
          mode: 'verified',
          ends: opts.verified_until != null ? opts.verified_until : opts.verifiedUntil
        });
      } else {
        h += '<p class="mute" id="verify-loading">Loading…</p>';
      }
      h += '</div>';
    }
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
    ADMIN_EMAIL: ADMIN_EMAIL,
    CERT_BODY_MAX: CERT_BODY_MAX,
    CERT_NUMBER_MAX: CERT_NUMBER_MAX,
    NOTE_MAX: NOTE_MAX,
    PROMPT: PROMPT,
    EMPTY: EMPTY,
    needsName: needsName,
    canListInSearch: canListInSearch,
    canFindTrainers: canFindTrainers,
    serviceType: serviceType,
    serviceLabel: serviceLabel,
    locationRequired: locationRequired,
    validate: validate,
    isAdminEmail: isAdminEmail,
    todayISO: todayISO,
    isoDate: isoDate,
    formatDay: formatDay,
    isVerified: isVerified,
    validateVerification: validateVerification,
    validateDecline: validateDecline,
    verificationView: verificationView,
    sealHtml: sealHtml,
    nameHtml: nameHtml,
    isEmailAddress: isEmailAddress,
    safeName: safeName,
    roleLabel: roleLabel,
    label: label,
    fromTrainer: fromTrainer,
    fromTrainerHtml: fromTrainerHtml,
    verifyAreaHtml: verifyAreaHtml,
    personIcon: personIcon,
    sheetHtml: sheetHtml,
    preparePhoto: preparePhoto,
    fillAvatars: fillAvatars
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBProfile = api;
})(typeof window !== 'undefined' ? window : global);
