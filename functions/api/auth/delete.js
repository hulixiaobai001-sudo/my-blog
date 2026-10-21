// 用户自助注销：验证密码后删除本人账号及全部内容
export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);

  const { password } = await request.json();
  if (!password) return new Response(JSON.stringify({ error: '请输入密码确认注销' }), { status: 400 });

  const user = await env.DB.prepare('SELECT id, password_hash, is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });

  const hash = await sha256(password);
  if (hash !== user.password_hash) return new Response(JSON.stringify({ error: '密码错误' }), { status: 401 });

  // 管理员/站长不允许自助注销，避免站点失去管理账号
  if (user.is_admin) return new Response(JSON.stringify({ error: '管理员/站长账号请在后台由站长处理' }), { status: 400 });

  await deleteUserData(env, userId);
  // 清除当前会话
  await env.AUTH_KV.delete(`session:${token}`);

  return new Response(JSON.stringify({ ok: true }));
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deleteUserData(env, userId) {
  try {
    const { results } = await env.DB.prepare('SELECT image_key FROM reports WHERE user_id = ? AND image_key IS NOT NULL AND image_key != ?').bind(userId, '').all();
    for (const r of (results || [])) {
      try { await env.IMAGES_KV.delete(r.image_key); } catch(e) {}
    }
  } catch(e) {}
  const tables = ['guestbook', 'messages', 'reports', 'tickets', 'points_log', 'wall', 'comments'];
  for (const t of tables) {
    try { await env.DB.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').bind(userId).run(); } catch(e) {}
  }
  // 硬删除用户行：彻底移除账号
  try { await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run(); } catch(e) {}
}
