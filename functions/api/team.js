// GET: 一期合作成员（公开）
// 按注册顺序展示前 5 位用户；新用户注册自动上墙，满 5 人后不再新增（二期不开放）
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare('SELECT id, username, avatar FROM users ORDER BY id ASC LIMIT 5').all();
    return new Response(JSON.stringify({
      members: (results || []).map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar || ''
      })),
      full: (results || []).length >= 5
    }));
  } catch (e) {
    return new Response(JSON.stringify({ members: [], full: false }));
  }
}
