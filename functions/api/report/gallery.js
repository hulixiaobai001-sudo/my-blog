let migrated = false;

export async function onRequestGet(context) {
  const { request, env } = context;
  // 当前登录用户（用于 liked 状态）
  let meId = null;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (token) {
    try {
      const session = await env.AUTH_KV.get(`session:${token}`);
      if (session) meId = JSON.parse(session).userId;
    } catch(e) {}
  }
  try {
    if (!migrated) {
      try { await env.DB.exec("ALTER TABLE reports ADD COLUMN note TEXT DEFAULT ''"); } catch(e) {}
      try { await env.DB.exec("ALTER TABLE reports ADD COLUMN featured INTEGER DEFAULT 0"); } catch(e) {}
      migrated = true;
    }
    try { await env.DB.exec('CREATE TABLE IF NOT EXISTS report_likes (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')), UNIQUE(report_id, user_id))'); } catch(e) {}
    const allUser = await env.DB.prepare(`
      SELECT r.id, r.user_id, r.image_key, r.caption, r.created_at, r.note, r.featured, u.username,
      (SELECT COUNT(*) FROM report_likes l WHERE l.report_id = r.id) AS likes
      FROM reports r JOIN users u ON r.user_id = u.id
      WHERE r.status = 'approved' AND (r.type IS NULL OR r.type != 'admin')
      ORDER BY r.id DESC
    `).all();
    const allAdmin = await env.DB.prepare(`
      SELECT r.id, r.image_key, r.caption, r.created_at, r.note, r.featured, r.type as rtype,
      (SELECT COUNT(*) FROM report_likes l WHERE l.report_id = r.id) AS likes
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

    const likeIds = new Set();
    if (meId) {
      try {
        const { results: myLikes } = await env.DB.prepare('SELECT report_id FROM report_likes WHERE user_id = ?').bind(meId).all();
        for (const l of (myLikes || [])) likeIds.add(l.report_id);
      } catch(e) {}
    }
    for (const r of (allUser.results || [])) r.liked = likeIds.has(r.id) ? 1 : 0;
    for (const r of (allAdmin.results || [])) r.liked = likeIds.has(r.id) ? 1 : 0;

    let userReports = allUser.results || [];
    let adminReports = allAdmin.results || [];
    if (userReports.length >= 5) userReports = shuffle(userReports).slice(0, 2);
    if (adminReports.length >= 5) adminReports = shuffle(adminReports).slice(0, 2);

    return new Response(JSON.stringify({ user_reports: userReports, admin_reports: adminReports }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ user_reports: [], admin_reports: [] }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
