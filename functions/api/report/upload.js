export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  // 封禁检查
  const bannedUser = await env.DB.prepare('SELECT banned FROM users WHERE id = ?').bind(userId).first();
  if (bannedUser && bannedUser.banned) return new Response(JSON.stringify({ error: '账号已被封禁' }), { status: 403 });

  // 频率限制：每天5次
  const today = new Date().toISOString().slice(0, 10);
  const rateKey = `rate:report:${userId}:${today}`;
  const todayCount = parseInt(await env.AUTH_KV.get(rateKey) || '0');
  if (todayCount >= 5) return new Response(JSON.stringify({ error: '今天返图已达5次上限，明天再来' }), { status: 429 });

  const { imageBase64, caption } = await request.json();
  if (!imageBase64) return new Response(JSON.stringify({ error: '缺少图片' }), { status: 400 });

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  if (bytes.length > 500 * 1024) {
    return new Response(JSON.stringify({ error: '图片过大，请压缩后上传（<500KB）' }), { status: 400 });
  }

  // 魔数校验：仅允许 JPEG/PNG/WebP/GIF，防止伪装成图片的任意文件
  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  if (!(isJpeg || isPng || isWebp || isGif)) {
    return new Response(JSON.stringify({ error: '仅支持 JPG/PNG/WebP/GIF 图片' }), { status: 400 });
  }
  const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/gif';

  const imageKey = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.IMAGES_KV.put(imageKey, bytes.buffer, { httpMetadata: { contentType: mime } });

  await env.DB.prepare('INSERT INTO reports (user_id, image_key, caption) VALUES (?, ?, ?)')
    .bind(userId, imageKey, sanitize(caption, 200)).run();
  await env.AUTH_KV.put(rateKey, String(todayCount + 1), { expirationTtl: 86400 * 2 });

  return new Response(JSON.stringify({ ok: true, key: imageKey }));
}
