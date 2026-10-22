import { sanitize } from '../../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  // 封禁检查
  const banErr = await checkBanned(env, userId);
  if (banErr) return new Response(JSON.stringify({ error: banErr }), { status: 403 });

  // 频率限制：每天3次
  const today = new Date().toISOString().slice(0, 10);
  const rateKey = `rate:ticket:${userId}:${today}`;
  const todayCount = parseInt(await env.AUTH_KV.get(rateKey) || '0');
  if (todayCount >= 3) return new Response(JSON.stringify({ error: '今天工单已达3次上限，明天再来' }), { status: 429 });

  const { title, content } = await request.json();
  if (!title || !content) return new Response(JSON.stringify({ error: '标题和内容不能为空' }), { status: 400 });
  const cleanTitle = sanitize(title, 100);
  const cleanContent = sanitize(content, 2000);

  try { await env.DB.exec("CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, content TEXT, reply TEXT DEFAULT '', status TEXT DEFAULT 'open', created_at TEXT, updated_at TEXT, deducted INTEGER DEFAULT 0, result TEXT DEFAULT '', points_adjust INTEGER, reviewer_id INTEGER DEFAULT 0, archive_no TEXT DEFAULT '')"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE tickets ADD COLUMN deducted INTEGER DEFAULT 0"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE tickets ADD COLUMN result TEXT DEFAULT ''"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE tickets ADD COLUMN points_adjust INTEGER"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE tickets ADD COLUMN reviewer_id INTEGER DEFAULT 0"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE tickets ADD COLUMN archive_no TEXT DEFAULT ''"); } catch(e) {}

  await env.DB.prepare('INSERT INTO tickets (user_id, title, content, deducted) VALUES (?, ?, ?, 0)').bind(userId, cleanTitle, cleanContent).run();

  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    // 扣分不允许为负：积分不足时跳过扣分（工单仍提交），并记录实际扣除 deduct 以便关闭时原样返还
    const update = await env.DB.prepare('UPDATE users SET points = points - 10 WHERE id = ? AND points >= 10').bind(userId).run();
    if (update.meta.changes > 0) {
      await env.DB.prepare("UPDATE tickets SET deducted = 10 WHERE id = (SELECT MAX(id) FROM tickets WHERE user_id = ?)").bind(userId).run();
      await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, -10, '提交工单：' + cleanTitle).run();
    }
  } catch(e) {
    const update = await env.DB.prepare('UPDATE users SET points = points - 10 WHERE id = ? AND points >= 10').bind(userId).run();
    if (update.meta.changes > 0) {
      await env.DB.prepare("UPDATE tickets SET deducted = 10 WHERE id = (SELECT MAX(id) FROM tickets WHERE user_id = ?)").bind(userId).run();
      await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, -10, '提交工单：' + cleanTitle).run();
    }
  }
  await env.AUTH_KV.put(rateKey, String(todayCount + 1), { expirationTtl: 86400 * 2 });
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId, isAdmin } = JSON.parse(session);

  const base = `
    SELECT t.*, u.username AS submitter,
      r.username AS reviewer_name, r.role AS reviewer_role
    FROM tickets t
    JOIN users u ON t.user_id = u.id
    LEFT JOIN users r ON t.reviewer_id = r.id
  `;

  if (isAdmin) {
    const pending = await env.DB.prepare(base + ` WHERE t.status != 'closed' ORDER BY t.id DESC`).all();
    const closed = await env.DB.prepare(base + ` WHERE t.status = 'closed' ORDER BY t.id DESC`).all();
    return new Response(JSON.stringify({ pending: pending.results || [], closed: closed.results || [] }));
  } else {
    const { results } = await env.DB.prepare(base + ' WHERE t.user_id = ? ORDER BY t.id DESC').bind(userId).all();
    return new Response(JSON.stringify({ tickets: results || [] }));
  }
}
