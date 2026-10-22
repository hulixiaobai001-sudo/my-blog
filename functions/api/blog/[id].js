export async function onRequestGet(context) {
  const { request, env, params } = context;
  const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND published = 1').bind(params.id).first();
  if (!post) return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404 });

  // 文章浏览计数：同 IP 每篇文章每天只计一次
  let views = 0;
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS stats (article_id INTEGER PRIMARY KEY, likes INTEGER DEFAULT 0, views INTEGER DEFAULT 0)');
    await env.DB.prepare('INSERT OR IGNORE INTO stats (article_id, likes, views) VALUES (?, 0, 0)').bind(params.id).run();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const today = new Date().toISOString().slice(0, 10);
    const viewKey = `view:post:${params.id}:${ip}:${today}`;
    const counted = await env.AUTH_KV.get(viewKey);
    if (!counted) {
      await env.AUTH_KV.put(viewKey, '1', { expirationTtl: 86400 * 2 });
      await env.DB.prepare('UPDATE stats SET views = views + 1 WHERE article_id = ?').bind(params.id).run();
    }
    const row = await env.DB.prepare('SELECT views FROM stats WHERE article_id = ?').bind(params.id).first();
    views = row?.views || 0;
  } catch (e) {}

  return new Response(JSON.stringify({ post: { ...post, views } }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }));
}
