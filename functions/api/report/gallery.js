export async function onRequestGet({ env }) {
  try {
    const allUser = await env.DB.prepare(`
      SELECT r.id, r.image_key, r.caption, r.created_at, u.username
      FROM reports r JOIN users u ON r.user_id = u.id
      WHERE r.status = 'approved' AND (r.type = 'user' OR r.type IS NULL)
      ORDER BY r.id DESC
    `).all();
    const allAdmin = await env.DB.prepare(`
      SELECT r.id, r.image_key, r.caption, r.created_at
      FROM reports r
      WHERE r.status = 'approved' AND r.type = 'admin'
      ORDER BY r.admin_date DESC
    `).all();

    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    let userReports = allUser.results || [];
    let adminReports = allAdmin.results || [];
    if (userReports.length >= 5) userReports = shuffle(userReports).slice(0, 2);
    if (adminReports.length >= 5) adminReports = shuffle(adminReports).slice(0, 2);

    return new Response(JSON.stringify({ user_reports: userReports, admin_reports: adminReports }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ user_reports: [], admin_reports: [] }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
