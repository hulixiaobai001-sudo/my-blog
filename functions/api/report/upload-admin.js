import { sanitize } from '../../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId, isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const caption = sanitize(formData.get('caption') || '', 200);
    const adminDate = formData.get('admin_date') || new Date().toISOString().slice(0, 10);

    if (!file) return new Response(JSON.stringify({ error: '请选择图片' }), { status: 400 });

    const key = 'admin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // 魔数校验：仅允许 JPEG/PNG/WebP/GIF
    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    if (!(isJpeg || isPng || isWebp || isGif)) {
      return new Response(JSON.stringify({ error: '仅支持 JPG/PNG/WebP/GIF 图片' }), { status: 400 });
    }
    const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/gif';

    await env.IMAGES_KV.put(key, buf, { httpMetadata: { contentType: mime } });

    try {
      await env.DB.prepare('INSERT INTO reports (user_id, image_key, caption, status, type, admin_date) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, key, caption, 'approved', 'admin', adminDate).run();
    } catch (e) {
      await env.DB.exec("ALTER TABLE reports ADD COLUMN type TEXT DEFAULT 'user'");
      await env.DB.exec("ALTER TABLE reports ADD COLUMN admin_date TEXT");
      await env.DB.prepare('INSERT INTO reports (user_id, image_key, caption, status, type, admin_date) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, key, caption, 'approved', 'admin', adminDate).run();
    }

    return new Response(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error('upload-admin error', e);
    return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500 });
  }
}
