// 读取隐私政策版本（公开）
export async function onRequestGet(context) {
  const { env } = context;
  const ver = await env.AUTH_KV.get('privacy_ver');
  const note = await env.AUTH_KV.get('privacy_note');
  return Response.json({ version: ver || '2026-10-20', note: note || '' });
}

// 设置隐私政策版本（仅admin）
export async function onRequestPost(context) {
  const { request, env } = context;

  // 校验登录和admin
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/session=([^;]+)/);
  if (!m) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${m[1]}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const s = JSON.parse(sess);
  if (!s.isAdmin) return Response.json({ error: '无权限' }, { status: 403 });

  const body = await request.json();
  if (body.version) await env.AUTH_KV.put('privacy_ver', body.version);
  if (body.note !== undefined) await env.AUTH_KV.put('privacy_note', body.note);
  return Response.json({ ok: true });
}
