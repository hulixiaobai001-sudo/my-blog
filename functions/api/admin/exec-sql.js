export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/session=([^;]+)/);
  if (!m) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${m[1]}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  const s = JSON.parse(sess);
  if (!s.isAdmin) return Response.json({ error: '无权限' }, { status: 403 });

  const body = await request.json();
  const sql = body.sql;
  if (!sql) return Response.json({ error: '缺少sql' }, { status: 400 });
  const result = await env.DB.exec(sql);
  return Response.json({ ok: true, result });
}
