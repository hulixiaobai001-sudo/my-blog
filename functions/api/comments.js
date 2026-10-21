import { sanitize } from '../_lib.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const postId = url.searchParams.get('post_id');
  if (!postId) return new Response(JSON.stringify({ comments: [] }));
  try {
    const { results } = await env.DB.prepare(`
      SELECT c.id, c.content, c.created_at, u.username 
      FROM comments c JOIN users u ON c.user_id = u.id 
      WHERE c.post_id = ? ORDER BY c.id ASC
    `).bind(postId).all();
    return new Response(JSON.stringify({ comments: results }));
  } catch (e) {
    return new Response(JSON.stringify({ comments: [] }));
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  // 封禁用户禁止评论
  const me = await env.DB.prepare('SELECT banned FROM users WHERE id = ?').bind(userId).first();
  if (!me) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 403 });
  if (me.banned) return new Response(JSON.stringify({ error: '账号已被封禁' }), { status: 403 });

  // 频率限制：1分钟1条
  const rateKey = `rate:comment:${userId}`;
  const last = await env.AUTH_KV.get(rateKey);
  if (last) return new Response(JSON.stringify({ error: '发言太频繁，1分钟后再试' }), { status: 429 });

  const { post_id, content } = await request.json();
  if (!post_id || !content) return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400 });
  const clean = sanitize(content, 500);
  try {
    await env.DB.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').bind(post_id, userId, clean).run();
  } catch (e) {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, user_id INTEGER, content TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    await env.DB.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').bind(post_id, userId, clean).run();
  }
  await env.AUTH_KV.put(rateKey, '1', { expirationTtl: 60 });
  return new Response(JSON.stringify({ ok: true }));
}
