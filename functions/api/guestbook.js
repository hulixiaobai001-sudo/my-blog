const sensitiveWords = ['色情', '赌博', '毒品', '枪支', '暴力', '诈骗', '黑客', '刷单', '代孕', '迷药'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const user = await env.DB.prepare('SELECT username, banned FROM users WHERE id = ?').bind(userId).first();
  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 403 });
  if (user.banned) return new Response(JSON.stringify({ error: '账号已被封禁' }), { status: 403 });

  const body = await request.json();
  const content = (body.content || '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 500).trim();
  const imageUrl = body.image_url || '';
  if (!content && !imageUrl) return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400 });

  let status = 'approved';
  const hitWord = sensitiveWords.find(w => content.includes(w));
  if (hitWord || imageUrl) status = 'pending';

  try {
    await env.DB.prepare('INSERT INTO guestbook (user_id, content, image_url, status, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .bind(userId, content, imageUrl, status).run();
  } catch (e) {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS guestbook (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, content TEXT, image_url TEXT, status TEXT DEFAULT \'pending\', created_at TEXT)');
    await env.DB.prepare('INSERT INTO guestbook (user_id, content, image_url, status, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .bind(userId, content, imageUrl, status).run();
  }

  return new Response(JSON.stringify({ ok: true, status: status }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const mine = url.searchParams.get('mine');

  // 当前登录用户id
  let currentUserId = null;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (token) {
    const session = await env.AUTH_KV.get(`session:${token}`);
    if (session) currentUserId = JSON.parse(session).userId;
  }

  try {
    if (mine) {
      if (!currentUserId) return new Response(JSON.stringify({ messages: [] }));
      const { results } = await env.DB.prepare('SELECT id, content, image_url, status, created_at FROM guestbook WHERE user_id = ? ORDER BY id DESC').bind(currentUserId).all();
      return new Response(JSON.stringify({ messages: results || [], currentUserId: currentUserId }));
    }
    const { results } = await env.DB.prepare('SELECT g.id, g.user_id, g.content, g.image_url, g.created_at, u.username, u.avatar FROM guestbook g JOIN users u ON g.user_id = u.id WHERE g.status = \'approved\' ORDER BY g.id DESC LIMIT 50').all();
    return new Response(JSON.stringify({ messages: results || [], currentUserId: currentUserId }));
  } catch (e) {
    return new Response(JSON.stringify({ messages: [] }));
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const { id } = await request.json();
  // 只能删自己的，管理员也可删
  const row = await env.DB.prepare('SELECT user_id FROM guestbook WHERE id = ?').bind(id).first();
  if (!row) return new Response(JSON.stringify({ error: '留言不存在' }), { status: 404 });
  const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (row.user_id !== userId && !me.is_admin) return new Response(JSON.stringify({ error: '无权删除' }), { status: 403 });
  await env.DB.prepare('DELETE FROM guestbook WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ ok: true }));
}
