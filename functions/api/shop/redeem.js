import { sanitize, checkBanned } from '../../_lib.js';

async function getItemByName(env, itemName) {
  try {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS shop_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, cost INTEGER, desc TEXT DEFAULT '', active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0)");
    const row = await env.DB.prepare('SELECT id, name, cost FROM shop_items WHERE name = ? AND active = 1').bind(String(itemName || '')).first();
    return row || null;
  } catch (e) {
    return null;
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

  // 封禁检查
  const banErr = await checkBanned(env, userId);
  if (banErr) return new Response(JSON.stringify({ error: banErr }), { status: 403 });

  const { itemName } = await request.json();
  const item = await getItemByName(env, itemName);
  if (!itemName || !item) return new Response(JSON.stringify({ error: '商品不存在或已下架' }), { status: 400 });
  const costNum = item.cost;
  const cleanName = sanitize(itemName, 50);

  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, item_name TEXT, cost INTEGER, status TEXT DEFAULT \'pending\', created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    // 原子扣积分：条件更新，不足则changes=0
    const update = await env.DB.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?').bind(costNum, userId, costNum).run();
    if (update.meta.changes === 0) {
      return new Response(JSON.stringify({ error: '积分不足' }), { status: 400 });
    }
    await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, -costNum, '兑换：' + cleanName).run();
    await env.DB.prepare('INSERT INTO redemptions (user_id, item_name, cost) VALUES (?, ?, ?)').bind(userId, cleanName, costNum).run();
  } catch (e) {
    console.error('redeem error', e);
    return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }));
}
