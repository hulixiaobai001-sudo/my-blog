// 我的站内信
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${token}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const { userId } = JSON.parse(sess);
  const { results } = await env.DB.prepare('SELECT id, title, content, read, created_at FROM messages WHERE user_id = ? ORDER BY id DESC').bind(userId).all();
  return Response.json({ messages: results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${token}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const { userId } = JSON.parse(sess);
  const { id } = await request.json();
  await env.DB.prepare('UPDATE messages SET read = 1 WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return Response.json({ ok: true });
}
