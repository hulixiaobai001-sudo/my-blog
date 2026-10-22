import { getLevel, addActivity } from '../_lib.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 30);
  const offset = (page - 1) * pageSize;
  try {
    const where = q
      ? "WHERE show_qq = 1 AND (username LIKE ? OR bio LIKE ?)"
      : "WHERE show_qq = 1";
    const params = q ? ['%' + q + '%', '%' + q + '%'] : [];
    const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM users ' + where).bind(...params).first();
    const total = countRow ? countRow.c : 0;
    const { results } = await env.DB.prepare('SELECT u.id, u.username, u.bio, u.avatar, u.qq, u.points, u.activity, u.role, (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id AND r.status = \'approved\') AS approved_count FROM users u ' + where + ' ORDER BY u.id ASC LIMIT ? OFFSET ?').bind(...params, pageSize, offset).all();
    const list = results.map(u => ({ id: u.id, username: u.username, bio: u.bio, avatar: u.avatar, qq: u.qq, points: u.points || 0, activity: u.activity || 0, level: getLevel(u.activity), role: u.role || '', verified: (u.approved_count || 0) > 0, approved_count: u.approved_count || 0 }));
    return new Response(JSON.stringify({ users: list, total: total, hasMore: offset + results.length < total }));
  } catch (e) {
    return new Response(JSON.stringify({ users: [], total: 0, hasMore: false }));
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  await addActivity(env, userId, 2);
  return new Response(JSON.stringify({ ok: true }));
}
