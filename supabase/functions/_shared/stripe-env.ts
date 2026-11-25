// Maps the service-role secret onto the name @supabase/server reads.
// SUPABASE_URL is injected by Supabase. Nothing here has a key value.

export function bridgeServiceRole(): void {
  try {
    const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (legacy && !Deno.env.get('SUPABASE_SECRET_KEY')) {
      Deno.env.set('SUPABASE_SECRET_KEY', legacy)
    }
  } catch (_err) {
    // The host may already provide SUPABASE_SECRET_KEY and lock the env.
  }
}
