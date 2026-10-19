export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { title, content, type } = await request.json();
  if (!title || !content) return new Response(JSON.stringify({ error: '标题和内容不能为空' }), { status: 400 });
  const t = type || 'blog';

  try {
    await env.DB.prepare('INSERT INTO posts (title, content, type) VALUES (?, ?, ?)').bind(title, content, t).run();
  } catch (e) {
    await env.DB.exec('ALTER TABLE posts ADD COLUMN type TEXT DEFAULT \'blog\'');
    await env.DB.prepare('INSERT INTO posts (title, content, type) VALUES (?, ?, ?)').bind(title, content, t).run();
  }
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'blog';
  try {
    const { results } = await env.DB.prepare('SELECT id, title, created_at FROM posts WHERE published = 1 AND type = ? ORDER BY id DESC').bind(type).all();
    return new Response(JSON.stringify({ posts: results }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ posts: [] }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
