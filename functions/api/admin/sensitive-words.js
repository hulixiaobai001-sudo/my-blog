import { getSensitiveWords } from '../../_lib.js';

// 敏感词库：GET 返回列表（管理员）；POST 全量覆盖（管理员）
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!me || !me.is_admin) return new Response(JSON.stringify({ error: '仅管理员可查看' }), { status: 403 });
  const words = await getSensitiveWords(env);
  return new Response(JSON.stringify({ words }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT is_admin, role FROM users WHERE id = ?').bind(userId).first();
  if (!me || !me.is_admin) return new Response(JSON.stringify({ error: '仅管理员可操作' }), { status: 403 });

  const { words } = await request.json();
  if (!Array.isArray(words) || words.length > 200) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  const clean = [...new Set(words.map(w => String(w).trim().slice(0, 20)).filter(w => w))];
  await env.DB.exec('CREATE TABLE IF NOT EXISTS sensitive_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE, created_at TEXT)');
  await env.DB.prepare('DELETE FROM sensitive_words').run();
  for (const w of clean) {
    await env.DB.prepare('INSERT INTO sensitive_words (word) VALUES (?)').bind(w).run();
  }
  return new Response(JSON.stringify({ ok: true, count: clean.length }));
}
