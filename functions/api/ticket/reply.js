import { sanitize, logAdmin, sendSystemMessage } from '../../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId, isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅运营成员可处理工单' }), { status: 403 });

  const { id, reply, close, result, points } = await request.json();
  const ticket = await env.DB.prepare('SELECT user_id, title, status, deducted, points_adjust FROM tickets WHERE id = ?').bind(id).first();
  if (!ticket) return new Response(JSON.stringify({ error: '工单不存在' }), { status: 404 });
  const cleanReply = sanitize(reply, 2000);

  if (close) {
    // 防重复调分：仅工单首次关闭时才允许积分调整，重复关闭只更新回复
    const wasClosed = ticket.status === 'closed';
    let pts = 0;
    if (!wasClosed) {
      pts = parseInt(points);
      if (isNaN(pts)) pts = 0;
      pts = Math.max(-500, Math.min(500, pts));
      if (pts !== 0) {
        try { await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))'); } catch(e) {}
        if (pts > 0) {
          await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(pts, ticket.user_id).run();
        } else {
          // 扣分最低到 0，不出现负积分
          await env.DB.prepare('UPDATE users SET points = MAX(points + ?, 0) WHERE id = ?').bind(pts, ticket.user_id).run();
        }
        const label = pts > 0 ? '工单奖励' : '工单扣分';
        await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(ticket.user_id, pts, label + '（' + sanitize(ticket.title, 100) + '）').run();
      }
    }
    const resultVal = ['none', 'fixed', 'useful', 'malicious'].includes(result) ? result : '';
    const archiveNo = 'T-' + String(id).padStart(5, '0');
    if (wasClosed) {
      // 已关闭的工单再次操作：仅更新回复，不改积分与审核信息
      await env.DB.prepare("UPDATE tickets SET reply = ?, updated_at = datetime('now') WHERE id = ?").bind(cleanReply, id).run();
    } else {
      await env.DB.prepare("UPDATE tickets SET reply = ?, status = 'closed', result = ?, points_adjust = ?, reviewer_id = ?, archive_no = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(cleanReply, resultVal, pts, userId, archiveNo, id).run();
    }
    const resultLabel = resultVal === 'fixed' ? '已处理' : (resultVal === 'useful' ? '建议采纳' : (resultVal === 'malicious' ? '恶意工单' : '无需处理'));
    if (!wasClosed) {
      await logAdmin(env, userId, '处理工单', '关闭工单 #' + id + '（' + resultLabel + '，积分 ' + (pts >= 0 ? '+' : '') + pts + '）');
      await sendSystemMessage(env, ticket.user_id, '工单已处理', '你的工单「' + sanitize(ticket.title, 60) + '」已处理完成（' + resultLabel + '，积分调整 ' + (pts >= 0 ? '+' : '') + pts + '），档案编号 ' + archiveNo);
    }
    return new Response(JSON.stringify({ ok: true, points_adjust: wasClosed ? (ticket.points_adjust || 0) : pts }));
  } else {
    await env.DB.prepare("UPDATE tickets SET reply = ?, status = 'done', updated_at = datetime('now') WHERE id = ?").bind(cleanReply, id).run();
    return new Response(JSON.stringify({ ok: true }));
  }
}
