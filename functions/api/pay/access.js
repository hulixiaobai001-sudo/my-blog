import { payClient, hasPay, getLoginUser, normalizeAccess } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// GET /api/pay/access —— 当前登录用户的赞助额度（唯一以服务端 access 为准，不做本地余额推算）
export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getLoginUser(env, request);
  if (!user) return json({ loggedIn: false, configured: hasPay(env) });

  if (!hasPay(env)) return json({ loggedIn: true, configured: false, access: null });

  const pay = payClient(env);
  try {
    const a = await pay.access(user.userId, 1);
    return json({ loggedIn: true, configured: true, access: normalizeAccess(a) });
  } catch (e) {
    return json({
      loggedIn: true,
      configured: true,
      access: null,
      error: '权益查询失败，请稍后重试',
      errorCode: e.code || ''
    });
  }
}
