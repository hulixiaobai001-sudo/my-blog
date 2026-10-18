export async function onRequestGet({ env }) {
  try {
    await env.DB.prepare("UPDATE users SET username = 'admin' WHERE id = 2").run();
    const r = await env.DB.prepare("SELECT id, username, is_admin FROM users").all();
    return new Response(JSON.stringify({ ok: true, users: r.results }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
