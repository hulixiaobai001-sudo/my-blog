export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ user: null }));

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ user: null }));

  const { userId } = JSON.parse(session);
  const user = await env.DB.prepare('SELECT id, username, is_admin, points FROM users WHERE id = ?').bind(userId).first();
  return new Response(JSON.stringify({ user }));
}
