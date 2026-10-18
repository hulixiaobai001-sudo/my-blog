export async function onRequestGet({ env }) {
  try {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0").run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
