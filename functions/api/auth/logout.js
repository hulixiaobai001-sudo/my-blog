export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (token) {
    await env.AUTH_KV.delete(`session:${token}`);
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Set-Cookie': 'session=; Path=/; Max-Age=0' }
  });
}
