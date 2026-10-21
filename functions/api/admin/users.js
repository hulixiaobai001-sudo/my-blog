import { sanitize } from '../../_lib.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  try { await env.DB.exec("ALTER TABLE users ADD COLUMN last_seen TEXT DEFAULT ''"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE users ADD COLUMN online_status INTEGER DEFAULT 0"); } catch(e) {}

  const dbUser = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!dbUser || !dbUser.is_admin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  try {
    const { results } = await env.DB.prepare('SELECT id, username, points, qq, bio, avatar, show_qq, created_at, is_admin, banned, last_seen, role, online_status FROM users ORDER BY is_admin DESC, id ASC').all();
    return new Response(JSON.stringify({ users: results }));
  } catch (e) {
    return new Response(JSON.stringify({ users: [] }));
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId: adminId } = JSON.parse(session);
  const dbAdmin = await env.DB.prepare('SELECT role, is_admin FROM users WHERE id = ?').bind(adminId).first();
  if (!dbAdmin || !dbAdmin.is_admin) return new Response(JSON.stringify({ error: '仅管理员可操作' }), { status: 403 });

  const body = await request.json();

  // 发站内信：管理员与站长均可发，可发给任意用户（含管理员/站长）
  if (body.action === 'message') {
    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(body.userId).first();
    if (!target) return new Response(JSON.stringify({ error: '目标用户不存在' }), { status: 404 });
    await env.DB.prepare('INSERT INTO messages (user_id, title, content, created_at) VALUES (?, ?, ?, datetime(\'now\'))')
      .bind(target.id, sanitize(body.title, 200), sanitize(body.content, 2000)).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  // 删除用户/发积分/封禁/设管理员仅限站长（super_admin）
  if (dbAdmin.role !== 'super_admin') return new Response(JSON.stringify({ error: '仅站长可操作' }), { status: 403 });

  // 删除用户（注销）：级联清理该用户全部内容与隐私字段
  if (body.action === 'delete_user') {
    const target = await env.DB.prepare('SELECT id, is_admin FROM users WHERE id = ?').bind(body.userId).first();
    if (!target) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
    if (target.id === adminId) return new Response(JSON.stringify({ error: '不能删除自己' }), { status: 400 });
    if (target.is_admin) return new Response(JSON.stringify({ error: '请先取消该用户的管理员身份' }), { status: 400 });
    await deleteUser(env, target.id);
    return new Response(JSON.stringify({ ok: true }));
  }

  // 封禁/解禁
  if (body.action === 'ban' || body.action === 'unban') {
    const banned = body.action === 'ban' ? 1 : 0;
    await env.DB.prepare('UPDATE users SET banned = ? WHERE id = ? AND is_admin = 0').bind(banned, body.userId).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  const { userId, amount, reason } = body;
  if (!userId || amount === undefined) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  const pts = parseInt(amount);
  if (isNaN(pts) || pts < -10000 || pts > 10000) return new Response(JSON.stringify({ error: '积分范围异常' }), { status: 400 });

  try {
    await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(pts, userId).run();
    await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, pts, reason || '站长手动调整').run();
  } catch (e) {
    console.error('adjust points error', e);
    return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }));
}

// 删除用户数据：清理返图 KV、级联删除内容表、软删除用户并清空隐私字段
async function deleteUser(env, userId) {
  try {
    const { results } = await env.DB.prepare('SELECT image_key FROM reports WHERE user_id = ? AND image_key IS NOT NULL AND image_key != ?').bind(userId, '').all();
    for (const r of (results || [])) {
      try { await env.IMAGES_KV.delete(r.image_key); } catch(e) {}
    }
  } catch(e) {}
  const tables = ['guestbook', 'messages', 'reports', 'tickets', 'points_log', 'wall', 'comments'];
  for (const t of tables) {
    try { await env.DB.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').bind(userId).run(); } catch(e) {}
  }
  // 硬删除用户行：彻底移除账号
  try { await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run(); } catch(e) {}
}
