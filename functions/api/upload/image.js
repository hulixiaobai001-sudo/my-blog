export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const dbUser = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!dbUser) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 403 });

  const { imageBase64 } = await request.json();
  if (!imageBase64) return new Response(JSON.stringify({ error: '缺少图片' }), { status: 400 });

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  if (bytes.length > 5 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '图片过大（最大5MB）' }), { status: 413 });
  }

  // 魔数校验
  const magic = [bytes[0], bytes[1], bytes[2], bytes[3]];
  const isJpeg = magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF;
  const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isJpeg && !isPng && !isWebp) {
    return new Response(JSON.stringify({ error: '文件类型不合法' }), { status: 400 });
  }
  const contentType = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp';

  const imageKey = `cover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.IMAGES_KV.put(imageKey, bytes.buffer, { httpMetadata: { contentType } });

  return new Response(JSON.stringify({ ok: true, key: imageKey, url: '/api/report/view?key=' + imageKey }));
}
