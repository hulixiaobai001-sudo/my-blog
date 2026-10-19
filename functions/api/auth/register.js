export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { username, password, qq } = await request.json();

    if (!username || !password || username.length < 2 || password.length < 6) {
      return new Response(JSON.stringify({ error: '用户名至少2字符，密码至少6位' }), { status: 400 });
    }

    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) {
      return new Response(JSON.stringify({ error: '用户名已被占用' }), { status: 409 });
    }

    const hash = await sha256(password);
    try {
      await env.DB.prepare('INSERT INTO users (username, password_hash, qq) VALUES (?, ?, ?)').bind(username, hash, qq || '').run();
    } catch (e) {
      await env.DB.exec('ALTER TABLE users ADD COLUMN qq TEXT DEFAULT \'\'');
      await env.DB.prepare('INSERT INTO users (username, password_hash, qq) VALUES (?, ?, ?)').bind(username, hash, qq || '').run();
    }
    const user = await env.DB.prepare('SELECT id, username, is_admin FROM users WHERE username = ?').bind(username).first();

    const token = crypto.randomUUID() + crypto.randomUUID();
    await env.AUTH_KV.put(`session:${token}`, JSON.stringify({ userId: user.id, isAdmin: user.is_admin }), { expirationTtl: 60 * 60 * 24 * 30 });

    return new Response(JSON.stringify({ token, user }), {
      headers: { 'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; Max-Age=2592000; SameSite=Lax`, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
