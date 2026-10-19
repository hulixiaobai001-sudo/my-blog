export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { id, status } = await request.json();
  await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind(status, id).run();
  if (status === 'approved') {
    const report = await env.DB.prepare('SELECT user_id FROM reports WHERE id = ?').bind(id).first();
    if (report) await env.DB.prepare('UPDATE users SET points = points + 5 WHERE id = ?').bind(report.user_id).run();
  }
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { results } = await env.DB.prepare(`
    SELECT r.id, r.image_key, r.caption, r.status, r.created_at, u.username
    FROM reports r JOIN users u ON r.user_id = u.id
    WHERE r.status = 'pending'
    ORDER BY r.id DESC
  `).all();
  return new Response(JSON.stringify({ reports: results }));
}
