import { payClient, hasPay, getLoginUser, ensurePayTables, normalizeAccess } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// GET /api/pay/status?key=xxx —— 回跳后只做"查询"，不把回跳当成付款成功
// purchase 记录只说明购买入口状态；是否到账一律以 /access 的额度为准。
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!hasPay(env)) return json({ ok: false, error: '赞赏通道未配置' }, 503);

  const user = await getLoginUser(env, request);
  if (!user) return json({ ok: false, error: '请先登录' }, 401);

  const key = String(new URL(request.url).searchParams.get('key') || '').slice(0, 128);
  if (!key) return json({ ok: false, error: '缺少业务编号' }, 400);

  await ensurePayTables(env);
  const order = await env.DB.prepare('SELECT * FROM pay_orders WHERE user_id = ? AND idempotency_key = ?')
    .bind(user.userId, key).first();
  if (!order) return json({ ok: false, error: '记录不存在' }, 404);

  const pay = payClient(env);
  let record = null;
  try {
    record = await pay.purchaseQuery(user.userId, key);
  } catch (e) {
    return json({ ok: false, error: '查询失败，请稍后刷新', retryable: e.retryable !== false }, 502);
  }

  const resp = (record && record.response) || {};
  const status = resp.status || record.status || '';
  try {
    await env.DB.prepare("UPDATE pay_orders SET status = ?, updated_at = datetime('now') WHERE idempotency_key = ?")
      .bind(String(status || 'UNKNOWN'), key).run();
  } catch (e) {}

  // 额度快照：这是判断"是否到账"的唯一依据
  let access = null;
  try { access = normalizeAccess(await pay.access(user.userId, 1)); } catch (e) {}

  return json({
    ok: true,
    key: key,
    status: status || 'UNKNOWN',
    confirmed: resp.confirmed === true,
    purchaseUrl: resp.purchase_url || order.purchase_url || '',
    expireTime: resp.expire_time || '',
    access: access,
    balanceChangeNotice: '页面回跳与入场状态不代表付款成功，请以本页额度为准'
  });
}
