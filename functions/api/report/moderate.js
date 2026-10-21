export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { isAdmin } = JSON.parse(session);
  if (!isAdmin) return new Response(JSON.stringify({ error: '仅站长可访问' }), { status: 403 });

  const { id, status } = await request.json();
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
    }
  }
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
