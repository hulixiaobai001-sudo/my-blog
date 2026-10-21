export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await env.DB.prepare('INSERT INTO stats (article_id, likes, views) VALUES (0, 0, 1) ON CONFLICT(article_id) DO UPDATE SET views = views + 0').run();
    const row = await env.DB.prepare('SELECT views FROM stats WHERE article_id = 0').first();
    // 防刷：同一 IP 每天只计一次
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const today = new Date().toISOString().slice(0, 10);
    const viewKey = `view:${ip}:${today}`;
    const counted = await env.AUTH_KV.get(viewKey);
    if (!counted) {
      await env.AUTH_KV.put(viewKey, '1', { expirationTtl: 86400 * 2 });
      await env.DB.prepare('UPDATE stats SET views = views + 1 WHERE article_id = 0').run();
      const row2 = await env.DB.prepare('SELECT views FROM stats WHERE article_id = 0').first();
      return new Response(JSON.stringify({ views: row2?.views || 1 }));
    }
    return new Response(JSON.stringify({ views: row?.views || 1 }));
  } catch (e) {
    try {
      await env.DB.exec('CREATE TABLE IF NOT EXISTS stats (article_id INTEGER PRIMARY KEY, likes INTEGER DEFAULT 0, views INTEGER DEFAULT 0)');
      await env.DB.prepare('INSERT INTO stats (article_id, likes, views) VALUES (0, 0, 1)').run();
    } catch(e2) {}
    return new Response(JSON.stringify({ views: 1 }));
  }
}
