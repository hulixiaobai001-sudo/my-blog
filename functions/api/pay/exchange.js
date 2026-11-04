import { checkBanned } from '../../_lib.js';
import { payClient, hasPay, getLoginUser, ensurePayTables, bizKey, normalizeAccess, normalizeUsage } from '../../_pay.js';

const RATE = 5;           // 1 点赞助额度 = 5 点站内积分
const ITEM = '站内积分';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function ensureTables(env) {
  try {
    await env.DB.prepare('SELECT 1 FROM points_log LIMIT 1').first();
  } catch (e) {
    try {
      await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))")
      ]);
    } catch (e2) {}
  }
}

// 记账：先加积分再标记已交付；重复调用靠 delivered 位拦，不会加两次
async function credit(env, row) {
  if (row.delivered) {
    const u = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(row.user_id).first();
    return { points: row.amount * RATE, totalPoints: u ? u.points : null, resumed: true };
  }
  await ensureTables(env);
  const pts = row.amount * RATE;
  const up = await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(pts, row.user_id).run();
  if (!up.meta || up.meta.changes === 0) {
    throw new Error('积分账户不存在');
  }
  await env.DB.prepare('INSERT INTO points_log (user_id, amount, reason) VALUES (?, ?, ?)')
    .bind(row.user_id, pts, '赞助额度兑换（1 点 = ' + RATE + ' 积分）').run();
  await env.DB.prepare("UPDATE pay_consumptions SET delivered = 1, updated_at = datetime('now') WHERE id = ?")
    .bind(row.id).run();
  const u = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(row.user_id).first();
  return { points: pts, totalPoints: u ? u.points : null };
}

// POST /api/pay/exchange —— 赞助额度折算站内积分（1:5），额度随之减少
export async function onRequestPost(context) {
  try { return await handle(context); }
  catch (e) { return json({ ok: false, error: '兑换异常，请稍后重试' }, 500); }
}

async function handle(context) {
  const { request, env } = context;
  if (!hasPay(env)) return json({ ok: false, error: '赞赏通道未配置' }, 503);

  const user = await getLoginUser(env, request);
  if (!user) return json({ ok: false, error: '请先登录' }, 401);

  const banErr = await checkBanned(env, user.userId);
  if (banErr) return json({ ok: false, error: banErr }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '参数错误' }, 400); }
  const actionId = String(body.actionId || '').slice(0, 64);
  if (!actionId) return json({ ok: false, error: '缺少业务编号' }, 400);

  await ensurePayTables(env);
  const pay = payClient(env);

  // 1) 同一业务编号重试：不换号、不重复扣额度、不重复加积分
  const prev = await env.DB.prepare('SELECT * FROM pay_consumptions WHERE user_id = ? AND client_action_id = ?')
    .bind(user.userId, actionId).first();
  if (prev) {
    if (prev.status === 'SUCCEEDED') {
      try {
        const r = await credit(env, prev);
        return json({ ok: true, mode: 'exchanged', exchanged: prev.amount, points: r.points, totalPoints: r.totalPoints, resumed: true });
      } catch (e) {
        return json({ ok: false, error: '积分入账失败，请联系站长处理（额度已扣减，不会重复扣）' }, 500);
      }
    }
    if (prev.status === 'FAILED') return json({ ok: false, error: '上次兑换失败，请重新发起' }, 409);
    try {
      const c = normalizeUsage(await pay.consumption(user.userId, prev.idempotency_key));
      if (c && c.status === 'SUCCEEDED' && c.confirmed && c.consumed === prev.amount) {
        await env.DB.prepare("UPDATE pay_consumptions SET status = 'SUCCEEDED', updated_at = datetime('now') WHERE id = ?").bind(prev.id).run();
        prev.status = 'SUCCEEDED';
        const r = await credit(env, prev);
        return json({ ok: true, mode: 'exchanged', exchanged: prev.amount, points: r.points, totalPoints: r.totalPoints, resumed: true });
      }
      if (c && c.status === 'FAILED') {
        await env.DB.prepare("UPDATE pay_consumptions SET status = 'FAILED', updated_at = datetime('now') WHERE id = ?").bind(prev.id).run();
        return json({ ok: false, error: '额度扣减未成功，请重试' }, 409);
      }
    } catch (e) {}
    return json({ ok: false, pending: true, error: '上一次兑换处理中，请稍后刷新' }, 202);
  }

  // 2) 读当前额度（服务端 access 是唯一口径）
  let access;
  try { access = normalizeAccess(await pay.access(user.userId, 1)); }
  catch (e) { return json({ ok: false, error: '额度查询失败，请稍后重试' }, 502); }

  if (access.quotaUnit && access.quotaUnit !== 'POINT') {
    return json({ ok: false, error: '当前额度单位不支持折算' }, 400);
  }
  const remaining = typeof access.remaining === 'number' ? access.remaining : 0;
  if (access.granted !== true || remaining <= 0) {
    return json({ ok: false, error: '暂无可兑换的赞助额度', needTopup: true, remaining: remaining }, 400);
  }

  let amount = parseInt(body.amount, 10);
  if (!amount || amount < 1) amount = remaining;
  amount = Math.min(amount, remaining);
  if (amount < 1) return json({ ok: false, error: '兑换数量不合法' }, 400);

  // 3) 先落库再核销，异常一律留 UNKNOWN 让用户同号重试
  const key = bizKey('exch', user.userId);
  try {
    await env.DB.prepare(`INSERT INTO pay_consumptions (user_id, idempotency_key, client_action_id, item_name, amount, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, 'CREATED')`)
      .bind(user.userId, key, actionId, ITEM, amount, '兑换：' + ITEM).run();
  } catch (e) {
    return json({ ok: false, error: '兑换记录创建失败，请重试' }, 500);
  }
  const row = await env.DB.prepare('SELECT * FROM pay_consumptions WHERE idempotency_key = ?').bind(key).first();

  let c;
  try {
    c = await pay.consume({ userId: user.userId, idempotencyKey: key, amount: amount, reason: '兑换：' + ITEM });
  } catch (e) {
    await env.DB.prepare("UPDATE pay_consumptions SET status = 'UNKNOWN', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
    return json({ ok: false, pending: true, error: '扣减结果未确认，请稍后重试同一笔（不会重复扣减）' }, 202);
  }

  const n = normalizeUsage(c) || {};
  if (n.status === 'SUCCEEDED' && n.confirmed && n.consumed === amount && (!n.quotaUnit || n.quotaUnit === 'POINT')) {
    await env.DB.prepare("UPDATE pay_consumptions SET status = 'SUCCEEDED', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
    row.status = 'SUCCEEDED';
    try {
      const r = await credit(env, row);
      return json({ ok: true, mode: 'exchanged', exchanged: amount, points: r.points, totalPoints: r.totalPoints });
    } catch (e) {
      return json({ ok: false, error: '额度已扣减但积分入账失败，请联系站长（不会重复扣）' }, 500);
    }
  }
  if (n.status === 'FAILED') {
    await env.DB.prepare("UPDATE pay_consumptions SET status = 'FAILED', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
    return json({ ok: false, error: '额度扣减未成功，请重试' }, 409);
  }
  await env.DB.prepare("UPDATE pay_consumptions SET status = 'UNKNOWN', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
  return json({ ok: false, pending: true, error: '兑换处理中，请稍后刷新（不会重复扣减）' }, 202);
}
