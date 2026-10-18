export async function onRequestGet({ env }) {
  try {
    await env.DB.prepare("DELETE FROM reports WHERE user_id = 1").run();
    await env.DB.prepare("DELETE FROM tickets WHERE user_id = 1").run();
    await env.DB.prepare("DELETE FROM users WHERE id = 1").run();
    const r = await env.DB.prepare("SELECT id, username, is_admin FROM users").all();
    return new Response(JSON.stringify({ ok: true, users: r.results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
