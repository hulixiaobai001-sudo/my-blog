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
    await env.DB.exec('CREATE TABLE IF NOT EXISTS redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, item_name TEXT, cost INTEGER, status TEXT DEFAULT \'pending\', created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    const { results } = await env.DB.prepare(`
      SELECT r.*, u.username FROM redemptions r JOIN users u ON r.user_id = u.id
      WHERE r.status = 'pending' ORDER BY r.id DESC
    `).all();
    return new Response(JSON.stringify({ redemptions: results }));
  } catch (e) {
    return new Response(JSON.stringify({ redemptions: [] }));
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
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { id } = await request.json();
  await env.DB.prepare("UPDATE redemptions SET status = 'completed' WHERE id = ?").bind(id).run();
  return new Response(JSON.stringify({ ok: true }));
}
