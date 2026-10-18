export async function onRequestPost(context) {
  const { request, env } = context;
  const { email, code } = await request.json();

  // 验证码存 KV，5分钟过期
  await env.AUTH_KV.put(`code:${email}`, code, { expirationTtl: 300 });

  // 尝试通过 Resend API 发邮件（如果配置了 key）
  if (env.RESEND_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: '狐狸白沁个人站 <onboarding@resend.dev>',
          to: email,
          subject: '你的验证码',
          text: '你的验证码是：' + code + '\n5分钟内有效。'
        })
      });
    } catch (e) {}
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
