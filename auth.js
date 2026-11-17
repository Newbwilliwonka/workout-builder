/* Email/password sign-in for the public Supabase project. No service key. */
(function (root) {
  'use strict';
  var URL = 'https://thyrgloermygnezfareg.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_YT4vJriMUtcFRveDBA0GaA_eDiu5_Py';
  var REDIRECT = 'https://coachtrainerapp.com/';
  // Bunny folder that contains 180/ and 360/.
  // A library demo is this value + "/180/" + id + ".gif" (or "/360/"). Not a secret.
  var EXERCISE_GIF_BASE = 'https://kinisiexercises.b-cdn.net';
  var LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
  var client = null, loading = null, authWatchers = [];
  var Mem = root.WBMembership;
  // Snapshot the URL before app.js routing can replace the hash. Recovery links
  // arrive as ?code= (PKCE), #access_token&type=recovery, or token_hash&type=recovery.
  var recoveryEvent = false;
  var arrival = readAuthArrival();

  function loadLib() {
    if (root.supabase && root.supabase.createClient) return Promise.resolve(root.supabase);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB;
      s.onload = function () { root.supabase && root.supabase.createClient ? resolve(root.supabase) : reject(new Error('Sign-in library did not load')); };
      s.onerror = function () { reject(new Error('Could not load sign-in')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function db() {
    return loadLib().then(function (lib) {
      if (!client) {
        client = lib.createClient(URL, PUBLISHABLE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
        });
        // Subscribe before getSession() so a PASSWORD_RECOVERY event fired
        // while the client reads the URL is not missed.
        client.auth.onAuthStateChange(function (event, session) {
          if (event === 'PASSWORD_RECOVERY') recoveryEvent = true;
          authWatchers.slice().forEach(function (fn) {
            try { fn(event, session || null); } catch (e) {}
          });
        });
      }
      return client;
    });
  }
  var PROFILE_FULL = 'id,email,membership,intended_plan,display_name,city,state,online_only,bio,avatar_path';
  var PROFILE_BASE = 'id,email,membership,intended_plan';
  function userOf(session) { return session && session.user ? session.user : null; }
  function profileColumnMissing(err) {
    var msg = String((err && (err.message || err.details || err.hint || err.code)) || '');
    return /display_name|online_only|avatar_path|\b42703\b|PGRST204|schema cache/i.test(msg);
  }
  function withReady(row, ready) {
    if (!row) return row;
    var out = {};
    Object.keys(row).forEach(function (k) { out[k] = row[k]; });
    out.profileReady = !!ready;
    if (!ready) return out;
    out.display_name = out.display_name || null;
    out.city = out.city || null;
    out.state = out.state || null;
    out.online_only = !!out.online_only;
    out.bio = out.bio || null;
    out.avatar_path = out.avatar_path || null;
    if (!Object.prototype.hasOwnProperty.call(out, 'verified_until')) out.verified_until = null;
    return out;
  }
  function withVerified(c, userId, row) {
    if (!row || row.profileReady !== true || !userId) return Promise.resolve(row);
    return c.from('profiles').select('verified_until').eq('id', userId).maybeSingle().then(function (v) {
      row.verified_until = (!v || v.error || !v.data) ? null : (v.data.verified_until || null);
      return row;
    }, function () {
      row.verified_until = null;
      return row;
    });
  }
  function insertProfile(c, user, ready) {
    return c.from('profiles').insert({ id: user.id, email: user.email || null, membership: Mem.NONE }).select(PROFILE_BASE).single().then(function (ins) {
      if (ins.error) throw ins.error;
      if (!ready) return withReady(ins.data, false);
      return c.from('profiles').select(PROFILE_FULL).eq('id', user.id).maybeSingle().then(function (full) {
        if (full.error || !full.data) return withReady(ins.data, false);
        return withReady(full.data, true);
      });
    });
  }
  function ensureProfile(c, user) {
    return c.from('profiles').select(PROFILE_FULL).eq('id', user.id).maybeSingle().then(function (res) {
      if (res.error) {
        if (!profileColumnMissing(res.error)) throw res.error;
        return c.from('profiles').select(PROFILE_BASE).eq('id', user.id).maybeSingle().then(function (again) {
          if (again.error) throw again.error;
          if (again.data) return withReady(again.data, false);
          return insertProfile(c, user, false);
        });
      }
      if (res.data) return withReady(res.data, true);
      return insertProfile(c, user, true);
    });
  }
  function profileSaveError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (profileColumnMissing(err) || /bucket not found|Bucket not found|avatars/i.test(msg)) {
      return new Error('Profile details are not available yet. Apply the profile SQL in the Supabase SQL editor.');
    }
    if (/enter your name/i.test(msg)) return new Error('Enter your name.');
    if (/city and state|online only/i.test(msg)) return new Error('Enter a city and state, or choose Online only.');
    if (/150 characters/i.test(msg)) return new Error('Bio can be at most 150 characters.');
    return new Error(msg || 'Could not save your profile.');
  }

  function decodePart(s) {
    try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); }
    catch (e) { return String(s || ''); }
  }
  function parseAuthParams(s) {
    var out = {};
    var q = String(s || '').replace(/^[?#]/, '');
    if (!q || q.indexOf('=') === -1) return out;
    q.split('&').forEach(function (part) {
      if (!part) return;
      var i = part.indexOf('=');
      var key = decodePart(i < 0 ? part : part.slice(0, i));
      var val = decodePart(i < 0 ? '' : part.slice(i + 1));
      if (key && !out[key]) out[key] = val;
    });
    return out;
  }
  function readAuthArrival() {
    var search = '', hash = '';
    try { search = location.search || ''; hash = location.hash || ''; } catch (e) {}
    var fromSearch = parseAuthParams(search);
    var rawHash = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    var fromHash = rawHash.indexOf('=') === -1 ? {} : parseAuthParams(rawHash);
    function pick(k) { return fromSearch[k] || fromHash[k] || ''; }
    return {
      type: pick('type'),
      code: pick('code'),
      tokenHash: pick('token_hash'),
      accessToken: pick('access_token'),
      refreshToken: pick('refresh_token'),
      error: pick('error'),
      errorCode: pick('error_code'),
      errorDescription: pick('error_description')
    };
  }
  function arrivalKind() {
    // Expired links often arrive as only error/error_code, with no type left.
    // Claim those before a sign-in redirect can erase the hash.
    if (arrival.error || arrival.errorCode || arrival.errorDescription) return 'error';
    if (arrival.type === 'recovery') return 'recovery';
    if (arrival.code) return 'code';
    return '';
  }
  function liveParam(name) {
    var search = '', hash = '';
    try { search = location.search || ''; hash = location.hash || ''; } catch (e) {}
    if (parseAuthParams(search)[name]) return true;
    var raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (raw.indexOf('=') === -1) return false;
    return !!parseAuthParams(raw)[name];
  }
  function invalidRecovery() {
    return { kind: 'invalid', message: 'This reset link is invalid or has expired.' };
  }
  function looksLikeJwt(token) {
    return typeof token === 'string' && token.length > 20 && token.split('.').length === 3;
  }
  // PKCE clients reject implicit hash tokens. A recovery link that still has
  // access_token/refresh_token, or a token_hash from the email template, is
  // exchanged here so routing cannot drop it first.
  function establishRecovery() {
    if (arrival.tokenHash && arrival.type === 'recovery') {
      return db().then(function (c) {
        return c.auth.verifyOtp({ type: 'recovery', token_hash: arrival.tokenHash });
      }).then(function (res) {
        if (res.error || !res.data || !res.data.session) return invalidRecovery();
        recoveryEvent = true;
        return { kind: 'recovery', session: res.data.session };
      }, function () { return invalidRecovery(); });
    }
    if (arrival.type === 'recovery' && looksLikeJwt(arrival.accessToken) && arrival.refreshToken) {
      return db().then(function (c) {
        return c.auth.setSession({ access_token: arrival.accessToken, refresh_token: arrival.refreshToken });
      }).then(function (res) {
        if (res.error || !res.data || !res.data.session) return invalidRecovery();
        recoveryEvent = true;
        return { kind: 'recovery', session: res.data.session };
      }, function () { return invalidRecovery(); });
    }
    return Promise.resolve(invalidRecovery());
  }
  function classifyArrival(session) {
    if (recoveryEvent && session) return { kind: 'recovery', session: session };
    if (arrival.type === 'recovery' && session && !liveParam('code') && !liveParam('access_token')) {
      return { kind: 'recovery', session: session };
    }
    if (arrival.type === 'recovery') return establishRecovery();
    if (arrival.code) {
      if (session && !liveParam('code')) return { kind: 'signed-in', session: session };
      return invalidRecovery();
    }
    if (session) return { kind: 'signed-in', session: session };
    return { kind: 'none' };
  }
  function isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function shareTableMissing(err) {
    var msg = String((err && (err.message || err.code || err.details || err.hint)) || '');
    return /shared_dashboards|42P01|PGRST205|schema cache|does not exist/i.test(msg);
  }
  function layoutTableMissing(err) {
    var msg = String((err && (err.message || err.code || err.details || err.hint)) || '');
    return /dashboard_layouts|42P01|PGRST205|schema cache|does not exist/i.test(msg);
  }
  function layoutList(cards) {
    var allow = (root.WBDashboard && root.WBDashboard.CARDS) || ['plan', 'workouts', 'strength', 'volume', 'records', 'calendar', 'holds', 'stopwatch', 'pass'];
    var seen = {};
    var out = [];
    (cards || []).forEach(function (id) {
      if (allow.indexOf(id) < 0 || seen[id]) return;
      seen[id] = 1;
      out.push(id);
    });
    return out.slice(0, allow.length);
  }
  var TRACK_SET_COLS = 'id,session_id,library_exercise_id,personal_exercise_id,exercise_name,mode,set_number,status,removed,display_unit,planned_reps,planned_reps_min,planned_reps_max,planned_weight_kg,planned_bodyweight,actual_reps,actual_weight_kg,actual_bodyweight,planned_hold_sec,actual_hold_sec,planned_work_sec,actual_work_sec,planned_rest_sec,actual_rest_sec,planned_rounds,actual_rounds,planned_total_sec,actual_total_sec,planned_lap_count,actual_laps,planned_events,actual_events';
  function loadTracking(c, id) {
    var pageSize = 1000;
    var pages = root.WBHistory && root.WBHistory.collectPages;
    if (typeof pages !== 'function') return Promise.resolve({ error: true, sets: [], sessions: [], exercises: [] });
    function page(table, cols, ownerCol) {
      return function (after, size) {
        var q = c.from(table).select(cols).eq(ownerCol, id).order('id', { ascending: true }).limit(size);
        if (table === 'workout_sessions') q = q.in('status', ['completed', 'ended_early']);
        if (table === 'workout_sets') q = q.eq('removed', false);
        if (after) q = q.gt('id', after);
        return q;
      };
    }
    return Promise.all([
      pages(page('workout_sessions', 'id,local_date,started_at,ended_at,workout_name,status,workout_id,program_id', 'client_id'), pageSize),
      pages(page('workout_sets', TRACK_SET_COLS, 'client_id'), pageSize),
      pages(page('personal_exercises', 'id,stable_key', 'user_id'), pageSize)
    ]).then(function (pair) {
      var err = (pair[0] && pair[0].error) || (pair[1] && pair[1].error) || (pair[2] && pair[2].error);
      if (err) {
        var missing = /workout_sets|workout_sessions|personal_exercises|42P01|PGRST205|schema cache/i.test(String(err.message || err.code || err.details || ''));
        return { unavailable: !!missing, error: true, sets: [], sessions: [], exercises: [] };
      }
      return {
        sessions: pair[0].data || [],
        sets: pair[1].data || [],
        exercises: pair[2].data || []
      };
    });
  }
  function loadSchedule(c, id) {
    var pageSize = 1000;
    var pages = root.WBHistory && root.WBHistory.collectPages;
    if (typeof pages !== 'function') return Promise.resolve({ unavailable: true, entries: [] });
    function fetchPage(after, size) {
      var q = c.from('program_entries')
        .select('id,local_id,owner_id,workout_local_id,day,presence,updated_at')
        .eq('owner_id', id)
        .order('id', { ascending: true })
        .limit(size);
      if (after) q = q.gt('id', after);
      return q;
    }
    return pages(fetchPage, pageSize).then(function (page) {
      if (!page || page.error) {
        var err = page && page.error;
        var missing = /program_entries|42P01|PGRST205|schema cache/i.test(String(err && (err.message || err.code || err.details) || ''));
        return { unavailable: !!missing || !page, entries: [] };
      }
      return { entries: page.data || [] };
    });
  }
  function signedUser() {
    return db().then(function (c) {
      return c.auth.getSession().then(function (res) {
        var user = userOf(res && res.data && res.data.session);
        return { c: c, user: user && isUuid(user.id) ? user : null };
      });
    });
  }
  var api = {
    session: function () {
      return db().then(function (c) { return c.auth.getSession(); }).then(function (res) {
        if (res.error) throw res.error;
        return res.data.session || null;
      });
    },
    // getSession can hand back a saved sign-in whose access token has already expired.
    // Refresh that before a workout sync, so an expired token is not reported as offline.
    freshSession: function () {
      return api.session().then(function (session) {
        if (!session || !sessionExpired(session)) return session;
        return db().then(function (c) {
          if (!c.auth.refreshSession) return session;
          return c.auth.refreshSession().then(function (again) {
            if (again.error) {
              var failed = new Error((again.error && again.error.message) || 'Sign in again');
              if (/failed to fetch|network|timeout|load failed/i.test(failed.message)) failed.offline = true;
              else failed.auth = true;
              throw failed;
            }
            return (again.data && again.data.session) || null;
          });
        });
      });
    },
    onAuth: function (fn) {
      if (typeof fn === 'function') authWatchers.push(fn);
    },
    signUp: function (email, password) {
      return db().then(function (c) {
        return c.auth.signUp({ email: email, password: password, options: { emailRedirectTo: REDIRECT } });
      }).then(function (res) {
        if (res.error) throw res.error;
        return { session: res.data.session || null, needsConfirmation: !res.data.session };
      });
    },
    signIn: function (email, password) {
      return db().then(function (c) { return c.auth.signInWithPassword({ email: email, password: password }); }).then(function (res) {
        if (res.error) throw res.error;
        return res.data.session || null;
      });
    },
    signOut: function () {
      return db().then(function (c) { return c.auth.signOut(); }).then(function (res) {
        if (res.error) throw res.error;
      });
    },
    // Same redirect as email confirmation. coachtrainerapp.com/** is already allowed.
    requestPasswordReset: function (email) {
      return db().then(function (c) {
        return c.auth.resetPasswordForEmail(String(email || '').trim(), { redirectTo: REDIRECT });
      }).then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
    },
    updatePassword: function (password) {
      return db().then(function (c) {
        return c.auth.updateUser({ password: password });
      }).then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
    },
    // '', 'recovery', 'code', or 'error'. Read from the URL captured at load.
    recoveryArrival: function () { return arrivalKind(); },
    // Classify the link after the client has had a chance to read it.
    // 'recovery' shows the new-password form, 'signed-in' is an email
    // confirmation (or other non-recovery code), 'invalid' is an expired link.
    consumeAuthCallback: function () {
      if (arrivalKind() === 'error') return Promise.resolve(invalidRecovery());
      return api.session().then(function (session) {
        return classifyArrival(session);
      }, function () {
        if (arrival.type === 'recovery') return establishRecovery();
        if (arrival.code || arrivalKind() === 'error') return invalidRecovery();
        return { kind: 'none' };
      });
    },
    profile: function () {
      return db().then(function (c) {
        return c.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          var user = userOf(res.data.session);
          if (!user) return null;
          return ensureProfile(c, user).then(function (row) { return withVerified(c, user.id, row); });
        });
      });
    },
    saveProfile: function (fields) {
      fields = fields || {};
      var row = {
        display_name: fields.display_name || null,
        city: fields.city || null,
        state: fields.state || null,
        online_only: !!fields.online_only,
        bio: fields.bio || null
      };
      if (fields.avatar_path) row.avatar_path = fields.avatar_path;
      return db().then(function (c) {
        return c.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          var user = userOf(res.data.session);
          if (!user) throw new Error('Sign in first.');
          return c.from('profiles').update(row).eq('id', user.id).select(PROFILE_FULL).single().then(function (res) {
            if (res.error) throw res.error;
            return withVerified(c, user.id, withReady(res.data, true));
          });
        });
      }).then(function (saved) {
        return saved;
      }, function (err) { throw profileSaveError(err); });
    },
    uploadAvatar: function (blob) {
      if (!blob) return Promise.reject(new Error('Choose a photo.'));
      return db().then(function (c) {
        return c.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          var user = userOf(res.data.session);
          if (!user) throw new Error('Sign in first.');
          var path = user.id + '/avatar.jpg';
          return c.storage.from('avatars').upload(path, blob, {
            upsert: true,
            contentType: 'image/jpeg',
            cacheControl: '3600'
          }).then(function (up) {
            if (up.error) throw up.error;
            return path;
          });
        });
      }).then(function (path) { return path; }, function (err) { throw profileSaveError(err); });
    },
    avatarUrl: function (path) {
      path = String(path || '');
      if (!path) return Promise.resolve('');
      return db().then(function (c) {
        return c.storage.from('avatars').createSignedUrl(path, 60 * 60);
      }).then(function (res) {
        if (!res || res.error || !res.data) return '';
        return res.data.signedUrl || res.data.signedURL || '';
      }, function () { return ''; });
    },
    myVerifications: function () {
      return db().then(function (c) {
        return c.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          var user = userOf(res.data.session);
          if (!user) return [];
          return c.from('verification_requests')
            .select('id,cert_body,cert_number,expires_on,status,admin_note,created_at,reviewed_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        });
      }).then(function (res) {
        if (Array.isArray(res)) return res;
        if (res.error) throw verificationError(res.error);
        return res.data || [];
      }, function (err) { throw verificationError(err); });
    },
    submitVerification: function (fields) {
      fields = fields || {};
      return db().then(function (c) {
        return c.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          var user = userOf(res.data.session);
          if (!user) throw new Error('Sign in first.');
          return c.from('verification_requests').insert({
            user_id: user.id,
            cert_body: fields.cert_body,
            cert_number: fields.cert_number,
            expires_on: fields.expires_on,
            status: 'pending'
          }).select('id,cert_body,cert_number,expires_on,status,admin_note,created_at,reviewed_at').single();
        });
      }).then(function (res) {
        if (res.error) throw verificationError(res.error);
        return res.data;
      }, function (err) { throw verificationError(err); });
    },
    verificationQueue: function () {
      return db().then(function (c) {
        return c.from('verification_queue').select('id,user_id,display_name,email,cert_body,cert_number,expires_on,created_at').order('created_at', { ascending: true });
      }).then(function (res) {
        if (res.error) throw verificationError(res.error);
        return res.data || [];
      }, function (err) { throw verificationError(err); });
    },
    reviewVerification: function (id, status, note) {
      var patch = { status: status };
      if (status === 'declined') patch.admin_note = note || null;
      if (status === 'approved') patch.admin_note = null;
      return db().then(function (c) {
        return c.from('verification_requests').update(patch).eq('id', id).select('id,status,admin_note,reviewed_at').single();
      }).then(function (res) {
        if (res.error) throw verificationError(res.error);
        return res.data;
      }, function (err) { throw verificationError(err); });
    },
    saveIntended: function (planId) {
      if (!Mem.canSelectIntended(planId)) throw new Error('A trainer invite is required for Free Client.');
      return db().then(function (c) {
        return c.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          var user = userOf(res.data.session);
          if (!user) throw new Error('Sign in first.');
          return ensureProfile(c, user).then(function () {
            return c.from('profiles').update({ intended_plan: planId }).eq('id', user.id).select('id,email,membership,intended_plan').single();
          });
        });
      }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },
    roster: function () { return rpc('invite_roster'); },
    createInvite: function () { return rpc('invite_create'); },
    cancelInvite: function (code) { return rpc('invite_cancel', { p_code: code }); },
    redeemInvite: function (code, share) {
      var withShare = typeof share === 'boolean';
      return db().then(function (c) {
        var args = { p_code: code };
        if (withShare) args.p_share = share;
        return c.rpc('invite_redeem', args).then(function (res) {
          // The live database may still have invite_redeem(text) until the
          // sharing migration is applied. Linking must keep working.
          if (res.error && withShare && shareArgMissing(res.error)) {
            return c.rpc('invite_redeem', { p_code: code }).then(function (again) {
              return { res: again, stored: false };
            });
          }
          return { res: res, stored: withShare && !res.error };
        });
      }).then(function (out) {
        if (out.res.error) throw inviteError(out.res.error);
        var data = out.res.data;
        if (out.stored && data && typeof data === 'object') data = Object.assign({}, data, { shareStored: true });
        return data;
      });
    },
    shareSetting: function () { return shareRpc('share_setting'); },
    setShare: function (on) {
      if (typeof on !== 'boolean') return Promise.reject(new Error('Choose on or off.'));
      return shareRpc('share_set', { p_on: on });
    },
    saveTrackedSession: function (payload) {
      if (!payload || !payload.session || !Array.isArray(payload.sets)) return Promise.resolve({ ok: false });
      return db().then(function (c) {
        return c.rpc('tracking_save_session', { p_session: payload.session, p_sets: payload.sets });
      }).then(function (res) {
        if (!res || res.error) return { ok: false };
        return { ok: true, id: res.data || null };
      }, function () { return { ok: false }; });
    },
    pushOwn: function (workouts, sessions) {
      if (!Array.isArray(workouts) || !Array.isArray(sessions)) {
        return Promise.reject(new Error('Could not read workouts to share.'));
      }
      return shareRpc('share_push', { p_workouts: workouts, p_sessions: sessions });
    },
    clientStatus: function (clientId) { return shareRpc('share_status', { p_client: clientId }); },
    clientWorkouts: function (clientId) {
      return db().then(function (c) {
        return c.from('own_workouts').select('local_id,name,items,updated_at').eq('owner_id', clientId).order('updated_at', { ascending: false });
      }).then(function (res) {
        if (res.error) throw shareError(res.error);
        if (!Array.isArray(res.data)) throw new Error('Could not load workouts.');
        return res.data.map(function (row) {
          return {
            localId: row.local_id,
            name: row.name,
            items: Array.isArray(row.items) ? row.items : [],
            updatedAt: row.updated_at
          };
        });
      });
    },
    clientSessions: function (clientId) {
      return db().then(function (c) {
        return c.from('own_sessions').select('local_id,workout_id,workout_name,started_at,ended_at,results').eq('owner_id', clientId).order('ended_at', { ascending: false });
      }).then(function (res) {
        if (res.error) throw shareError(res.error);
        if (!Array.isArray(res.data)) throw new Error('Could not load workouts.');
        return res.data.map(function (row) {
          return {
            localId: row.local_id,
            workoutId: row.workout_id || '',
            workoutName: row.workout_name || '',
            startedAt: row.started_at,
            endedAt: row.ended_at,
            results: Array.isArray(row.results) ? row.results : []
          };
        });
      });
    },
    endConnection: function (clientId) { return rpc('invite_end', { p_client: clientId && clientId !== 'self' ? clientId : null }); },
    threads: function () { return messageRpc('message_threads'); },
    messages: function (personId) { return messageRpc('message_open', { p_person: personId }); },
    sendMessage: function (personId, messageId, body) {
      return messageRpc('message_send', { p_person: personId, p_id: messageId, p_body: body });
    },
    markRead: function (personId) { return messageRpc('message_read', { p_person: personId }); },
    workoutCopies: function () { return workoutRpc('workout_mine'); },
    sendWorkout: function (deliveries, name, items, sourceId) {
      return workoutRpc('workout_send', {
        p_deliveries: deliveries || [],
        p_name: name || '',
        p_items: items || [],
        p_source: sourceId || ''
      });
    },
    saveWorkoutCopy: function (id, name, items) {
      return workoutRpc('workout_save', { p_id: id, p_name: name || '', p_items: items || [] });
    },
    deleteWorkoutCopy: function (id) { return workoutRpc('workout_delete', { p_id: id }); },
    accountPull: function () { return accountRpc('account_workout_pull'); },
    accountImport: function (workout) { return accountRpc('account_workout_import', { p_workout: workout || {} }); },
    accountPush: function (change) { return accountRpc('account_workout_push', { p_change: change || {} }); },
    clientAccountWorkouts: function (clientId) { return accountRpc('account_client_workouts', { p_client: clientId }); },
    saveClientWorkout: function (clientId, change) { return accountRpc('account_client_save', { p_client: clientId, p_change: change || {} }); },
    clientSentWorkouts: function (clientId) { return accountRpc('workout_sent', { p_client: clientId }); },
    saveClientCopy: function (id, name, items) {
      return accountRpc('workout_trainer_save', { p_id: id, p_name: name || '', p_items: items || [] });
    },
    deleteClientCopy: function (id) { return accountRpc('workout_trainer_delete', { p_id: id }); },
    watchMessages: function (handler) {
      return db().then(function (c) {
        var channel = c.channel('wb-messages-' + Math.random().toString(36).slice(2));
        channel.on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, function () {
          try { handler(); } catch (e) {}
        });
        channel.subscribe();
        return function () { try { c.removeChannel(channel); } catch (e2) {} };
      });
    },
    myConnection: function () {
      return rpc('invite_mine').then(function (row) { return row && row.trainerId ? row : null; });
    },
    // Read-only. The signed-in person's own finished sessions. Never another client's.
    myHistory: function () {
      return signedUser().then(function (ctx) {
        if (!ctx.user) return { sets: [], sessions: [], exercises: [] };
        return loadTracking(ctx.c, ctx.user.id);
      }).then(function (out) { return out; }, function () {
        return { error: true, sets: [], sessions: [], exercises: [] };
      });
    },
    // A trainer's read of one connected client's sessions. Row level security
    // returns nothing when the link is missing or has ended.
    clientTracking: function (clientId) {
      if (!isUuid(clientId)) return Promise.resolve({ error: true, sets: [], sessions: [], exercises: [] });
      return signedUser().then(function (ctx) {
        if (!ctx.user || ctx.user.id === clientId) return { error: true, sets: [], sessions: [], exercises: [] };
        return loadTracking(ctx.c, clientId);
      }).then(function (out) { return out; }, function () {
        return { error: true, sets: [], sessions: [], exercises: [] };
      });
    },
    // The signed-in person's own program calendar, every page. updated_at is
    // included so a local removal loses to a newer server copy, the same way
    // the calendar brings that day back. A missing table hides the streak; it
    // does not fail the rest of the dashboard.
    mySchedule: function () {
      // collectPages reads every program_entries page, including updated_at.
      return signedUser().then(function (ctx) {
        if (!ctx.user) return { entries: [] };
        return loadSchedule(ctx.c, ctx.user.id);
      }).then(function (out) { return out; }, function () {
        return { unavailable: true, entries: [] };
      });
    },
    clientSchedule: function (clientId) {
      if (!isUuid(clientId)) return Promise.resolve({ unavailable: true, entries: [] });
      return signedUser().then(function (ctx) {
        if (!ctx.user || ctx.user.id === clientId) return { unavailable: true, entries: [] };
        return loadSchedule(ctx.c, clientId);
      }).then(function (out) { return out; }, function () {
        return { unavailable: true, entries: [] };
      });
    },
    // Shared copies for the signed-in client. A missing table is an empty
    // list, so Tracking still opens before the SQL is applied.
    myShares: function () {
      return db().then(function (c) {
        return c.from('shared_dashboards')
          .select('id,trainer_id,trainer_name,as_of,cards,created_at,viewed_at')
          .order('created_at', { ascending: false });
      }).then(function (res) {
        if (!res || res.error) {
          if (res && shareTableMissing(res.error)) return { unavailable: true, shares: [] };
          return { error: true, shares: [] };
        }
        return { shares: res.data || [] };
      }, function () {
        return { error: true, shares: [] };
      });
    },
    shareDashboard: function (input) {
      input = input || {};
      if (!isUuid(input.clientId)) return Promise.resolve({ ok: false });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.asOf || ''))) return Promise.resolve({ ok: false });
      if (!Array.isArray(input.cards) || !input.cards.length || input.cards.length > 9) return Promise.resolve({ ok: false });
      var name = String(input.trainerName || '').replace(/^\s+|\s+$/g, '').slice(0, 80);
      if (!name || name.indexOf('@') !== -1) name = 'Trainer';
      return signedUser().then(function (ctx) {
        if (!ctx.user || ctx.user.id === input.clientId) return { ok: false };
        return ctx.c.from('shared_dashboards').insert({
          client_id: input.clientId,
          trainer_id: ctx.user.id,
          trainer_name: name,
          as_of: input.asOf,
          cards: input.cards
        }).select('id').single().then(function (ins) {
          if (!ins || ins.error) {
            if (ins && shareTableMissing(ins.error)) return { ok: false, unavailable: true };
            return { ok: false };
          }
          return { ok: true, id: ins.data && ins.data.id };
        });
      }).then(function (out) { return out; }, function () {
        return { ok: false };
      });
    },
    // The signed-in trainer's own card order. Null means they have never saved one.
    // The workout numbers stay live; this row is only the order.
    myDashboardLayout: function () {
      return signedUser().then(function (ctx) {
        if (!ctx.user) return { cards: null };
        return ctx.c.from('dashboard_layouts').select('cards').eq('user_id', ctx.user.id).maybeSingle().then(function (res) {
          if (!res || res.error) {
            if (res && layoutTableMissing(res.error)) return { unavailable: true, cards: null };
            return { error: true, cards: null };
          }
          var cards = res.data && res.data.cards;
          return { cards: Array.isArray(cards) ? cards : null };
        });
      }).then(function (out) { return out; }, function () {
        return { error: true, cards: null };
      });
    },
    saveDashboardLayout: function (cards) {
      var list = layoutList(cards);
      return signedUser().then(function (ctx) {
        if (!ctx.user) return { ok: false };
        return ctx.c.from('dashboard_layouts').upsert({
          user_id: ctx.user.id,
          cards: list
        }, { onConflict: 'user_id' }).then(function (res) {
          if (!res || res.error) {
            if (res && layoutTableMissing(res.error)) return { ok: false, unavailable: true };
            return { ok: false };
          }
          return { ok: true, cards: list };
        });
      }).then(function (out) { return out; }, function () {
        return { ok: false };
      });
    },
    resetDashboardLayout: function () {
      return signedUser().then(function (ctx) {
        if (!ctx.user) return { ok: false };
        return ctx.c.from('dashboard_layouts').delete().eq('user_id', ctx.user.id).then(function (res) {
          if (!res || res.error) {
            if (res && layoutTableMissing(res.error)) return { ok: false, unavailable: true };
            return { ok: false };
          }
          return { ok: true };
        });
      }).then(function (out) { return out; }, function () {
        return { ok: false };
      });
    },
    markShareViewed: function (id) {
      if (!isUuid(id)) return Promise.resolve({ ok: false });
      return db().then(function (c) {
        return c.from('shared_dashboards')
          .update({ viewed_at: new Date().toISOString() })
          .eq('id', id)
          .select('id,viewed_at')
          .maybeSingle();
      }).then(function (res) {
        if (!res || res.error) {
          var msg = String(res && res.error && (res.error.message || res.error.details || res.error.code) || '');
          if (/already opened/i.test(msg)) return { ok: true, already: true };
          if (shareTableMissing(res && res.error)) return { ok: false, unavailable: true };
          return { ok: false };
        }
        if (!res.data) return { ok: true, already: true };
        return { ok: true, viewed_at: res.data.viewed_at };
      }, function () {
        return { ok: false };
      });
    },
    gifBase: EXERCISE_GIF_BASE,
    searchExercises: function (query, filters, limit, offset) {
      filters = filters || {};
      return db().then(function (c) {
        return c.rpc('search_exercises', {
          p_query: query || '',
          p_body_part: filters.bodyPart || '',
          p_equipment: filters.equipment || '',
          p_target: filters.target || '',
          p_limit: limit || 20,
          p_offset: offset || 0
        });
      }).then(function (res) {
        if (res.error) throw libraryError(res.error);
        return res.data || [];
      });
    },
    exerciseFilters: function () {
      return db().then(function (c) { return c.rpc('exercise_filter_options'); }).then(function (res) {
        if (res.error) throw libraryError(res.error);
        return res.data || { bodyParts: [], equipment: [], targets: [] };
      });
    },
    // Library rows for animations the user already saved, so a custom name can
    // bring that animation to the top. Reads the existing catalog by id.
    exercisesByIds: function (ids) {
      var seen = {}, list = [];
      (ids || []).forEach(function (id) {
        var s = String(id || '').trim();
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(s) || seen[s]) return;
        seen[s] = 1;
        list.push(s);
      });
      if (!list.length) return Promise.resolve([]);
      return db().then(function (c) {
        return c.from('exercises').select('id,name,body_part,equipment,target,description').in('id', list);
      }).then(function (res) {
        if (res.error) throw libraryError(res.error);
        return res.data || [];
      });
    },
    programEntries: function (ownerId) {
      var base = 'local_id,owner_id,workout_local_id,workout_name,items,day,presence,updated_at';
      function query(cols) {
        return db().then(function (c) {
          return c.from('program_entries').select(cols).eq('owner_id', ownerId);
        });
      }
      return query(base + ',starts_at,ends_at').then(function (res) {
        if (res.error && timeColumnMissing(res.error)) {
          return query(base).then(function (res2) {
            if (res2.error) throw programError(res2.error);
            var rows = Array.isArray(res2.data) ? res2.data : [];
            rows.timesPending = true;
            return rows;
          });
        }
        if (res.error) throw programError(res.error);
        return Array.isArray(res.data) ? res.data : [];
      });
    },
    saveProgramEntry: function (entry) {
      function row(withTimes) {
        var out = {
          owner_id: entry.ownerId,
          local_id: entry.id,
          workout_local_id: entry.workoutId,
          workout_name: entry.workoutName || 'Workout',
          items: Array.isArray(entry.items) ? entry.items : [],
          day: entry.date,
          presence: entry.presence === 'trainer' ? 'trainer' : 'solo'
        };
        if (withTimes && entry.start && entry.end) {
          out.starts_at = String(entry.start).slice(0, 5);
          out.ends_at = String(entry.end).slice(0, 5);
        }
        return out;
      }
      function upsert(withTimes) {
        return db().then(function (c) {
          return c.from('program_entries').upsert(row(withTimes), { onConflict: 'owner_id,local_id' });
        });
      }
      var timed = !!(entry.start && entry.end);
      return upsert(timed).then(function (res) {
        if (res.error && timed && timeColumnMissing(res.error)) {
          return upsert(false).then(function (res2) {
            if (res2.error) throw programError(res2.error);
            var err = new Error('Start and end times are saved on this device until the program times SQL is applied.');
            err.timesLocal = true;
            throw err;
          });
        }
        if (res.error) throw programError(res.error);
        return true;
      });
    },
    deleteProgramEntry: function (ownerId, localId) {
      return db().then(function (c) {
        return c.from('program_entries').delete().eq('owner_id', ownerId).eq('local_id', localId);
      }).then(function (res) {
        if (res.error) throw programError(res.error);
        return true;
      });
    },
    calendarFeed: function (zone, preferToken) {
      return saveCalendarFeed(zone, preferToken, false);
    },
    resetCalendarFeed: function (zone) {
      return saveCalendarFeed(zone, '', true);
    }
  };
  function feedZone(zone) {
    var z = String(zone || '').trim();
    if (/^[A-Za-z0-9_+-]{1,64}(\/[A-Za-z0-9_+-]{1,64}){0,3}$/.test(z)) return z;
    return 'UTC';
  }
  function feedToken(prefer) {
    if (/^[0-9a-f]{64}$/.test(prefer || '')) return prefer;
    if (root.WBCalendar && root.WBCalendar.newToken) return root.WBCalendar.newToken();
    var bytes = new Uint8Array(32);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
    return hex;
  }
  function feedMissing(err) {
    var msg = (err && (err.message || err.details || err.hint || err.code)) || '';
    return /schema cache|could not find|does not exist|PGRST205|42P01|calendar_feeds/i.test(String(msg));
  }
  function feedLocal(err) {
    var e = err || new Error('The calendar link is saved on this device until the calendar feed SQL is applied.');
    e.local = true;
    return e;
  }
  function feedRow(data, preview) {
    return { token: data.token, timezone: data.time_zone, preview: !!preview };
  }
  function saveCalendarFeed(zone, preferToken, reset) {
    var tz = feedZone(zone);
    return db().then(function (c) {
      return c.auth.getSession().then(function (res) {
        if (res.error) throw res.error;
        var user = userOf(res.data.session);
        if (!user) {
          var signedOut = new Error('Sign in first.');
          signedOut.auth = true;
          throw signedOut;
        }
        if (!reset) {
          return c.from('calendar_feeds').select('token,time_zone').eq('user_id', user.id).maybeSingle().then(function (row) {
            if (row.error) throw row.error;
            if (row.data && row.data.token) return feedRow(row.data, false);
            return insertCalendarFeed(c, user.id, feedToken(preferToken), tz);
          });
        }
        return insertCalendarFeed(c, user.id, feedToken(''), tz, true);
      });
    }).catch(function (err) {
      if (err && (err.local || err.auth)) throw err;
      if (feedMissing(err)) throw feedLocal();
      throw new Error((err && err.message) || 'Could not make the calendar link.');
    });
  }
  function insertCalendarFeed(c, userId, token, tz, reset) {
    var write = reset
      ? c.from('calendar_feeds').upsert({ user_id: userId, token: token, time_zone: tz }, { onConflict: 'user_id' })
      : c.from('calendar_feeds').insert({ user_id: userId, token: token, time_zone: tz });
    return write.select('token,time_zone').single().then(function (ins) {
      if (!ins.error) return feedRow(ins.data, false);
      if (!reset && (ins.error.code === '23505' || /duplicate/i.test(ins.error.message || ''))) {
        return c.from('calendar_feeds').select('token,time_zone').eq('user_id', userId).single().then(function (again) {
          if (again.error) throw again.error;
          return feedRow(again.data, false);
        });
      }
      throw ins.error;
    });
  }
  function timeColumnMissing(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    return /starts_at|ends_at/i.test(msg);
  }
  function programError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (timeColumnMissing(err)) {
      return new Error('Start and end times are saved on this device until the program times SQL is applied.');
    }
    if (/schema cache|could not find|does not exist|PGRST202|PGRST205|42P01|program_entries/i.test(msg)) {
      return new Error('Programs are not on the server yet. Apply the programs SQL in the Supabase SQL editor.');
    }
    return new Error(msg || 'Could not save the calendar.');
  }
  function libraryError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    try { console.error(err); } catch (e) {}
    if (/schema cache|could not find the function|does not exist|PGRST202|PGRST205/i.test(msg)) {
      return new Error('The exercise library is not ready yet.');
    }
    if (/JWT|not authenticated|permission denied|42501/i.test(msg)) {
      return new Error('Sign in to search the exercise library.');
    }
    return new Error('Could not search the exercise library.');
  }
  function rpc(name, args) {
    return db().then(function (c) { return c.rpc(name, args || {}); }).then(function (res) {
      if (res.error) throw inviteError(res.error);
      return res.data;
    });
  }
  function messageRpc(name, args) {
    return db().then(function (c) { return c.rpc(name, args || {}); }).then(function (res) {
      if (res.error) throw messageError(res.error);
      return res.data;
    });
  }
  function workoutRpc(name, args) {
    return db().then(function (c) { return c.rpc(name, args || {}); }).then(function (res) {
      if (res.error) throw workoutError(res.error);
      return res.data;
    });
  }
  function accountMissing(err) {
    var msg = (err && (err.message || err.details || err.hint || err.code)) || '';
    return /schema cache|could not find the function|PGRST202|PGRST205|42883|42P01/i.test(String(msg));
  }
  function accountRpc(name, args) {
    return db().then(function (c) { return c.rpc(name, args || {}); }).then(function (res) {
      if (res.error) throw accountSaveError(res.error);
      return res.data;
    });
  }
  function sessionExpired(session) {
    var exp = session && session.expires_at;
    if (typeof exp !== 'number' || !isFinite(exp)) return false;
    var ms = exp > 1e12 ? exp : exp * 1000;
    return ms <= Date.now() + 60000;
  }
  function accountSaveError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (accountMissing(err)) {
      var missing = new Error('Workouts stay on this device until the account workout SQL is applied.');
      missing.missing = true;
      return missing;
    }
    var out = new Error(msg || 'Could not save that workout.');
    if (/failed to fetch|networkerror|load failed|timeout/i.test(msg)) out.offline = true;
    else if (/jwt expired|invalid jwt|invalid claim|not authenticated|sign in first|pgrst301|invalid token|permission denied|42501/i.test(msg)) out.auth = true;
    else if (/up to 6 workouts|enter a workout name|could not save that workout|that workout could not be saved|you cannot (save|edit|delete)|cannot be reassigned|there is no connection|only view these workouts|choose a linked client|only an enthusiast|was not found/i.test(msg)) out.permanent = true;
    return out;
  }
  function workoutError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (/schema cache|could not find the function|does not exist|PGRST202|PGRST205|42P01/i.test(msg)) {
      return new Error('Sending workouts is not available yet. Apply the workout SQL in the Supabase SQL editor.');
    }
    return new Error(msg || 'Could not send that workout.');
  }
  function messageError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (/schema cache|could not find the function|does not exist|PGRST202|PGRST205|42P01/i.test(msg)) {
      return new Error('Messages are not available yet. Apply the messages SQL in the Supabase SQL editor.');
    }
    if (/invalid input syntax for type uuid/i.test(msg)) return new Error('There is no connection.');
    return new Error(msg || 'Could not use messages');
  }
  function shareArgMissing(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    return /schema cache|could not find the function|PGRST202/i.test(msg);
  }
  function shareRpc(name, args) {
    return db().then(function (c) { return c.rpc(name, args || {}); }).then(function (res) {
      if (res.error) throw shareError(res.error);
      return res.data;
    });
  }
  function verificationError(err) {
    var msg = (err && (err.message || err.details || err.hint || err.code)) || '';
    msg = String(msg);
    if (/schema cache|could not find|does not exist|PGRST205|PGRST202|42P01|verification_requests|verification_queue/i.test(msg)) {
      return new Error('Verification is not available yet. Apply the verification SQL in the Supabase SQL editor.');
    }
    if (/already pending|verification_requests_one_pending|duplicate key/i.test(msg)) {
      return new Error('A request is already pending review.');
    }
    if (/already verified/i.test(msg)) return new Error('You are already verified.');
    if (/only a master trainer/i.test(msg)) return new Error('Only a Master Trainer can request verification.');
    if (/must be in the future/i.test(msg)) return new Error('Expiration date must be in the future.');
    if (/enter a note/i.test(msg)) return new Error('Enter a note.');
    if (/keep the note short/i.test(msg)) return new Error('Keep the note short.');
    if (/only the admin/i.test(msg)) return new Error('Only the admin can review a verification.');
    if (/certification body and number|certifying organization and number/i.test(msg)) return new Error('Enter the certifying organization and number.');
    if (/too long/i.test(msg)) return new Error('Certification details are too long.');
    return new Error(msg || 'Could not save verification.');
  }
  function shareError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (/schema cache|could not find the function|does not exist|PGRST202|PGRST205|42P01|share_with_trainer|own_workouts|own_sessions/i.test(msg)) {
      return new Error('Sharing workouts is not available yet. Apply the sharing SQL in the Supabase SQL editor.');
    }
    return new Error(msg || 'Could not update sharing.');
  }
  function inviteError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (/schema cache|could not find the function|does not exist|PGRST202|PGRST205/i.test(msg)) {
      return new Error('Invite storage is not ready yet. Apply the invite SQL in the Supabase SQL editor.');
    }
    return new Error(msg || 'Could not use invites');
  }
  root.WBAuth = api;
})(window);
