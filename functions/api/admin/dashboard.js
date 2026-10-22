// 后台总览 Dashboard：全站健康数据一眼看全（站长）
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!me || !me.is_admin) return new Response(JSON.stringify({ error: '仅管理员可查看' }), { status: 403 });

  const out = {};
  try {
    out.total_users = (await env.DB.prepare('SELECT COUNT(*) as c FROM users').first()).c;
    out.new_users_today = (await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','start of day')").first()).c;
  } catch(e) { out.total_users = 0; out.new_users_today = 0; }
  try { out.pending_reports = (await env.DB.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'").first()).c; } catch(e) { out.pending_reports = 0; }
  try { out.approved_reports = (await env.DB.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'approved'").first()).c; } catch(e) { out.approved_reports = 0; }
  try { out.pending_guestbook = (await env.DB.prepare("SELECT COUNT(*) as c FROM guestbook WHERE status = 'pending'").first()).c; } catch(e) { out.pending_guestbook = 0; }
  try { out.total_guestbook = (await env.DB.prepare("SELECT COUNT(*) as c FROM guestbook").first()).c; } catch(e) { out.total_guestbook = 0; }
  try { out.pending_tickets = (await env.DB.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").first()).c; } catch(e) { out.pending_tickets = 0; }
  try { out.total_tickets = (await env.DB.prepare('SELECT COUNT(*) as c FROM tickets').first()).c; } catch(e) { out.total_tickets = 0; }
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, message TEXT, created_at TEXT)');
    out.error_logs = (await env.DB.prepare('SELECT COUNT(*) as c FROM error_log').first()).c;
  } catch(e) { out.error_logs = 0; }
  try { out.total_views = (await env.DB.prepare('SELECT SUM(views) as s FROM page_views').first()).s || 0; } catch(e) { out.total_views = 0; }
  try {
    out.recent_users = (await env.DB.prepare('SELECT username, created_at FROM users ORDER BY id DESC LIMIT 5').all()).results;
  } catch(e) { out.recent_users = []; }
  try {
    out.recent_errors = (await env.DB.prepare('SELECT path, message, created_at FROM error_log ORDER BY id DESC LIMIT 5').all()).results;
  } catch(e) { out.recent_errors = []; }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
