export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(`
      SELECT u.username, COUNT(r.id) AS cnt
      FROM reports r JOIN users u ON r.user_id = u.id
      WHERE r.status = 'approved'
      GROUP BY r.user_id
      ORDER BY cnt DESC, u.id ASC
      LIMIT 8
    `).all();
    return new Response(JSON.stringify({ list: results.map(x => ({ username: x.username, count: x.cnt })) }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ list: [] }));
  }
}
