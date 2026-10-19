export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  try {
    const { results } = await env.DB.prepare('SELECT id, username, points, created_at, is_admin FROM users ORDER BY id ASC').all();
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
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可操作' }), { status: 403 });

  const { userId, amount, reason } = await request.json();
  if (!userId || amount === undefined) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });

  try {
    await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(amount, userId).run();
    await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, amount, reason || '站长手动调整').run();
  } catch (e) {
    return new Response(JSON.stringify({ error: '操作失败：' + e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }));
}
