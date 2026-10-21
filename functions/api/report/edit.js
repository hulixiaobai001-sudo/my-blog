export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/session=([^;]+)/);
  if (!m) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${m[1]}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const s = JSON.parse(sess);
  if (!s.isAdmin) return Response.json({ error: '无权限' }, { status: 403 });

  const body = await request.json();
  const { id, note, type, featured } = body;
  if (!id) return Response.json({ error: '缺少id' }, { status: 400 });

  try {
    if (note !== undefined) await env.DB.prepare('UPDATE reports SET note = ? WHERE id = ?').bind(note, id).run();
    if (type !== undefined) await env.DB.prepare('UPDATE reports SET type = ? WHERE id = ?').bind(type, id).run();
    if (featured !== undefined) await env.DB.prepare('UPDATE reports SET featured = ? WHERE id = ?').bind(featured ? 1 : 0, id).run();
    return Response.json({ ok: true });
  } catch(e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
