import { payClient, hasPay } from '../../_pay.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// GET /api/pay/product —— 公开：只返回商户已配置的真实档位（来自 /product，不写死价格）
export async function onRequestGet(context) {
  const { env } = context;
  if (!hasPay(env)) {
    return json({ configured: false, purchasable: false, options: [], reason: '服务端未配置 opcpay_api_key' });
  }

  // 5 分钟 KV 缓存，避免每次刷新都打接口
  try {
    const cached = await env.AUTH_KV.get('opcpay:product', 'json');
    if (cached && cached.at && (Date.now() - cached.at) < 300000) return json(cached.data);
  } catch (e) {}

  const pay = payClient(env);
  try {
    const [caps, product] = await Promise.all([pay.capabilities(), pay.product()]);
    const flags = (caps && caps.capabilities) || {};
    const status = product.capability_status || 'NOT_CONFIGURED';
    const enabled = status === 'ENABLED' && flags.purchase_entry !== false && caps.provider_configured !== false;

    const options = enabled ? (product.charging_options || []).map(o => ({
      skuId: o.sku_id,
      name: o.display_name || '',
      price: o.price || '',
      currency: o.currency || 'CNY',
      quotaAmount: typeof o.quota_amount === 'number' ? o.quota_amount : null,
      quotaUnit: o.quota_unit || product.quota_unit || '',
      billingMode: o.billing_mode || product.billing_mode || ''
    })) : [];

    const data = {
      configured: true,
      purchasable: enabled,
      capabilityStatus: status,
      reason: product.reason_message || '',
      productName: product.product_name || '',
      billingMode: product.billing_mode || '',
      quotaUnit: product.quota_unit || '',
      options: options,
      capabilities: {
        purchaseEntry: flags.purchase_entry !== false,
        entitlementQuery: flags.entitlement_query !== false,
        consumption: flags.consumption === true,
        refund: flags.refund === true,
        transactionQuery: flags.transaction_query === true
      }
    };

    try {
      await env.AUTH_KV.put('opcpay:product', JSON.stringify({ at: Date.now(), data: data }), { expirationTtl: 600 });
    } catch (e) {}

    return json(data);
  } catch (e) {
    return json({
      configured: true,
      purchasable: false,
      options: [],
      capabilityStatus: 'UNKNOWN',
      reason: '赞赏服务暂时不可用，请稍后再试',
      errorCode: (e && e.code) || '',
      errMsg: String((e && (e.message || e.name)) || '').slice(0, 120)
    }, 200);
  }
}
