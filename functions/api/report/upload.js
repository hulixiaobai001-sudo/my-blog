export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  const { imageBase64, caption } = await request.json();
  if (!imageBase64) return new Response(JSON.stringify({ error: '缺少图片' }), { status: 400 });

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

  if (imageBuffer.length > 500 * 1024) {
    return new Response(JSON.stringify({ error: '图片过大，请压缩后上传（<500KB）' }), { status: 400 });
  }

  const imageKey = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.IMAGES_KV.put(imageKey, imageBuffer, { httpMetadata: { contentType: 'image/jpeg' } });

  await env.DB.prepare('INSERT INTO reports (user_id, image_key, caption) VALUES (?, ?, ?)')
    .bind(userId, imageKey, caption || '').run();

  return new Response(JSON.stringify({ ok: true, key: imageKey }));
}
