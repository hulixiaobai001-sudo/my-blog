export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT r.id, r.image_key, r.caption, r.created_at, u.username
    FROM reports r JOIN users u ON r.user_id = u.id
    WHERE r.status = 'approved'
    ORDER BY r.id DESC
    LIMIT 100
  `).all();
  return new Response(JSON.stringify({ reports: results }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
