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
        if (!user) throw feedLocal(new Error('Sign in first.'));
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
      if (err && err.local) throw err;
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
