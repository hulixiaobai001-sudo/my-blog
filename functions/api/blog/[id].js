export async function onRequestGet(context) {
  const { env, params } = context;
  const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND published = 1').bind(params.id).first();
  if (!post) return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404 });
  return new Response(JSON.stringify({ post }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
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
