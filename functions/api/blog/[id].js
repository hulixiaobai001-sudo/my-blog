export async function onRequestGet(context) {
  const { env, params } = context;
  const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND published = 1').bind(params.id).first();
  if (!post) return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404 });
  return new Response(JSON.stringify({ post }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
