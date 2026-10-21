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
  // 发积分/封禁/站内信仅限 super_admin（站长），普通管理员只有审核权限
  const dbAdmin = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(adminId).first();
  if (!dbAdmin || dbAdmin.role !== 'super_admin') return new Response(JSON.stringify({ error: '仅站长可操作' }), { status: 403 });

  const body = await request.json();

  // 封禁/解禁
  if (body.action === 'ban' || body.action === 'unban') {
    const banned = body.action === 'ban' ? 1 : 0;
    await env.DB.prepare('UPDATE users SET banned = ? WHERE id = ? AND is_admin = 0').bind(banned, body.userId).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  // 发站内信
  if (body.action === 'message') {
    await env.DB.prepare('INSERT INTO messages (user_id, title, content, created_at) VALUES (?, ?, ?, datetime(\'now\'))').bind(body.userId, sanitize(body.title, 200), sanitize(body.content, 2000)).run();
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
