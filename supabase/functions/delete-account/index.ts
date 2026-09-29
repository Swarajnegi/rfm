import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (status: number, error?: string) => new Response(JSON.stringify(error ? { error } : { deleted: true }), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply(405, 'Method not allowed');
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return reply(401, 'Sign in required');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  // Validate with Auth, not a locally decoded JWT. No user_id from the client.
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return reply(401, 'Sign in required');
  const signInAt = Date.parse(user.last_sign_in_at || '');
  if (!Number.isFinite(signInAt) || Date.now() - signInAt > 5 * 60_000 || signInAt > Date.now() + 60_000)
    return reply(403, 'Sign in again before deleting the account');
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return reply(413, 'Request too large');
    body = JSON.parse(raw);
  } catch { return reply(400, 'Invalid request'); }
  if (body.confirmation !== 'DELETE') return reply(400, 'Confirmation required');
  const revoked = await admin.auth.admin.signOut(token, 'global');
  if (revoked.error) return reply(503, 'Could not revoke sessions; retry');
  const deleted = await admin.auth.admin.deleteUser(user.id);
  if (deleted.error) return reply(503, 'Deletion did not complete; retry');
  // FK ON DELETE CASCADE removes the user's synchronized document.
  return reply(200);
});
