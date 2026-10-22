export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId, isAdmin } = JSON.parse(session);

  const { id } = await request.json();
  if (!id) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  const report = await env.DB.prepare('SELECT image_key, user_id FROM reports WHERE id = ?').bind(id).first();
  if (!report) return new Response(JSON.stringify({ error: '返图不存在' }), { status: 404 });
  // 作者本人可删除自己上传的返图；管理员/站长可删除任意返图
  if (!isAdmin && report.user_id !== userId) {
    return new Response(JSON.stringify({ error: '只能删除自己上传的返图' }), { status: 403 });
  }
  if (report.image_key) {
    try { await env.IMAGES_KV.delete(report.image_key); } catch(e) {}
  }
  await env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ ok: true }));
}
