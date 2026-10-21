export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  try {
    await env.DB.prepare('UPDATE users SET last_seen = datetime(\'now\') WHERE id = ?').bind(userId).run();
    const user = await env.DB.prepare('SELECT id, username, qq, bio, avatar, show_qq, points FROM users WHERE id = ?').bind(userId).first();
    return new Response(JSON.stringify(user || {}));
  } catch (e) {
    return new Response(JSON.stringify({}));
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const { bio, avatar, show_qq } = await request.json();
  const cleanBio = (bio || '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 200);
  try {
    await env.DB.prepare('UPDATE users SET bio = ?, avatar = ?, show_qq = ? WHERE id = ?').bind(cleanBio, avatar || '', show_qq ? 1 : 0, userId).run();
  } catch (e) {
    await env.DB.exec('ALTER TABLE users ADD COLUMN bio TEXT DEFAULT \'\'');
    await env.DB.exec('ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT \'\'');
    await env.DB.exec('ALTER TABLE users ADD COLUMN show_qq INTEGER DEFAULT 0');
    await env.DB.prepare('UPDATE users SET bio = ?, avatar = ?, show_qq = ? WHERE id = ?').bind(cleanBio, avatar || '', show_qq ? 1 : 0, userId).run();
  }
  return new Response(JSON.stringify({ ok: true }));
}
