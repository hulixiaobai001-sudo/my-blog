export async function onRequestPost(context) {
  const { request, env } = context;
  const { email, code } = await request.json();

  // 验证码存 KV，5分钟过期
  await env.AUTH_KV.put(`code:${email}`, code, { expirationTtl: 300 });

  // 用 EmailJS 发邮件
  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: 'service_fc3udqj',
        template_id: 'wr93quh',
        user_id: 'gKtkQsQqhRjt9CaDE',
        template_params: {
          passcode: code,
          time: '5分钟',
          to_email: email
        }
      })
    });
  } catch (e) {}

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
