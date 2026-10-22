import { randomToken, getSiteSettings } from '../../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const settings = await getSiteSettings(env);
    if (settings.registration_open !== '1') {
      return new Response(JSON.stringify({ error: '注册通道暂未开放' }), { status: 403 });
    }
    const { username, password, qq, agree, phone, sms_code, captcha_token, captcha_answer } = await request.json();

    if (!username || !password || username.length < 2 || password.length < 6) {
      return new Response(JSON.stringify({ error: '用户名至少2字符，密码至少6位' }), { status: 400 });
    }
    // 必须同意用户协议与隐私政策
    if (!agree) {
      return new Response(JSON.stringify({ error: '请先阅读并同意用户协议与隐私政策' }), { status: 400 });
    }
    // 自研图形验证码：必填（零成本防机器人）
    if (!captcha_token || !captcha_answer) {
      return new Response(JSON.stringify({ error: '请完成图形验证码' }), { status: 400 });
    }
    const savedCode = await env.AUTH_KV.get('captcha:' + captcha_token);
    if (!savedCode || savedCode !== String(captcha_answer).trim().toUpperCase()) {
      return new Response(JSON.stringify({ error: '验证码错误，请重试' }), { status: 400 });
    }
    await env.AUTH_KV.delete('captcha:' + captcha_token);
    // 短信验证码：开启 SMS_ENABLED 时必填手机号+验证码（可选增强，默认关闭）
    const smsEnabled = env.SMS_ENABLED === '1';
    if (smsEnabled) {
      if (!phone || !sms_code) {
        return new Response(JSON.stringify({ error: '请填写手机号与短信验证码' }), { status: 400 });
      }
      const saved = await env.AUTH_KV.get('sms_code:' + phone);
      if (!saved || saved !== String(sms_code).trim()) {
        return new Response(JSON.stringify({ error: '短信验证码错误或已过期' }), { status: 400 });
      }
      await env.AUTH_KV.delete('sms_code:' + phone);
    }

    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) {
      return new Response(JSON.stringify({ error: '用户名已被占用' }), { status: 409 });
    }

    const hash = await sha256(password);
    // 新用户默认在扩列区展示（show_qq=1），如不愿展示可在个人资料关闭
    try {
      await env.DB.prepare('INSERT INTO users (username, password_hash, qq, phone, show_qq) VALUES (?, ?, ?, ?, 1)').bind(username, hash, qq || '', phone || '').run();
    } catch (e) {
      try { await env.DB.exec('ALTER TABLE users ADD COLUMN qq TEXT DEFAULT \'\''); } catch(e2) {}
      try { await env.DB.exec('ALTER TABLE users ADD COLUMN show_qq INTEGER DEFAULT 1'); } catch(e3) {}
      try { await env.DB.exec('ALTER TABLE users ADD COLUMN phone TEXT DEFAULT \'\''); } catch(e4) {}
      await env.DB.prepare('INSERT INTO users (username, password_hash, qq, phone, show_qq) VALUES (?, ?, ?, ?, 1)').bind(username, hash, qq || '', phone || '').run();
    }
    const user = await env.DB.prepare('SELECT id, username, is_admin FROM users WHERE username = ?').bind(username).first();

    const token = randomToken() + randomToken();
    await env.AUTH_KV.put(`session:${token}`, JSON.stringify({ userId: user.id, isAdmin: user.is_admin }), { expirationTtl: 60 * 60 * 24 * 30 });

    return new Response(JSON.stringify({ token, user }), {
      headers: { 'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; Max-Age=2592000; SameSite=Lax`, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('register error', e);
    return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500 });
  }
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
