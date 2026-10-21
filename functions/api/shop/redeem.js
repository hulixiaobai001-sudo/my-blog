import { sanitize } from '../../_lib.js';

// 服务端定价表：兑换价格以服务端为准，不接受客户端传入
const ITEM_PRICES = [
  { match: '奶茶', cost: 1000 },
  { match: '周边', cost: 1500 }
];

function getPrice(itemName) {
  const name = String(itemName || '');
  for (const item of ITEM_PRICES) {
    if (name.includes(item.match)) return item.cost;
  }
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  const { itemName } = await request.json();
  const costNum = getPrice(itemName);
  if (!itemName || costNum === null) return new Response(JSON.stringify({ error: '商品不存在' }), { status: 400 });
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
