import { payClient, hasPay, getUserRole, isTestOption } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function build(product, caps, admin) {
  const flags = (caps && caps.capabilities) || {};
  const status = product.capability_status || 'NOT_CONFIGURED';
  const enabled = status === 'ENABLED' && flags.purchase_entry !== false && caps.provider_configured !== false;

  let all = enabled ? (product.charging_options || []) : [];
  // 测试档位只对站内管理员/站长展示；价格与档位仍以服务端 /product 为准
  const visible = admin ? all.slice() : all.filter(o => !isTestOption(o));

  const options = visible.map(o => ({
    skuId: o.sku_id,
    name: o.display_name || '',
    price: o.price || '',
    currency: o.currency || 'CNY',
    quotaAmount: typeof o.quota_amount === 'number' ? o.quota_amount : null,
    quotaUnit: o.quota_unit || product.quota_unit || '',
    billingMode: o.billing_mode || product.billing_mode || '',
    testTier: isTestOption(o)
  }));

  return {
    configured: true,
    purchasable: enabled,
    capabilityStatus: status,
    reason: product.reason_message || '',
    productName: product.product_name || '',
    billingMode: product.billing_mode || '',
    quotaUnit: product.quota_unit || '',
    admin: admin,
    options: options,
    capabilities: {
      purchaseEntry: flags.purchase_entry !== false,
      entitlementQuery: flags.entitlement_query !== false,
      consumption: flags.consumption === true,
      refund: flags.refund === true,
      transactionQuery: flags.transaction_query === true
    }
  };
}

// GET /api/pay/product —— 公开档位（不含测试档位）；管理员登录态下额外返回测试档位
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!hasPay(env)) {
    return json({ configured: false, purchasable: false, options: [], reason: '服务端未配置 opcpay_api_key' });
  }

  let role = { admin: false, role: 'guest' };
  try { role = await getUserRole(env, request); } catch (e) {}

  const cacheKey = role.admin ? 'opcpay:product:admin' : 'opcpay:product';
  try {
    if (!role.admin) {
      const cached = await env.AUTH_KV.get(cacheKey, 'json');
      if (cached && cached.at && (Date.now() - cached.at) < 300000) return json(cached.data);
    }
  } catch (e) {}

  const pay = payClient(env);
  try {
    const [caps, product] = await Promise.all([pay.capabilities(), pay.product()]);
    const data = build(product, caps, role.admin);

    try {
      await env.AUTH_KV.put(cacheKey, JSON.stringify({ at: Date.now(), data: data }), { expirationTtl: 600 });
    } catch (e) {}

    return json(data);
  } catch (e) {
    return json({
      configured: true,
      purchasable: false,
      options: [],
      capabilityStatus: 'UNKNOWN',
      reason: '赞赏服务暂时不可用，请稍后再试',
      errorCode: (e && e.code) || ''
    }, 200);
  }
}
