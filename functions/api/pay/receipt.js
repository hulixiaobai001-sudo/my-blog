import { payClient, hasPay, getLoginUser, ensurePayTables } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// GET /api/pay/receipt?key= —— 单笔赞助凭具：只回服务端查询到的状态，不代表一定已到账
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!hasPay(env)) return json({ ok: false, error: '赞赏通道未配置' }, 503);

  const user = await getLoginUser(env, request);
  if (!user) return json({ ok: false, error: '请先登录' }, 401);

  const url = new URL(request.url);
  const key = String(url.searchParams.get('key') || '').slice(0, 64);
  if (!key) return json({ ok: false, error: '缺少凭据编号' }, 400);

  await ensurePayTables(env);
  const order = await env.DB.prepare('SELECT * FROM pay_orders WHERE user_id = ? AND idempotency_key = ?')
    .bind(user.userId, key).first();
  if (!order) return json({ ok: false, error: '未找到该笔赞助记录' }, 404);

  const receipt = {
    key: order.idempotency_key,
    tier: order.display_name || '',
    price: order.amount || '',
    quota: order.quota_amount || 0,
    unit: order.quota_unit || '',
    createdAt: order.created_at || '',
    status: order.status || 'CREATED',
    payStatus: '',
    paid: false,
    note: '本凭据仅证明下单记录；是否到账以上方赞助额度为准'
  };

  try {
    const r = await payClient(env).purchaseQuery(user.userId, key);
    receipt.payStatus = String((r && (r.status || r.purchase_status)) || '');
    receipt.paid = !!(r && (r.paid === true || r.paid === 'true'));
  } catch (e) {
    receipt.payStatus = 'QUERY_FAILED';
  }

  return json({ ok: true, receipt: receipt });
}
