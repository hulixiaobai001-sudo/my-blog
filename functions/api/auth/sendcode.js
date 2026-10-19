export async function onRequestPost(context) {
  const { request, env } = context;
  const { email, code } = await request.json();
  await env.AUTH_KV.put(`code:${email}`, code, { expirationTtl: 300 });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
