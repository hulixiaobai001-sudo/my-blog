import { sanitize, getSensitiveWords, checkBanned, sendSystemMessage, getSiteSettings } from '../_lib.js';

// 确保表结构齐全（兼容旧表）
async function ensureTable(env) {
  try { await env.DB.exec("CREATE TABLE IF NOT EXISTS guestbook (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, content TEXT, image_url TEXT, status TEXT DEFAULT 'pending', is_anonymous INTEGER DEFAULT 0, reply_to INTEGER DEFAULT 0, created_at TEXT)"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE guestbook ADD COLUMN is_anonymous INTEGER DEFAULT 0"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE guestbook ADD COLUMN reply_to INTEGER DEFAULT 0"); } catch(e) {}
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
  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 403 });
  const banErr = await checkBanned(env, userId);
  if (banErr) return new Response(JSON.stringify({ error: banErr }), { status: 403 });

  await ensureTable(env);

  const settings = await getSiteSettings(env);
  if (settings.guestbook_open !== '1') return new Response(JSON.stringify({ error: '留言墙暂未开放' }), { status: 403 });

  const body = await request.json();
  const content = sanitize(body.content, 500).trim();
  // 图片仅允许 http(s) 链接，防止协议注入
  const imageUrl = String(body.image_url || '').startsWith('http') ? String(body.image_url).slice(0, 500) : '';
  const isAnonymous = body.is_anonymous ? 1 : 0;
  const replyTo = parseInt(body.reply_to) || 0;
  if (!content && !imageUrl) return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400 });

  // 回复目标校验：必须存在，且不能回复另一条回复（只允许一层楼中楼）
  if (replyTo) {
    const parent = await env.DB.prepare('SELECT id, reply_to FROM guestbook WHERE id = ?').bind(replyTo).first();
    if (!parent) return new Response(JSON.stringify({ error: '要回复的留言不存在' }), { status: 404 });
    if (parent.reply_to && parent.reply_to !== 0) return new Response(JSON.stringify({ error: '只能回复主留言，不能回复回复' }), { status: 400 });
  }

  // 审核规则：匿名留言一律待审核；带图或含敏感词也待审核；普通文字直接显示
  let status = 'approved';
  const sensitiveWords = await getSensitiveWords(env);
  const hitWord = sensitiveWords.find(w => content.includes(w));
  if (isAnonymous || hitWord || imageUrl) status = 'pending';

  try {
    await env.DB.prepare('INSERT INTO guestbook (user_id, content, image_url, status, is_anonymous, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      .bind(userId, content, imageUrl, status, isAnonymous, replyTo).run();
  } catch (e) {
    return new Response(JSON.stringify({ error: '发布失败，请重试' }), { status: 500 });
  }

  // 楼中楼回复：给被回复者发系统通知（不通知自己）
  if (replyTo) {
    const target = await env.DB.prepare('SELECT user_id FROM guestbook WHERE id = ?').bind(replyTo).first();
    if (target && target.user_id !== userId) {
      await sendSystemMessage(env, target.user_id, '你的留言被回复了', '有人在留言墙回复了你的留言，点击查看：' + content.slice(0, 80));
    }
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

  await ensureTable(env);

  // 漂流瓶：随机返回一条已审核的匿名留言（主留言，不含回复）
  if (bottle) {
    try {
      const { results } = await env.DB.prepare("SELECT content FROM guestbook WHERE status = 'approved' AND is_anonymous = 1 AND reply_to = 0 ORDER BY RANDOM() LIMIT 1").all();
      if (results && results.length > 0) {
        return new Response(JSON.stringify({ message: results[0].content }));
      }
      return new Response(JSON.stringify({ message: null }));
    } catch (e) {
      return new Response(JSON.stringify({ message: null }));
    }
  }

  // 当前登录用户id 与是否管理员（决定删除/回复权限）
  let currentUserId = null;
  let currentUserIsAdmin = false;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (token) {
    const session = await env.AUTH_KV.get(`session:${token}`);
    if (session) {
      currentUserId = JSON.parse(session).userId;
      const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(currentUserId).first();
      currentUserIsAdmin = !!(me && me.is_admin);
    }
  }

  try {
    if (mine) {
      if (!currentUserId) return new Response(JSON.stringify({ messages: [], total: 0, hasMore: false }));
      const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM guestbook WHERE user_id = ?').bind(currentUserId).first();
      const total = countRow ? countRow.c : 0;
      const { results } = await env.DB.prepare('SELECT id, content, image_url, status, is_anonymous, reply_to, created_at FROM guestbook WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').bind(currentUserId, pageSize, offset).all();
      return new Response(JSON.stringify({ messages: results || [], total: total, hasMore: offset + results.length < total, currentUserId: currentUserId, currentUserIsAdmin: currentUserIsAdmin }));
    }
    // 公开留言 / 匿名树洞：只显示已审核主留言 + 其已审核回复（一层楼中楼）
    var whereClause = "g.status = 'approved' AND g.reply_to = 0";
    if (anon) whereClause += " AND g.is_anonymous = 1";
    const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM guestbook g WHERE ' + whereClause).first();
    const total = countRow ? countRow.c : 0;
    const { results } = await env.DB.prepare("SELECT g.id, g.user_id, g.content, g.image_url, g.is_anonymous, g.created_at, u.username, u.avatar FROM guestbook g JOIN users u ON g.user_id = u.id WHERE " + whereClause + " ORDER BY g.id DESC LIMIT ? OFFSET ?").bind(pageSize, offset).all();

    // 拉取这批主留言的已审核回复，按父 id 分组
    var replies = {};
    if (results && results.length > 0) {
      const ids = results.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const rWhere = "status = 'approved' AND reply_to IN (" + placeholders + ")";
      const { results: replyRows } = await env.DB.prepare("SELECT g.id, g.user_id, g.content, g.image_url, g.is_anonymous, g.reply_to, g.created_at, u.username, u.avatar FROM guestbook g JOIN users u ON g.user_id = u.id WHERE " + rWhere + " ORDER BY g.id ASC").bind(...ids).all();
      for (const r of (replyRows || [])) {
        (replies[r.reply_to] = replies[r.reply_to] || []).push(r);
      }
    }
    return new Response(JSON.stringify({ messages: results || [], replies: replies, total: total, hasMore: offset + results.length < total, currentUserId: currentUserId, currentUserIsAdmin: currentUserIsAdmin }));
  } catch (e) {
    return new Response(JSON.stringify({ messages: [], replies: {}, total: 0, hasMore: false }));
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
  // 只能删自己的（含匿名），管理员/站长可删任意留言
  const row = await env.DB.prepare('SELECT user_id FROM guestbook WHERE id = ?').bind(id).first();
  if (!row) return new Response(JSON.stringify({ error: '留言不存在' }), { status: 404 });
  const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (row.user_id !== userId && !(me && me.is_admin)) return new Response(JSON.stringify({ error: '无权删除' }), { status: 403 });
  // 级联删除：主留言被删时，其全部回复一并删除
  await env.DB.prepare('DELETE FROM guestbook WHERE id = ? OR reply_to = ?').bind(id, id).run();
  return new Response(JSON.stringify({ ok: true }));
}
