import { payClient, hasPay, getLoginUser, getUserRole, isTestOption, ensurePayTables, bizKey } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function callbackFor(request, key) {
  const u = new URL(request.url);
  const host = u.host;
  const origin = (host === 'blog.ba3pkz.top' || host.endsWith('.ba3pkz.top') || host === 'localhost' || host.startsWith('127.0.0.1'))
    ? u.origin
    : 'https://blog.ba3pkz.top';
  return origin + '/appreciate/?pay=return&key=' + encodeURIComponent(key);
}

// POST /api/pay/purchase —— 创建支付宝购买入口
// 只返回购买入口，READY/扫码/跳回都不代表已付款；到账与否一律以后续 /access 为准。
export async function onRequestPost(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ ok: false, error: '下单异常，请稍后重试' }, 500);
  }
}

async function handle(context) {
  const { request, env } = context;
  if (!hasPay(env)) return json({ ok: false, error: '赞赏通道未配置' }, 503);

  const user = await getLoginUser(env, request);
  if (!user) return json({ ok: false, error: '请先登录后再赞助' }, 401);

  // 简单限流：同一用户 60 秒内最多发起 5 次
  try {
    const rk = 'payrl:' + user.userId;
    const n = parseInt(await env.AUTH_KV.get(rk) || '0', 10);
    if (n >= 5) return json({ ok: false, error: '操作过于频繁，请稍后再试' }, 429);
    await env.AUTH_KV.put(rk, String(n + 1), { expirationTtl: 60 });
  } catch (e) {}

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '参数错误' }, 400); }

  const skuId = String(body.skuId || '').slice(0, 64);
  const actionId = String(body.actionId || '').slice(0, 64) || ('act-' + user.userId + '-' + Date.now().toString(36));

  const pay = payClient(env);
  let product;
  try { product = await pay.product(); } catch (e) {
    return json({ ok: false, error: '赞赏服务暂时不可用，请稍后再试' }, 502);
  }
  if (product.capability_status !== 'ENABLED') {
    return json({ ok: false, error: '赞赏通道当前不可用' }, 503);
  }
  const opt = (product.charging_options || []).find(o => o.sku_id === skuId);
  // 档位与价格只认服务端 /product 返回，不接受客户端传价格
  if (!opt) return json({ ok: false, error: '档位不存在或已下架' }, 400);
  // 测试档位仅站内管理员/站长可用，不对外售卖
  if (isTestOption(opt)) {
    const role = await getUserRole(env, request);
    if (!role.admin) return json({ ok: false, error: '该档位测试中，暂不开放' }, 403);
  }

  await ensurePayTables(env);

  // 幂等：同一次点击（user + actionId）复用原业务号与原参数
  let order = await env.DB.prepare('SELECT * FROM pay_orders WHERE user_id = ? AND client_action_id = ?')
    .bind(user.userId, actionId).first();

  if (!order) {
    const key = bizKey('sponsor', user.userId);
    try {
      await env.DB.prepare(`INSERT INTO pay_orders (user_id, sku_id, idempotency_key, client_action_id, display_name, amount, quota_amount, quota_unit, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREATED')`)
        .bind(user.userId, skuId, key, actionId, String(opt.display_name || ''), String(opt.price || ''),
          Number(opt.quota_amount || 0), String(opt.quota_unit || ''))
        .run();
    } catch (e) {
      // 并发重复点击触发唯一约束时，回读已落库的那一条，不新建业务号
    }
    order = await env.DB.prepare('SELECT * FROM pay_orders WHERE user_id = ? AND client_action_id = ?')
      .bind(user.userId, actionId).first();
    if (!order) return json({ ok: false, error: '下单记录创建失败，请重试' }, 500);
  }

  // 恢复已有入口：不再新建，直接查原请求
  if (order.purchase_url) {
    return json({
      ok: true,
      key: order.idempotency_key,
      status: order.status || 'READY',
      purchaseUrl: order.purchase_url,
      qrCode: order.purchase_qr_code || '',
      resumed: true,
      paid: false
    });
  }

  let p;
  try {
    p = await pay.purchase({
      userId: user.userId,
      idempotencyKey: order.idempotency_key,
      skuId: skuId,
      callbackURL: callbackFor(request, order.idempotency_key)
    });
  } catch (e) {
    // 超时/5xx 一律标记 UNKNOWN，让用户用同一个 key 重试，不换号
    try {
      await env.DB.prepare("UPDATE pay_orders SET status = 'UNKNOWN', updated_at = datetime('now') WHERE idempotency_key = ?")
        .bind(order.idempotency_key).run();
    } catch (e2) {}
    return json({
      ok: false,
      key: order.idempotency_key,
      status: 'UNKNOWN',
      retryable: e.retryable !== false,
      error: '下单请求未确认，请稍后重试（不会重复扣款）'
    }, 502);
  }

  const status = (p && p.status) || 'UNKNOWN';
  try {
    await env.DB.prepare(`UPDATE pay_orders SET status = ?, purchase_url = ?, purchase_qr_code = ?, updated_at = datetime('now') WHERE idempotency_key = ?`)
      .bind(status, String(p.purchase_url || ''), String(p.purchase_qr_code || ''), order.idempotency_key).run();
  } catch (e) {}

  return json({
    ok: status === 'READY',
    key: order.idempotency_key,
    status: status,
    purchaseUrl: p.purchase_url || '',
    qrCode: p.purchase_qr_code || '',
    expireTime: p.expire_time || '',
    message: p.message || '',
    paid: false
  }, status === 'READY' ? 200 : 502);
}
