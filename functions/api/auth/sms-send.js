import { randomToken } from '../../_lib.js';

// 短信验证码发送：验证码存入 AUTH_KV（5分钟有效），发送走通用网关
// 配置（Cloudflare Pages 环境变量）：
//   SMS_ENABLED=1            开启后注册必须填手机号+验证码（未开启则注册不强制）
//   SMS_GATEWAY_URL=...      短信网关地址（POST，body 为 {"phone":"...","code":"..."}）
//   SMS_GATEWAY_TOKEN=...    可选的网关鉴权 token（放在 X-SMS-Token 头）
// 未配置 SMS_GATEWAY_URL 时返回错误，提示站长配置后可用
export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || '';
  try {
    const { phone } = await request.json();
    if (!phone || !/^1\d{10}$/.test(String(phone))) {
      return Response.json({ error: '手机号格式不正确' }, { status: 400 });
    }
    // 频率限制：同一手机号 60 秒内只能发一次
    const lastKey = 'sms_sent:' + phone;
    const last = await env.AUTH_KV.get(lastKey);
    if (last) return Response.json({ error: '发送太频繁，请稍后再试' }, { status: 429 });
    await env.AUTH_KV.put(lastKey, String(Date.now()), { expirationTtl: 60 });

    // 生成 6 位验证码
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.AUTH_KV.put('sms_code:' + phone, code, { expirationTtl: 300 });

    // 发送：走用户配置的短信网关
    const gateway = env.SMS_GATEWAY_URL;
    if (!gateway) {
      // 未配置网关：发送失败但不把验证码回显给匿名请求（防绕过）
      return Response.json({ error: '短信服务未配置，请联系站长开通' }, { status: 501 });
    }
    const headers = { 'Content-Type': 'application/json' };
    if (env.SMS_GATEWAY_TOKEN) headers['X-SMS-Token'] = env.SMS_GATEWAY_TOKEN;
    const resp = await fetch(gateway, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: String(phone), code })
    });
    if (!resp.ok) {
      console.error('sms gateway error', resp.status);
      return Response.json({ error: '短信发送失败，请稍后再试' }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('sms-send error', e);
    return Response.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
