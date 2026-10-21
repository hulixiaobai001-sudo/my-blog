import { sanitize } from '../../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { id, reply, close, refund_points } = await request.json();
  const ticket = await env.DB.prepare('SELECT user_id, title, status FROM tickets WHERE id = ?').bind(id).first();
  if (!ticket) return new Response(JSON.stringify({ error: '工单不存在' }), { status: 404 });
  const cleanReply = sanitize(reply, 2000);
  if (close) {
    // 防重复返还：仅当工单此前未关闭时才允许返还，防止反复 close 刷积分
    const wasClosed = ticket.status === 'closed';
    await env.DB.prepare("UPDATE tickets SET reply = ?, status = 'closed', updated_at = datetime('now') WHERE id = ?").bind(cleanReply, id).run();
    if (!wasClosed && refund_points) {
      const pts = parseInt(refund_points);
      if (!isNaN(pts) && pts >= 5 && pts <= 500 && Number.isInteger(pts)) {
        await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(pts, ticket.user_id).run();
        try {
          await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
          await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(ticket.user_id, pts, '工单反馈采纳返还：' + sanitize(ticket.title, 100)).run();
        } catch(e) {}
      }
    }
  } else {
    await env.DB.prepare("UPDATE tickets SET reply = ?, status = 'done', updated_at = datetime('now') WHERE id = ?").bind(cleanReply, id).run();
  }
  return new Response(JSON.stringify({ ok: true }));
}
