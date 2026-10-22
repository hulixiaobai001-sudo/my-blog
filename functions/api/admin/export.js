import { logAdmin } from '../../_lib.js';

// 数据导出：CSV 下载（站长）type=users|guestbook|reports|tickets
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!me || me.role !== 'super_admin') return new Response(JSON.stringify({ error: '仅站长可导出' }), { status: 403 });

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'users';
  let rows = [];
  let headers = [];
  const esc = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';

  try {
    if (type === 'users') {
      headers = ['id', 'username', 'role', 'points', 'banned', 'ban_until', 'created_at'];
      rows = (await env.DB.prepare('SELECT id, username, role, points, banned, ban_until, created_at FROM users ORDER BY id').all()).results;
    } else if (type === 'guestbook') {
      headers = ['id', 'user_id', 'content', 'status', 'is_anonymous', 'reply_to', 'created_at'];
      rows = (await env.DB.prepare('SELECT id, user_id, content, status, is_anonymous, reply_to, created_at FROM guestbook ORDER BY id').all()).results;
    } else if (type === 'reports') {
      headers = ['id', 'user_id', 'image_key', 'caption', 'status', 'created_at'];
      rows = (await env.DB.prepare('SELECT id, user_id, image_key, caption, status, created_at FROM reports ORDER BY id').all()).results;
    } else if (type === 'tickets') {
      headers = ['id', 'user_id', 'title', 'content', 'status', 'created_at'];
      rows = (await env.DB.prepare('SELECT id, user_id, title, content, status, created_at FROM tickets ORDER BY id').all()).results;
    } else {
      return new Response(JSON.stringify({ error: '未知类型' }), { status: 400 });
    }
  } catch (e) {
    rows = [];
  }

  let csv = '\ufeff' + headers.map(esc).join(',') + '\n';
  for (const r of rows) {
    csv += headers.map(h => esc(r[h])).join(',') + '\n';
  }
  await logAdmin(env, userId, '数据导出', '导出 ' + type + ' 共 ' + rows.length + ' 条');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + type + '_' + new Date().toISOString().slice(0, 10) + '.csv"'
    }
  });
}
