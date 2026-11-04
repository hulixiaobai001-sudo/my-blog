import { sanitize, checkBanned } from '../../_lib.js';
import { payClient, hasPay, ensurePayTables, bizKey, normalizeAccess, normalizeUsage } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function getItemByName(env, itemName) {
  try {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS shop_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, cost INTEGER, desc TEXT DEFAULT '', active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0)");
    const row = await env.DB.prepare('SELECT id, name, cost FROM shop_items WHERE name = ? AND active = 1').bind(String(itemName || '')).first();
    return row || null;
  } catch (e) {
    return null;
  }
}

async function ensureRedeemTables(env) {
  await env.DB.exec("CREATE TABLE IF NOT EXISTS redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, item_name TEXT, cost INTEGER, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now','localtime')))");
  await env.DB.exec("CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
}

// 交付：写兑换单（已确认扣减后才会走到这里；重复调用不重复建单）
async function deliver(env, row) {
  if (row.redemption_id) return row.redemption_id;
  await ensureRedeemTables(env);
  const ins = await env.DB.prepare('INSERT INTO redemptions (user_id, item_name, cost) VALUES (?, ?, ?)')
    .bind(row.user_id, row.item_name, row.amount).run();
  const rid = ins.meta && ins.meta.last_row_id ? ins.meta.last_row_id : 0;
  await env.DB.prepare("UPDATE pay_consumptions SET delivered = 1, redemption_id = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(rid, row.id).run();
  return rid;
}

// 用赞助额度支付：先查 access 判断额度，再正式 consume；业务号先落库，重试复用同一个号
async function payWithQuota(env, userId, cost, itemName, actionId) {
  const pay = payClient(env);
  if (!pay) return { mode: 'none' };

  await ensurePayTables(env);

  if (actionId) {
    const prev = await env.DB.prepare('SELECT * FROM pay_consumptions WHERE user_id = ? AND client_action_id = ?')
      .bind(userId, actionId).first();
    if (prev) {
      if (prev.status === 'SUCCEEDED') {
        if (!prev.delivered) await deliver(env, prev);
        return { mode: 'paid', redemptionId: prev.redemption_id || 0, resumed: true };
      }
      if (prev.status === 'FAILED') {
        return { mode: 'failed', message: '上次核销失败，请重新发起兑换' };
      }
      // CREATED / UNKNOWN：查原核销，不换号重扣
      try {
        const c = normalizeUsage(await pay.consumption(userId, prev.idempotency_key));
        if (c && c.status === 'SUCCEEDED' && c.confirmed && c.consumed === prev.amount) {
          await env.DB.prepare("UPDATE pay_consumptions SET status = 'SUCCEEDED', updated_at = datetime('now') WHERE id = ?").bind(prev.id).run();
          await deliver(env, prev);
          return { mode: 'paid', redemptionId: prev.redemption_id || 0, resumed: true };
        }
        if (c && c.status === 'FAILED') {
          await env.DB.prepare("UPDATE pay_consumptions SET status = 'FAILED', updated_at = datetime('now') WHERE id = ?").bind(prev.id).run();
          return { mode: 'failed', message: '额度核销未成功，请重试' };
        }
      } catch (e) {}
      return { mode: 'pending', message: '上一次核销处理中，请稍后刷新查看结果' };
    }
  }

  let access;
  try { access = normalizeAccess(await pay.access(userId, cost)); } catch (e) { return { mode: 'none' }; }

  const unitOk = !access.quotaUnit || access.quotaUnit === 'POINT';
  const remain = typeof access.remaining === 'number' ? access.remaining : 0;
  if (!unitOk || access.granted !== true || remain < cost) {
    return { mode: 'insufficient', remaining: remain };
  }

  const key = bizKey('redeem', userId);
  await env.DB.prepare(`INSERT INTO pay_consumptions (user_id, idempotency_key, client_action_id, item_name, amount, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, 'CREATED')`)
    .bind(userId, key, actionId || ('auto-' + key), itemName, cost, '兑换：' + itemName).run();
  const row = await env.DB.prepare('SELECT * FROM pay_consumptions WHERE idempotency_key = ?').bind(key).first();

  let c;
  try {
    c = await pay.consume({ userId: userId, idempotencyKey: key, amount: cost, reason: '兑换：' + itemName });
  } catch (e) {
    await env.DB.prepare("UPDATE pay_consumptions SET status = 'UNKNOWN', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
    return { mode: 'pending', actionId: row.client_action_id, message: '核销结果未确认，请稍后刷新（不会重复扣减）' };
  }

  const n = normalizeUsage(c) || {};
  if (n.status === 'SUCCEEDED' && n.confirmed && n.consumed === cost && (!n.quotaUnit || n.quotaUnit === 'POINT')) {
    await env.DB.prepare("UPDATE pay_consumptions SET status = 'SUCCEEDED', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
    await deliver(env, row);
    return { mode: 'paid', redemptionId: row.redemption_id || 0 };
  }
  if (n.status === 'FAILED') {
    await env.DB.prepare("UPDATE pay_consumptions SET status = 'FAILED', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
    return { mode: 'failed', message: '额度核销未成功，请重试' };
  }
  await env.DB.prepare("UPDATE pay_consumptions SET status = 'UNKNOWN', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
  return { mode: 'pending', actionId: row.client_action_id, message: '核销处理中，请稍后刷新' };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return json({ error: '未登录' }, 401);

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return json({ error: '登录已过期' }, 401);
  const { userId } = JSON.parse(session);

  const banErr = await checkBanned(env, userId);
  if (banErr) return json({ error: banErr }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '参数错误' }, 400); }
  const { itemName } = body;
  const actionId = String(body.actionId || '').slice(0, 64);
  const item = await getItemByName(env, itemName);
  if (!itemName || !item) return json({ error: '商品不存在或已下架' }, 400);
  const costNum = item.cost;
  const cleanName = sanitize(itemName, 50);

  // 1) 优先站内积分（原子条件扣减）：赞助额度可按 1:5 折算成积分，先用积分更划算
  try {
    await ensureRedeemTables(env);
    const update = await env.DB.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?').bind(costNum, userId, costNum).run();
    if (update.meta.changes > 0) {
      await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)').bind(userId, -costNum, '兑换：' + cleanName).run();
      await env.DB.prepare('INSERT INTO redemptions (user_id, item_name, cost) VALUES (?, ?, ?)').bind(userId, cleanName, costNum).run();
      return json({ ok: true, mode: 'points' });
    }
  } catch (e) {}

  // 2) 积分不足时用支付宝购买的赞助额度直接抵扣（正式 consume 成功才交付）
  if (hasPay(env)) {
    const r = await payWithQuota(env, userId, costNum, cleanName, actionId);
    if (r.mode === 'paid') return json({ ok: true, mode: 'paid', redemptionId: r.redemptionId || 0, resumed: !!r.resumed });
    if (r.mode === 'pending') return json({ ok: false, pending: true, actionId: r.actionId || actionId, error: r.message }, 202);
    if (r.mode === 'failed') return json({ ok: false, error: r.message }, 409);
  }

  return json({ error: '积分不足，可前往赞赏页购买赞助额度，或在赞赏页把额度按 1:5 兑换成积分', needTopup: true }, 400);
}
