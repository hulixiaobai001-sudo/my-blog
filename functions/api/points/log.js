export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    const { results } = await env.DB.prepare('SELECT amount, reason, created_at FROM points_log WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(userId).all();
    const user = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(userId).first();
    return new Response(JSON.stringify({ logs: results, points: user?.points || 0 }));
  } catch (e) {
    return new Response(JSON.stringify({ logs: [], points: 0 }));
  }
}
