import { logAdmin } from '../../_lib.js';

// 安全日志：404 异常访问记录（站长/管理员审核）
// GET  /api/admin/security-logs?handled=0&page=1
// POST /api/admin/security-logs  { id, handled: 1|0, note? }
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT is_admin, role FROM users WHERE id = ?').bind(userId).first();
  if (!me || !me.is_admin) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });

  const url = new URL(request.url);
  const handled = url.searchParams.get('handled'); // 0=未处理 1=已处理 空=全部
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50')));
  const offset = (page - 1) * pageSize;

  try {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS security_log (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, ip TEXT, ua TEXT, referer TEXT, intent TEXT, handled INTEGER DEFAULT 0, note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))");
  } catch (e) {}

  const where = handled === '0' ? 'WHERE handled = 0' : handled === '1' ? 'WHERE handled = 1' : '';
  const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM security_log ' + where).first();
  const total = countRow ? countRow.c : 0;
  const { results } = await env.DB.prepare('SELECT * FROM security_log ' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?').bind(pageSize, offset).all();
  return new Response(JSON.stringify({ logs: results || [], total, hasMore: offset + results.length < total }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT is_admin, role FROM users WHERE id = ?').bind(userId).first();
  if (!me || !me.is_admin) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });

  const { id, handled, note } = await request.json();
  if (!id) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  try {
    await env.DB.prepare('UPDATE security_log SET handled = ?, note = ? WHERE id = ?')
      .bind(handled ? 1 : 0, String(note || '').slice(0, 200), id).run();
    await logAdmin(env, userId, '安全日志', '标记 #' + id + (handled ? ' 已处理' : ' 重新打开'));
  } catch (e) {
    return new Response(JSON.stringify({ error: '操作失败' }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }));
}
