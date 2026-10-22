// 返图点赞：切换点赞状态（登录用户）
export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  const body = await request.json();
  const reportId = parseInt(body.id);
  if (!reportId) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });

  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS report_likes (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')), UNIQUE(report_id, user_id))');
    const existing = await env.DB.prepare('SELECT id FROM report_likes WHERE report_id = ? AND user_id = ?').bind(reportId, userId).first();
    if (existing) {
      await env.DB.prepare('DELETE FROM report_likes WHERE id = ?').bind(existing.id).run();
    } else {
      await env.DB.prepare('INSERT OR IGNORE INTO report_likes (report_id, user_id) VALUES (?, ?)').bind(reportId, userId).run();
    }
    const count = await env.DB.prepare('SELECT COUNT(*) as c FROM report_likes WHERE report_id = ?').bind(reportId).first();
    const liked = !existing;
    return new Response(JSON.stringify({ ok: true, likes: count ? count.c : 0, liked: liked }));
  } catch (e) {
    return new Response(JSON.stringify({ error: '操作失败' }), { status: 500 });
  }
}
