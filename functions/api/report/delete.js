export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { id } = await request.json();
  const report = await env.DB.prepare('SELECT image_key FROM reports WHERE id = ?').bind(id).first();
  if (report) {
    await env.IMAGES_KV.delete(report.image_key);
  }
  await env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ ok: true }));
}
