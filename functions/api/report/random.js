// 随机返图：公开接口，随机返回一张已审核的用户返图
export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT r.id, r.image_key, r.caption, u.username FROM reports r JOIN users u ON r.user_id = u.id WHERE r.status = 'approved' AND (r.type = 'user' OR r.type IS NULL) ORDER BY RANDOM() LIMIT 1"
    ).all();
    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ found: false }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    const r = results[0];
    return new Response(JSON.stringify({ found: true, id: r.id, image_url: '/api/report/view?key=' + r.image_key, caption: r.caption || '', username: r.username }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ found: false }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
