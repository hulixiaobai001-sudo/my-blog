export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '鏈櫥褰? }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '鐧诲綍宸茶繃鏈? }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '鏃犳潈闄? }), { status: 403 });

  const { id, status } = await request.json();
  await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind(status, id).run();
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '鏈櫥褰? }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '鐧诲綍宸茶繃鏈? }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '鏃犳潈闄? }), { status: 403 });

  const { results } = await env.DB.prepare(`
    SELECT r.id, r.image_key, r.caption, r.status, r.created_at, u.username
    FROM reports r JOIN users u ON r.user_id = u.id
    ORDER BY r.id DESC LIMIT 100
  `).all();
  return new Response(JSON.stringify({ reports: results }));
}
