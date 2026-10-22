import { getLevel, checkBanned } from '../../_lib.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ user: null }));

  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ user: null }));

  const { userId } = JSON.parse(session);

  // 兼容旧库：确保新列存在（role / banned / ban_until），
  // 否则下方裸查询在未迁移的库上会报错，导致登录态悬浮球等前端状态异常
  try { await env.DB.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, is_admin INTEGER DEFAULT 0, points INTEGER DEFAULT 0, created_at TEXT)"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0"); } catch(e) {}
  try { await env.DB.exec("ALTER TABLE users ADD COLUMN ban_until TEXT DEFAULT ''"); } catch(e) {}

  let user;
  try {
    user = await env.DB.prepare('SELECT id, username, is_admin, points, role, banned, ban_until FROM users WHERE id = ?').bind(userId).first();
  } catch (e) {
    // 查询异常时降级为未登录，避免前端渲染中断
    return new Response(JSON.stringify({ user: null }));
  }
  if (!user) return new Response(JSON.stringify({ user: null }));

  // 封禁检查（限期到期自动解封），已封禁视为未登录
  const banErr = await checkBanned(env, user.id);
  if (banErr) return new Response(JSON.stringify({ user: null }));

  user.level = getLevel(user.points);
  user.ban_until = user.ban_until || null;
  return new Response(JSON.stringify({ user }));
}
