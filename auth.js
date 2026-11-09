/* Email/password sign-in for the public Supabase project. No service key. */
(function (root) {
  'use strict';
  var URL = 'https://thyrgloermygnezfareg.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_YT4vJriMUtcFRveDBA0GaA_eDiu5_Py';
  var REDIRECT = 'https://newbwilliwonka.github.io/workout-builder/';
  // Bunny folder that contains 180/ and 360/.
  // A library demo is this value + "/180/" + id + ".gif" (or "/360/"). Not a secret.
  var EXERCISE_GIF_BASE = 'https://kinisiexercises.b-cdn.net';
  var LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
  var client = null, loading = null;
  var Mem = root.WBMembership;

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
      if (!client) client = lib.createClient(URL, PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
      });
      return client;
    });
  }
  function userOf(session) { return session && session.user ? session.user : null; }
  function ensureProfile(c, user) {
    return c.from('profiles').select('id,email,membership,intended_plan').eq('id', user.id).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      if (res.data) return res.data;
      return c.from('profiles').insert({ id: user.id, email: user.email || null, membership: Mem.NONE }).select('id,email,membership,intended_plan').single().then(function (ins) {
        if (ins.error) throw ins.error;
        return ins.data;
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
    profile: function () {
      return db().then(function (c) {
        return c.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          var user = userOf(res.data.session);
          if (!user) return null;
          return ensureProfile(c, user);
        });
      });
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
    redeemInvite: function (code) { return rpc('invite_redeem', { p_code: code }); },
    endConnection: function (clientId) { return rpc('invite_end', { p_client: clientId && clientId !== 'self' ? clientId : null }); },
    myConnection: function () {
      return rpc('invite_mine').then(function (row) { return row && row.trainerId ? row : null; });
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
    }
  };
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
  function inviteError(err) {
    var msg = (err && (err.message || err.details || err.hint)) || '';
    if (/schema cache|could not find the function|does not exist|PGRST202|PGRST205/i.test(msg)) {
      return new Error('Invite storage is not ready yet. Apply the invite SQL in the Supabase SQL editor.');
    }
    return new Error(msg || 'Could not use invites');
  }
  root.WBAuth = api;
})(window);
