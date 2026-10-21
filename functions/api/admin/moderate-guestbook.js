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

  const { id, status } = await request.json();
  if (!id || !status) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  if (status !== 'approved' && status !== 'rejected') return new Response(JSON.stringify({ error: '状态错误' }), { status: 400 });

  await env.DB.prepare('UPDATE guestbook SET status = ? WHERE id = ?').bind(status, id).run();
  return new Response(JSON.stringify({ ok: true }));
}

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

  const { results } = await env.DB.prepare("SELECT g.id, g.content, g.image_url, g.created_at, g.status, u.username FROM guestbook g JOIN users u ON g.user_id = u.id WHERE g.status = 'pending' ORDER BY g.id DESC").all();
  return new Response(JSON.stringify({ messages: results || [] }));
}
