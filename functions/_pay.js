// 一人付（opcpay）服务端客户端 —— Cloudflare Pages Functions 版本
//
// 为什么不用 npm 包里的 SDK：opcpay 的 index.mjs 在顶层 import node:crypto / node:url /
// node:fs 并读取 process.argv，Cloudflare Workers 运行时加载会直接失败（整站 Functions 起不来）。
// 因此这里按官方接口契约（v1，Bearer 鉴权，JSON）实现同一套调用：
//   POST /purchase  /purchase/query  /consume  /consumption  /access
//   GET  /capabilities  /product
// API Key 只从环境变量 opcpay_api_key 读取，不写库、不打日志、不下发前端。
// npm 包保留在 package.json，用于本地只读核对脚本 tools/opcpay-check.mjs。

const BASE = 'https://ai6666.com/opcpay/api/pay/v1';

export function hasPay(env) {
  return !!(env && String(env.opcpay_api_key || '').trim());
}

export function payClient(env) {
  const key = String((env && env.opcpay_api_key) || '').trim();
  if (!key) return null;

  async function request(path, body, method) {
    const init = {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      redirect: 'follow'
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(60000);
    }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: '返回内容不是合法 JSON' }; }
    if (!res.ok) {
      const err = new Error(String(data.error || ('HTTP ' + res.status)).slice(0, 200));
      err.status = res.status;
      err.code = data.error_code || '';
      err.retryable = data.retryable === true || res.status === 429 || res.status >= 500;
      err.requestId = res.headers.get('x-request-id') || data.request_id || '';
      throw err;
    }
    return data;
  }

  return {
    capabilities: () => request('/capabilities'),
    product: () => request('/product'),
    access: (userId, amount) => request('/access', { user_id: String(userId), amount: amount || 1 }),
    purchase: (o) => request('/purchase', {
      user_id: String(o.userId),
      idempotency_key: o.idempotencyKey,
      ...(o.skuId ? { sku_id: o.skuId } : {}),
      ...(o.callbackURL ? { callback_url: o.callbackURL } : {})
    }),
    purchaseQuery: (userId, idempotencyKey) => request('/purchase/query', { user_id: String(userId), idempotency_key: idempotencyKey }),
    consume: (o) => request('/consume', { user_id: String(o.userId), idempotency_key: o.idempotencyKey, amount: o.amount, reason: o.reason }),
    consumption: (userId, idempotencyKey) => request('/consumption', { user_id: String(userId), idempotency_key: idempotencyKey })
  };
}

// 统一的业务号：服务端生成并先落库，重试只复用，不换号
export function bizKey(prefix, userId) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return prefix + '-' + userId + '-' + Date.now().toString(36) + '-' + rnd;
}

// D1 注意：exec() 会按行切分语句，多行 CREATE TABLE 会报 "incomplete input"，
// 因此建表统一走 batch() + prepare()，每条语句保持单条完整 SQL。
export async function ensurePayTables(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pay_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, sku_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, client_action_id TEXT, display_name TEXT DEFAULT '', amount TEXT DEFAULT '', quota_amount INTEGER DEFAULT 0, quota_unit TEXT DEFAULT '', status TEXT DEFAULT 'CREATED', purchase_url TEXT DEFAULT '', purchase_qr_code TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_orders_action ON pay_orders (user_id, client_action_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pay_consumptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, client_action_id TEXT, item_name TEXT DEFAULT '', amount INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT DEFAULT 'CREATED', delivered INTEGER DEFAULT 0, redemption_id INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_consume_action ON pay_consumptions (user_id, client_action_id)")
  ]);
}

export async function getLoginUser(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return null;
  const session = await env.AUTH_KV.get('session:' + token);
  if (!session) return null;
  try {
    const { userId } = JSON.parse(session);
    if (!userId) return null;
    return { userId: Number(userId) };
  } catch (e) {
    return null;
  }
}

// access 结果归一：只认服务端返回，不自己算余额
export function normalizeAccess(a) {
  if (!a || typeof a !== 'object') return null;
  return {
    granted: a.access_granted === true,
    decision: a.decision || '',
    requiresConsumption: a.requires_consumption === true,
    quotaUnit: a.quota_unit || '',
    total: typeof a.total === 'number' ? a.total : null,
    used: typeof a.used === 'number' ? a.used : null,
    remaining: typeof a.remaining === 'number' ? a.remaining : null,
    productName: a.product_name || '',
    purchaseUrl: a.purchase_url || '',
    validUntil: a.valid_until || '',
    capabilityStatus: a.capability_status || ''
  };
}

export function normalizeUsage(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    status: c.status || '',
    confirmed: c.confirmed === true,
    consumed: typeof c.consumed === 'number' ? c.consumed : null,
    remaining: typeof c.remaining === 'number' ? c.remaining : null,
    quotaUnit: c.quota_unit || '',
    reasonCode: c.reason_code || '',
    message: c.message || ''
  };
}
