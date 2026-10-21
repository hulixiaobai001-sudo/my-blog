export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  try {
    await env.DB.exec("ALTER TABLE users ADD COLUMN online_status INTEGER DEFAULT 0");
  } catch(e) {}
  try {
    await env.DB.prepare('UPDATE users SET last_seen = datetime(\'now\') WHERE id = ?').bind(userId).run();
    const user = await env.DB.prepare('SELECT id, username, qq, bio, avatar, avatar_url, short_name, nickname, contact, show_qq, points, role, is_admin, online_status FROM users WHERE id = ?').bind(userId).first();
    // 自动把站长（is_admin=1）升级为 super_admin
    if (user && user.is_admin && user.role !== 'super_admin') {
      await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").bind(userId).run();
      user.role = 'super_admin';
    }
    return new Response(JSON.stringify(user || {}));
  } catch (e) {
    try {
      await env.DB.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''");
      await env.DB.exec("ALTER TABLE users ADD COLUMN short_name TEXT DEFAULT ''");
      await env.DB.exec("ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''");
      await env.DB.exec("ALTER TABLE users ADD COLUMN contact TEXT DEFAULT ''");
      await env.DB.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
      const user = await env.DB.prepare('SELECT id, username, qq, bio, avatar, avatar_url, short_name, nickname, contact, show_qq, points, role FROM users WHERE id = ?').bind(userId).first();
      return new Response(JSON.stringify(user || {}));
    } catch(e2) {
      return new Response(JSON.stringify({}));
    }
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
  const body = await request.json();
  const clean = function(s, max) { return (s || '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, max || 200); };
  try {
    await env.DB.prepare('UPDATE users SET bio = ?, avatar = ?, avatar_url = ?, short_name = ?, nickname = ?, contact = ?, show_qq = ? WHERE id = ?')
      .bind(clean(body.bio), body.avatar || '', clean(body.avatar_url), clean(body.short_name, 20), clean(body.nickname, 20), clean(body.contact, 50), body.show_qq ? 1 : 0, userId).run();
  } catch (e) {
    await env.DB.exec("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''");
    await env.DB.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''");
    await env.DB.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''");
    await env.DB.exec("ALTER TABLE users ADD COLUMN short_name TEXT DEFAULT ''");
    await env.DB.exec("ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''");
    await env.DB.exec("ALTER TABLE users ADD COLUMN contact TEXT DEFAULT ''");
    await env.DB.exec("ALTER TABLE users ADD COLUMN show_qq INTEGER DEFAULT 0");
    await env.DB.prepare('UPDATE users SET bio = ?, avatar = ?, avatar_url = ?, short_name = ?, nickname = ?, contact = ?, show_qq = ? WHERE id = ?')
      .bind(clean(body.bio), body.avatar || '', clean(body.avatar_url), clean(body.short_name, 20), clean(body.nickname, 20), clean(body.contact, 50), body.show_qq ? 1 : 0, userId).run();
  }
  return new Response(JSON.stringify({ ok: true }));
}
