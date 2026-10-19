export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId, isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const formData = await request.formData();
  const file = formData.get('file');
  const caption = formData.get('caption') || '';
  const adminDate = formData.get('admin_date') || new Date().toISOString().slice(0, 10);

  if (!file) return new Response(JSON.stringify({ error: '请选择图片' }), { status: 400 });

  const key = 'admin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  await env.IMAGES_KV.put(key, file.stream(), { httpMetadata: { contentType: file.type } });

  try {
    await env.DB.prepare('INSERT INTO reports (user_id, image_key, caption, status, type, admin_date) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, key, caption, 'approved', 'admin', adminDate).run();
  } catch (e) {
    await env.DB.exec('ALTER TABLE reports ADD COLUMN type TEXT DEFAULT \'user\'');
    try {
      await env.DB.prepare('INSERT INTO reports (user_id, image_key, caption, status, type, admin_date) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, key, caption, 'approved', 'admin', adminDate).run();
    } catch (e2) {
      await env.DB.exec('ALTER TABLE reports ADD COLUMN admin_date TEXT');
      await env.DB.prepare('INSERT INTO reports (user_id, image_key, caption, status, type, admin_date) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, key, caption, 'approved', 'admin', adminDate).run();
    }
  }

  return new Response(JSON.stringify({ ok: true }));
}
