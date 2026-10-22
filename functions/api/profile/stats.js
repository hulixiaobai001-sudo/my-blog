import { getLevel } from '../../_lib.js';

// 个人档案统计：昵称/头像/等级进度/返图数/留言数/工单数/注册天数
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  try {
    await env.DB.exec("ALTER TABLE users ADD COLUMN activity INTEGER DEFAULT 0"); 
  } catch (e) {}
  try {
    const me = await env.DB.prepare('SELECT id, username, avatar, points, activity, created_at, banned, ban_until FROM users WHERE id = ?').bind(userId).first();
    if (!me) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
    const activity = me.activity || 0;
    const level = getLevel(activity);
    const thresholds = [0, 50, 200, 600, 1500];
    const next = level < 5 ? thresholds[level] : null;
    const prev = thresholds[level - 1];
    const progress = next ? Math.min(100, Math.round(((activity - prev) / (next - prev)) * 100)) : 100;

    let reports = 0, guestbooks = 0, tickets = 0, likesReceived = 0;
    try {
      reports = (await env.DB.prepare("SELECT COUNT(*) as c FROM reports WHERE user_id = ? AND status = 'approved'").bind(userId).first()).c || 0;
    } catch(e) {}
    try {
      guestbooks = (await env.DB.prepare('SELECT COUNT(*) as c FROM guestbook WHERE user_id = ?').bind(userId).first()).c || 0;
    } catch(e) {}
    try {
      tickets = (await env.DB.prepare('SELECT COUNT(*) as c FROM tickets WHERE user_id = ?').bind(userId).first()).c || 0;
    } catch(e) {}
    try {
      await env.DB.exec('CREATE TABLE IF NOT EXISTS report_likes (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')), UNIQUE(report_id, user_id))');
      likesReceived = (await env.DB.prepare('SELECT COUNT(*) as c FROM report_likes WHERE report_id IN (SELECT id FROM reports WHERE user_id = ?)').bind(userId).first()).c || 0;
    } catch(e) {}

    const created = me.created_at ? new Date(String(me.created_at).replace(' ', 'T') + 'Z') : new Date();
    const regDays = Math.max(1, Math.floor((Date.now() - created.getTime()) / 86400000));

    return new Response(JSON.stringify({
      username: me.username,
      avatar: me.avatar,
      points: me.points || 0,
      activity: activity,
      level: level,
      next_level_points: next,
      prev_level_points: prev,
      progress: progress,
      reports: reports,
      guestbooks: guestbooks,
      tickets: tickets,
      likes_received: likesReceived,
      reg_days: regDays,
      banned: me.banned,
      ban_until: me.ban_until
    }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '加载失败' }), { status: 500 });
  }
}
