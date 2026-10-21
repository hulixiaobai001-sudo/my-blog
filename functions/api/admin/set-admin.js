export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId: adminId } = JSON.parse(session);
  const admin = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(adminId).first();
  if (!admin || !admin.is_admin) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });

  const { userId, action } = await request.json();
  if (!userId || !action) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });

  if (userId === adminId) return new Response(JSON.stringify({ error: '不能操作自己' }), { status: 400 });

  if (action === 'set_admin') {
    await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(userId).run();
  } else if (action === 'remove_admin') {
    await env.DB.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind(userId).run();
  } else {
    return new Response(JSON.stringify({ error: '未知操作' }), { status: 400 });
  }
  return new Response(JSON.stringify({ ok: true }));
}
