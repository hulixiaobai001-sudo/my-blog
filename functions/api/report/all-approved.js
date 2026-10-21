export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/session=([^;]+)/);
  if (!m) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${m[1]}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const s = JSON.parse(sess);
  if (!s.isAdmin) return Response.json({ error: '无权限' }, { status: 403 });

  const { results } = await env.DB.prepare(`
    SELECT id, image_key, caption, status, created_at, type, note, featured
    FROM reports WHERE status = 'approved' ORDER BY id DESC
  `).all();
  return Response.json({ reports: results });
}
