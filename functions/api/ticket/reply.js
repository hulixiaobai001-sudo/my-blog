export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '鏈櫥褰? }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '鐧诲綍宸茶繃鏈? }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '鏃犳潈闄? }), { status: 403 });

  const { id, reply } = await request.json();
  await env.DB.prepare("UPDATE tickets SET reply = ?, status = 'closed', updated_at = datetime('now') WHERE id = ?").bind(reply, id).run();
  return new Response(JSON.stringify({ ok: true }));
}
