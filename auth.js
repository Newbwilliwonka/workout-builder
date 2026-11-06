/* Email/password sign-in for the public Supabase project. No service key. */
(function (root) {
  'use strict';
  var URL = 'https://thyrgloermygnezfareg.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_YT4vJriMUtcFRveDBA0GaA_eDiu5_Py';
  var REDIRECT = 'https://newbwilliwonka.github.io/workout-builder/';
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
    }
  };
  root.WBAuth = api;
})(window);
