export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare('SELECT id, username, bio, avatar, qq FROM users WHERE show_qq = 1 AND is_admin = 0 ORDER BY id ASC').all();
    // 不暴露QQ号，只返回跳转用的key（id）
    const list = results.map(u => ({ id: u.id, username: u.username, bio: u.bio, avatar: u.avatar, qq: u.qq }));
    return new Response(JSON.stringify({ users: list }));
  } catch (e) {
    return new Response(JSON.stringify({ users: [] }));
  }
}
