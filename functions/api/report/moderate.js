import { logAdmin, sendSystemMessage } from '../../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const body = await request.json();

  // 批量审核：ids 数组 + status
  if (body.ids && Array.isArray(body.ids)) {
    const ids = body.ids.map(Number).filter(Boolean);
    const s2 = ['approved', 'rejected'].includes(body.status) ? body.status : 'approved';
    let done = 0;
    for (const rid of ids) {
      try {
        await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind(s2, rid).run();
        if (s2 === 'approved') {
          const report = await env.DB.prepare('SELECT user_id, caption FROM reports WHERE id = ?').bind(rid).first();
          if (report) {
            const { results } = await env.DB.prepare("SELECT COUNT(*) as cnt FROM reports WHERE user_id = ? AND status = 'approved' AND id != ?").bind(report.user_id, rid).all();
            const approvedCount = results[0]?.cnt || 0;
            const reward = approvedCount === 0 ? 5 : 10;
            await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(reward, report.user_id).run();
            try {
              await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
              await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(report.user_id, reward, '返图审核通过（第' + (approvedCount + 1) + '张）：' + String(report.caption || '').slice(0, 100)).run();
            } catch(e) {}
            await sendSystemMessage(env, report.user_id, '返图被采纳', '你的返图已通过审核并获得 +' + reward + ' 积分，点击返图墙查看：' + String(report.caption || '').slice(0, 60));
          }
        }
        done++;
      } catch(e) {}
    }
    await logAdmin(env, userId, '返图审核', '批量' + (s2 === 'approved' ? '通过' : '拒绝') + ' ' + done + ' 张');
    return new Response(JSON.stringify({ ok: true, count: done }));
  }

  const { id, status } = body;
  if (!id || !['approved', 'rejected', 'pending'].includes(status)) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });

  // 防重复审核：已 approved 的返图再次提交 approved 直接跳过，不重复加分
  const existing = await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: '返图不存在' }), { status: 404 });
  if (existing.status === 'approved' && status === 'approved') {
    return new Response(JSON.stringify({ ok: true, skipped: true }));
  }
  await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind(status, id).run();
  if (status === 'approved') {
    const report = await env.DB.prepare('SELECT user_id, caption FROM reports WHERE id = ?').bind(id).first();
    if (report) {
      // 第一张+5，之后每张+10：统计本次之前的已通过数量
      const { results } = await env.DB.prepare("SELECT COUNT(*) as cnt FROM reports WHERE user_id = ? AND status = 'approved' AND id != ?").bind(report.user_id, id).all();
      const approvedCount = results[0]?.cnt || 0;
      const reward = approvedCount === 0 ? 5 : 10;
      await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(reward, report.user_id).run();
      try {
        await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
        await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(report.user_id, reward, '返图审核通过（第' + (approvedCount + 1) + '张）：' + String(report.caption || '').slice(0, 100)).run();
      } catch(e) {}
      await sendSystemMessage(env, report.user_id, '返图被采纳', '你的返图已通过审核并获得 +' + reward + ' 积分，点击返图墙查看：' + String(report.caption || '').slice(0, 60));
    }
  }
  await logAdmin(env, userId, '返图审核', (status === 'approved' ? '通过' : '拒绝') + ' 返图 #' + id);
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { results } = await env.DB.prepare(`
    SELECT r.id, r.image_key, r.caption, r.status, r.created_at, u.username
    FROM reports r JOIN users u ON r.user_id = u.id
    WHERE r.status = 'pending'
    ORDER BY r.id DESC
  `).all();
  return new Response(JSON.stringify({ reports: results }));
}
