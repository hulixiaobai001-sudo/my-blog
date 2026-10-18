export async function onRequestPost(context) {
  const { request, env } = context;
  const { username, password } = await request.json();

  const user = await env.DB.prepare('SELECT id, username, password_hash, is_admin FROM users WHERE username = ?').bind(username).first();
  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 401 });

  const hash = await sha256(password);
  if (hash !== user.password_hash) return new Response(JSON.stringify({ error: '密码错误' }), { status: 401 });

  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.AUTH_KV.put(`session:${token}`, JSON.stringify({ userId: user.id, isAdmin: user.is_admin }), { expirationTtl: 60 * 60 * 24 * 30 });

  return new Response(JSON.stringify({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin } }), {
    headers: { 'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; Max-Age=2592000; SameSite=Lax`, 'Content-Type': 'application/json' }
  });
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
