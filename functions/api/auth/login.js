import { randomToken } from '../../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // 登录失败限流：5次锁15分钟
  const failKey = `loginfail:${ip}`;
  const fails = parseInt(await env.AUTH_KV.get(failKey) || '0');
  if (fails >= 5) return new Response(JSON.stringify({ error: '失败次数过多，15分钟后再试' }), { status: 429 });

  const { username, password } = await request.json();

  let user;
  try {
    user = await env.DB.prepare('SELECT id, username, password_hash, is_admin FROM users WHERE username = ?').bind(username).first();
    if (!user) {
      await env.AUTH_KV.put(failKey, String(fails + 1), { expirationTtl: 900 });
      return new Response(JSON.stringify({ error: '用户名或密码错误' }), { status: 401 });
    }

    const hash = await sha256(password);
    if (hash !== user.password_hash) {
      await env.AUTH_KV.put(failKey, String(fails + 1), { expirationTtl: 900 });
      return new Response(JSON.stringify({ error: '用户名或密码错误' }), { status: 401 });
    }
  } catch (e) {
    console.error('login error', e);
    return new Response(JSON.stringify({ error: '用户名或密码错误' }), { status: 401 });
  }

  await env.AUTH_KV.delete(failKey);
  const token = randomToken() + randomToken();
  await env.AUTH_KV.put(`session:${token}`, JSON.stringify({ userId: user.id, isAdmin: user.is_admin }), { expirationTtl: 60 * 60 * 24 * 30 });

  return new Response(JSON.stringify({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin } }), {
    headers: { 'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; Max-Age=2592000; SameSite=Lax`, 'Content-Type': 'application/json' }
  });
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
