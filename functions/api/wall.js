import { sanitize } from '../_lib.js';

export async function onRequestGet(context) {
  const { env } = context;
  try {
    try { await env.DB.exec("CREATE TABLE IF NOT EXISTS wall (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, content TEXT, image_key TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT (datetime('now')))"); } catch(e) {}
    const { results } = await env.DB.prepare("SELECT id, username, content, image_key, status, created_at FROM wall WHERE status = 'approved' ORDER BY id DESC LIMIT 50").all();
    return new Response(JSON.stringify({ messages: results }));
  } catch (e) {
    return new Response(JSON.stringify({ messages: [] }));
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
  const user = await env.DB.prepare('SELECT username, banned FROM users WHERE id = ?').bind(userId).first();
  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 400 });
  if (user.banned) return new Response(JSON.stringify({ error: '账号已被封禁' }), { status: 403 });

  // 频率限制：30秒1条
  const rateKey = `rate:wall:${userId}`;
  const last = await env.AUTH_KV.get(rateKey);
  if (last) return new Response(JSON.stringify({ error: '发言太频繁，30秒后再试' }), { status: 429 });

  const { content, imageKey } = await request.json();
  if (!content || !content.trim()) return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400 });

  const c = sanitize(content, 500).trim();
  const keywords = ['习近平', '法轮', '台独', '藏独', '色情', '赌博', '毒品', '诈骗', '炸弹', '枪支'];
  let status = 'approved';
  for (var i = 0; i < keywords.length; i++) {
    if (c.indexOf(keywords[i]) >= 0) { status = 'pending'; break; }
  }

  await env.DB.prepare("INSERT INTO wall (user_id, username, content, image_key, status) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, user.username, c, imageKey || '', status).run();
  await env.AUTH_KV.put(rateKey, '1', { expirationTtl: 30 });

  return new Response(JSON.stringify({ ok: true, status: status }));
}
