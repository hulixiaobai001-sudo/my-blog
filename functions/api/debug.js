export async function onRequestGet({ env }) {
  try {
    const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    return new Response(JSON.stringify({ tables: r.results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
  }
}
