export async function onRequestGet(context) {
  const { env } = context;
  try {
    await env.DB.prepare('INSERT INTO stats (article_id, likes, views) VALUES (0, 0, 1) ON CONFLICT(article_id) DO UPDATE SET views = views + 1').run();
    const row = await env.DB.prepare('SELECT views FROM stats WHERE article_id = 0').first();
    return new Response(JSON.stringify({ views: row?.views || 1 }));
  } catch (e) {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS stats (article_id INTEGER PRIMARY KEY, likes INTEGER DEFAULT 0, views INTEGER DEFAULT 0)');
    await env.DB.prepare('INSERT INTO stats (article_id, likes, views) VALUES (0, 0, 1)').run();
    return new Response(JSON.stringify({ views: 1 }));
  }
}
