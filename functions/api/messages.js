// 站内信：读取、已读、发送（任意登录用户可发）
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${token}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const { userId } = JSON.parse(sess);

  try { await env.DB.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, content TEXT, read INTEGER DEFAULT 0, from_user INTEGER DEFAULT 0, created_at TEXT)"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE messages ADD COLUMN from_user INTEGER DEFAULT 0"); } catch(e) {}

  const { results } = await env.DB.prepare(
    "SELECT m.id, m.title, m.content, m.read, m.from_user, m.created_at, f.username AS from_name " +
    "FROM messages m LEFT JOIN users f ON m.from_user = f.id " +
    "WHERE m.user_id = ? ORDER BY m.id DESC"
  ).bind(userId).all();
  return Response.json({ messages: results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${token}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const { userId } = JSON.parse(sess);
  const me = await env.DB.prepare('SELECT banned FROM users WHERE id = ?').bind(userId).first();
  if (!me) return Response.json({ error: '用户不存在' }, { status: 403 });
  if (me.banned) return Response.json({ error: '账号已被封禁' }, { status: 403 });

  const body = await request.json();

  // 发送站内信
  if (body.action === 'send') {
    const toUserId = parseInt(body.toUserId);
    const title = String(body.title || '').trim().slice(0, 200);
    const content = String(body.content || '').trim().slice(0, 2000);
    if (!toUserId) return Response.json({ error: '收件人无效' }, { status: 400 });
    if (!title || !content) return Response.json({ error: '标题和内容不能为空' }, { status: 400 });
    if (toUserId === userId) return Response.json({ error: '不能给自己发站内信' }, { status: 400 });
    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(toUserId).first();
    if (!target) return Response.json({ error: '收件人不存在' }, { status: 404 });

    // 限流：每分钟最多发 5 封
    const recent = await env.DB.prepare("SELECT COUNT(*) as c FROM messages WHERE from_user = ? AND created_at > datetime('now', '-1 minute')").bind(userId).first();
    if (recent && recent.c >= 5) return Response.json({ error: '发送太频繁，请稍后再试' }, { status: 429 });

    try { await env.DB.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, content TEXT, read INTEGER DEFAULT 0, from_user INTEGER DEFAULT 0, created_at TEXT)"); } catch(e) {}
    try { await env.DB.exec("ALTER TABLE messages ADD COLUMN from_user INTEGER DEFAULT 0"); } catch(e) {}

    await env.DB.prepare('INSERT INTO messages (user_id, title, content, read, from_user, created_at) VALUES (?, ?, ?, 0, ?, datetime(\'now\'))')
      .bind(toUserId, title, content, userId).run();
    return Response.json({ ok: true });
  }

  // 标记已读（原有逻辑）
  const { id } = body;
  if (!id) return Response.json({ error: '参数错误' }, { status: 400 });
  await env.DB.prepare('UPDATE messages SET read = 1 WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return Response.json({ ok: true });
}
