export async function onRequestGet({ env }) {
  try {
    const userReports = await env.DB.prepare(`
      SELECT r.id, r.image_key, r.caption, r.created_at, u.username
      FROM reports r JOIN users u ON r.user_id = u.id
      WHERE r.status = 'approved' AND (r.type = 'user' OR r.type IS NULL)
      ORDER BY r.id DESC
      LIMIT 100
    `).all();
    const adminReports = await env.DB.prepare(`
      SELECT r.id, r.image_key, r.caption, r.created_at
      FROM reports r
      WHERE r.status = 'approved' AND r.type = 'admin'
      ORDER BY r.admin_date DESC
    `).all();
    return new Response(JSON.stringify({ user_reports: userReports.results, admin_reports: adminReports.results }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ user_reports: [], admin_reports: [] }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
