import { sanitize } from '../_lib.js';

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
  const content = sanitize(body.content, 500).trim();
  // 图片仅允许 http(s) 链接，防止协议注入
  const imageUrl = String(body.image_url || '').startsWith('http') ? String(body.image_url).slice(0, 500) : '';
  const isAnonymous = body.is_anonymous ? 1 : 0;
  if (!content && !imageUrl) return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400 });

  let status = 'approved';
  const hitWord = sensitiveWords.find(w => content.includes(w));
  if (hitWord || imageUrl) status = 'pending';

  try {
    await env.DB.prepare('INSERT INTO guestbook (user_id, content, image_url, status, is_anonymous, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))')
      .bind(userId, content, imageUrl, status, isAnonymous).run();
  } catch (e) {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS guestbook (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, content TEXT, image_url TEXT, status TEXT DEFAULT \'pending\', is_anonymous INTEGER DEFAULT 0, created_at TEXT)');
    // 兼容旧表：尝试加字段
    try { await env.DB.exec('ALTER TABLE guestbook ADD COLUMN is_anonymous INTEGER DEFAULT 0'); } catch(e2) {}
    await env.DB.prepare('INSERT INTO guestbook (user_id, content, image_url, status, is_anonymous, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))')
      .bind(userId, content, imageUrl, status, isAnonymous).run();
  }

  return new Response(JSON.stringify({ ok: true, status: status }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const mine = url.searchParams.get('mine');
  const anon = url.searchParams.get('anon');
  const bottle = url.searchParams.get('bottle');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  // 漂流瓶：随机返回一条已审核的匿名留言
  if (bottle) {
    try {
      const { results } = await env.DB.prepare("SELECT content FROM guestbook WHERE status = 'approved' AND is_anonymous = 1 ORDER BY RANDOM() LIMIT 1").all();
      if (results && results.length > 0) {
        return new Response(JSON.stringify({ message: results[0].content }));
      }
      return new Response(JSON.stringify({ message: null }));
    } catch (e) {
      return new Response(JSON.stringify({ message: null }));
    }
  }

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
      if (!currentUserId) return new Response(JSON.stringify({ messages: [], total: 0, hasMore: false }));
      const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM guestbook WHERE user_id = ?').bind(currentUserId).first();
      const total = countRow ? countRow.c : 0;
      const { results } = await env.DB.prepare('SELECT id, content, image_url, status, is_anonymous, created_at FROM guestbook WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').bind(currentUserId, pageSize, offset).all();
      return new Response(JSON.stringify({ messages: results || [], total: total, hasMore: offset + results.length < total, currentUserId: currentUserId }));
    }
    // 公开留言：anon=1 只看匿名，否则看全部（匿名留言也显示，但标记匿名）
    var whereClause = "g.status = 'approved'";
    if (anon) whereClause += " AND g.is_anonymous = 1";
    const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM guestbook g WHERE ' + whereClause).first();
    const total = countRow ? countRow.c : 0;
    const { results } = await env.DB.prepare("SELECT g.id, g.user_id, g.content, g.image_url, g.is_anonymous, g.created_at, u.username, u.avatar FROM guestbook g JOIN users u ON g.user_id = u.id WHERE " + whereClause + " ORDER BY g.id DESC LIMIT ? OFFSET ?").bind(pageSize, offset).all();
    return new Response(JSON.stringify({ messages: results || [], total: total, hasMore: offset + results.length < total, currentUserId: currentUserId }));
  } catch (e) {
    return new Response(JSON.stringify({ messages: [], total: 0, hasMore: false }));
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
