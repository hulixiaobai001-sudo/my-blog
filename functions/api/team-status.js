// GET: 返回运营成员在线状态
// POST: 管理员切换自己的在线状态 { online: true/false }
export async function onRequestGet(context) {
  const { env } = context;
  try {
    await env.DB.exec("ALTER TABLE users ADD COLUMN online_status INTEGER DEFAULT 0");
  } catch(e) {}
  try {
    const { results } = await env.DB.prepare("SELECT username, qq, online_status FROM users WHERE role IN ('admin','super_admin') OR is_admin = 1").all();
    return new Response(JSON.stringify({ members: (results || []).map(u => ({ username: u.username, qq: String(u.qq || ''), online: !!u.online_status })) }));
  } catch(e) {
    return new Response(JSON.stringify({ members: [] }));
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const body = await request.json();
  try { await env.DB.exec("ALTER TABLE users ADD COLUMN online_status INTEGER DEFAULT 0"); } catch(e) {}
  await env.DB.prepare('UPDATE users SET online_status = ? WHERE id = ?').bind(body.online ? 1 : 0, userId).run();
  return new Response(JSON.stringify({ ok: true }));
}
