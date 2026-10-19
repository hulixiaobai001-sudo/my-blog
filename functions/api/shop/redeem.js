export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  const { itemName, cost } = await request.json();
  const costNum = parseInt(cost);
  if (!itemName || !costNum || costNum <= 0) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });

  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, item_name TEXT, cost INTEGER, status TEXT DEFAULT \'pending\', created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    await env.DB.exec('CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    // 原子扣积分：条件更新，不足则changes=0
    const update = await env.DB.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?').bind(costNum, userId, costNum).run();
    if (update.meta.changes === 0) {
      return new Response(JSON.stringify({ error: '积分不足' }), { status: 400 });
    }
    await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, -costNum, '兑换：' + itemName).run();
    await env.DB.prepare('INSERT INTO redemptions (user_id, item_name, cost) VALUES (?, ?, ?)').bind(userId, itemName, costNum).run();
  } catch (e) {
    console.error('redeem error', e);
    return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }));
}
