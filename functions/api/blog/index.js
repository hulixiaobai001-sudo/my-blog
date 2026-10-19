export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { title, content, type, category } = await request.json();
  if (!title || !content) return new Response(JSON.stringify({ error: '标题和内容不能为空' }), { status: 400 });
  const t = type || 'blog';
  const cat = category || '';

  try {
    await env.DB.prepare('INSERT INTO posts (title, content, type, category) VALUES (?, ?, ?, ?)').bind(title, content, t, cat).run();
  } catch (e) {
    await env.DB.exec('ALTER TABLE posts ADD COLUMN type TEXT DEFAULT \'blog\'');
    try {
      await env.DB.prepare('INSERT INTO posts (title, content, type, category) VALUES (?, ?, ?, ?)').bind(title, content, t, cat).run();
    } catch (e2) {
      await env.DB.exec('ALTER TABLE posts ADD COLUMN category TEXT DEFAULT \'\'');
      await env.DB.prepare('INSERT INTO posts (title, content, type, category) VALUES (?, ?, ?, ?)').bind(title, content, t, cat).run();
    }
  }
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'blog';
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const limit = 10;
  try {
    const { results } = await env.DB.prepare('SELECT id, title, category, created_at FROM posts WHERE published = 1 AND (type = ? OR type IS NULL) ORDER BY id DESC LIMIT ? OFFSET ?').bind(type, limit, offset).all();
    return new Response(JSON.stringify({ posts: results, has_more: results.length === limit }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ posts: [], has_more: false }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
