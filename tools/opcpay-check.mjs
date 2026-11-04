// 一人付（opcpay）只读核对脚本
// 用法：set OPCAPY 环境变量后执行
//   PowerShell: $env:opcpay_api_key='...'; node tools/opcpay-check.mjs
// 只调用 capabilities / product 两个只读接口，不创建购买入口、不核销、不扣款。
// Key 只从环境变量读取，脚本本身不保存、不打印任何密钥内容。

import { opcpay } from 'opcpay';

const pay = new opcpay();

const [caps, product] = await Promise.all([pay.capabilities(), pay.product()]);

console.log('provider_configured:', caps.provider_configured);
console.log('capabilities:', JSON.stringify(caps.capabilities));
console.log('limitations:', (caps.limitations || []).join(' / '));
console.log('product:', product.product_name, '| status:', product.capability_status, '| mode:', product.billing_mode, '| unit:', product.quota_unit);
for (const o of product.charging_options || []) {
  console.log(`  ${o.sku_id}  ${o.display_name}  ¥${o.price}  -> ${o.quota_amount} ${o.quota_unit}`);
}
