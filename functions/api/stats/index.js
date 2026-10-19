export async function onRequestPost(context) {
  const { request, env } = context;
  const { postId } = await request.json();
  if (!postId) return new Response(JSON.stringify({ error: '缺少文章ID' }), { status: 400 });

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  const key = `like:${postId}:${ip}:${today}`;

  const existing = await env.AUTH_KV.get(key);
  if (existing) return new Response(JSON.stringify({ error: '今天已经点过赞了' }), { status: 400 });

  try {
    await env.DB.prepare('INSERT INTO stats (article_id, likes, views) VALUES (?, 1, 0) ON CONFLICT(article_id) DO UPDATE SET likes = likes + 1').bind(postId).run();
  } catch (e) {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS stats (article_id INTEGER PRIMARY KEY, likes INTEGER DEFAULT 0, views INTEGER DEFAULT 0)');
    await env.DB.prepare('INSERT INTO stats (article_id, likes, views) VALUES (?, 1, 0) ON CONFLICT(article_id) DO UPDATE SET likes = likes + 1').bind(postId).run();
  }

  await env.AUTH_KV.put(key, '1', { expirationTtl: 86400 });
  const row = await env.DB.prepare('SELECT likes, views FROM stats WHERE article_id = ?').bind(postId).first();
  return new Response(JSON.stringify({ likes: row.likes }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const postId = url.searchParams.get('post_id');
  if (!postId) return new Response(JSON.stringify({ error: '缺少文章ID' }), { status: 400 });

  try {
    const row = await env.DB.prepare('SELECT likes, views FROM stats WHERE article_id = ?').bind(postId).first();
    return new Response(JSON.stringify({ likes: row?.likes || 0, views: row?.views || 0 }));
  } catch (e) {
    return new Response(JSON.stringify({ likes: 0, views: 0 }));
  }
}
