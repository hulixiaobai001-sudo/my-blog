export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  // 频率限制：每天3次
  const today = new Date().toISOString().slice(0, 10);
  const rateKey = `rate:ticket:${userId}:${today}`;
  const todayCount = parseInt(await env.AUTH_KV.get(rateKey) || '0');
  if (todayCount >= 3) return new Response(JSON.stringify({ error: '今天工单已达3次上限，明天再来' }), { status: 429 });

  const { title, content } = await request.json();
  if (!title || !content) return new Response(JSON.stringify({ error: '标题和内容不能为空' }), { status: 400 });
  const cleanTitle = title.replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 100);
  const cleanContent = content.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<iframe[^>]*>/gi, '').slice(0, 2000);
  await env.DB.prepare('INSERT INTO tickets (user_id, title, content) VALUES (?, ?, ?)').bind(userId, cleanTitle, cleanContent).run();
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    await env.DB.prepare('UPDATE users SET points = points - 10 WHERE id = ?').bind(userId).run();
    await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, -10, '提交工单：' + cleanTitle).run();
  } catch(e) {
    await env.DB.prepare('UPDATE users SET points = points - 10 WHERE id = ?').bind(userId).run();
  }
  await env.AUTH_KV.put(rateKey, String(todayCount + 1), { expirationTtl: 86400 * 2 });
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId, isAdmin } = JSON.parse(session);

  if (isAdmin) {
    const { results } = await env.DB.prepare(`
      SELECT t.*, u.username FROM tickets t JOIN users u ON t.user_id = u.id
      WHERE t.status != 'closed'
      ORDER BY t.id DESC
    `).all();
    return new Response(JSON.stringify({ tickets: results }));
  } else {
    const { results } = await env.DB.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC').bind(userId).all();
    return new Response(JSON.stringify({ tickets: results }));
  }
}
