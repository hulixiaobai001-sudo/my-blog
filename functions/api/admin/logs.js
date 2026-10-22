// 管理日志：后台关键操作留痕，按时间倒序（站长）
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

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50')));
  const offset = (page - 1) * pageSize;
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT, detail TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM admin_log').first();
    const { results } = await env.DB.prepare(
      'SELECT l.id, l.actor_id, l.action, l.detail, l.created_at, u.username AS actor_name FROM admin_log l LEFT JOIN users u ON l.actor_id = u.id ORDER BY l.id DESC LIMIT ? OFFSET ?'
    ).bind(pageSize, offset).all();
    return new Response(JSON.stringify({ logs: results || [], total: countRow ? countRow.c : 0 }));
  } catch (e) {
    return new Response(JSON.stringify({ logs: [], total: 0 }));
  }
}
