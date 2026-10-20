// 行程时间线：公开读取
export async function onRequestGet(context) {
  const { env } = context;
  const trips = await env.AUTH_KV.get('about_trips', { type: 'json' });
  if (!trips) {
    return Response.json({ trips: [
      { date: '2026.10.19 — 待定', event: '上学中' },
      { date: '2027.2.10', event: '绒兽汇' }
    ]});
  }
  return Response.json({ trips });
}

// admin保存
export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${token}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  if (!JSON.parse(sess).isAdmin) return Response.json({ error: '无权限' }, { status: 403 });
  const body = await request.json();
  await env.AUTH_KV.put('about_trips', JSON.stringify(body.trips));
  return Response.json({ ok: true });
}
