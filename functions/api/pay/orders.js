import { getLoginUser, ensurePayTables } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// GET /api/pay/orders —— 本人最近赞助记录（用于收款凭具，不含付款链接与外链）
export async function onRequestGet(context) {
  const { env, request } = context;
  const user = await getLoginUser(env, request);
  if (!user) return json({ ok: false, error: '请先登录', orders: [] }, 401);

  await ensurePayTables(env);
  try {
    const rs = await env.DB.prepare(`SELECT idempotency_key, display_name, amount, quota_amount, quota_unit, status,
      datetime(created_at, '+8 hours') AS created_at
      FROM pay_orders WHERE user_id = ? ORDER BY id DESC LIMIT 10`).bind(user.userId).all();
    const list = (rs.results || []).map(r => ({
      key: r.idempotency_key,
      tier: r.display_name || '',
      price: r.amount || '',
      quota: typeof r.quota_amount === 'number' ? r.quota_amount : 0,
      unit: r.quota_unit || '',
      status: r.status || 'CREATED',
      createdAt: r.created_at || ''
    }));
    return json({ ok: true, orders: list });
  } catch (e) {
    return json({ ok: false, error: '记录读取失败', orders: [] }, 500);
  }
}
