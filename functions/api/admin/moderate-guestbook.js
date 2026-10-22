import { logAdmin } from '../../_lib.js';

// 留言审核：待审核/已通过列表 + 通过/拒绝/删除（支持批量）
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const admin = await env.DB.prepare('SELECT is_admin, role FROM users WHERE id = ?').bind(userId).first();
  if (!admin || (!admin.is_admin && admin.role !== 'admin' && admin.role !== 'super_admin')) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });

  try { await env.DB.exec("CREATE TABLE IF NOT EXISTS guestbook (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, content TEXT, image_url TEXT, status TEXT DEFAULT 'pending', is_anonymous INTEGER DEFAULT 0, reply_to INTEGER DEFAULT 0, created_at TEXT)"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE guestbook ADD COLUMN is_anonymous INTEGER DEFAULT 0"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE guestbook ADD COLUMN reply_to INTEGER DEFAULT 0"); } catch(e) {}

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
    return new Response(JSON.stringify({ error: '状态错误' }), { status: 400 });
  }

  const { results } = await env.DB.prepare(
    "SELECT g.id, g.content, g.image_url, g.created_at, g.status, g.is_anonymous, g.reply_to, u.username, u.avatar " +
    "FROM guestbook g JOIN users u ON g.user_id = u.id WHERE g.status = ? ORDER BY g.id DESC LIMIT 200"
  ).bind(status).all();
  return new Response(JSON.stringify({ messages: results || [] }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const admin = await env.DB.prepare('SELECT is_admin, role FROM users WHERE id = ?').bind(userId).first();
  if (!admin || (!admin.is_admin && admin.role !== 'admin' && admin.role !== 'super_admin')) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });

  const body = await request.json();
  const { id, status } = body;

  // 批量审核：ids 数组 + status
  if (body.ids && Array.isArray(body.ids)) {
    const ids = body.ids.map(Number).filter(Boolean);
    const s2 = ['approved', 'rejected'].includes(status) ? status : 'approved';
    if (ids.length > 0) {
      for (const gid of ids) {
        await env.DB.prepare('UPDATE guestbook SET status = ? WHERE id = ?').bind(s2, gid).run();
      }
      await logAdmin(env, userId, '留言审核', '批量' + (s2 === 'approved' ? '通过' : '拒绝') + ' ' + ids.length + ' 条');
    }
    return new Response(JSON.stringify({ ok: true, count: ids.length }));
  }

  if (body.action === 'delete') {
    // 级联删除：主留言与其回复一并删除
    await env.DB.prepare('DELETE FROM guestbook WHERE id = ? OR reply_to = ?').bind(id, id).run();
    return new Response(JSON.stringify({ ok: true }));
  }
  if (!id || !status) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  if (status !== 'approved' && status !== 'rejected') return new Response(JSON.stringify({ error: '状态错误' }), { status: 400 });

  await env.DB.prepare('UPDATE guestbook SET status = ? WHERE id = ?').bind(status, id).run();
  await logAdmin(env, userId, '留言审核', (status === 'approved' ? '通过' : '拒绝') + ' 留言 #' + id);
  return new Response(JSON.stringify({ ok: true }));
}
