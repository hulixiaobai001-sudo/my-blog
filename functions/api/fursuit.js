import { sanitize } from '../_lib.js';

const DEFAULT_ITEMS = [
  { image_url: '/images/fursuit-1.jpg', caption: '兽聚合照' },
  { image_url: '/images/fursuit-2.jpg', caption: 'FurShion' },
  { image_url: '/images/fursuit-3.jpg', caption: '户外出毛' }
];

// 兽装相册：GET 公开读取；POST 仅站长可全量更新
export async function onRequestGet({ env }) {
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS fursuit_album (id INTEGER PRIMARY KEY AUTOINCREMENT, image_url TEXT, caption TEXT, sort INTEGER DEFAULT 0)');
    const { results } = await env.DB.prepare('SELECT id, image_url, caption FROM fursuit_album ORDER BY sort ASC, id ASC').all();
    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ items: DEFAULT_ITEMS }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    return new Response(JSON.stringify({ items: results.map(r => ({ image_url: r.image_url, caption: r.caption })) }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ items: DEFAULT_ITEMS }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!me || me.role !== 'super_admin') {
    return new Response(JSON.stringify({ error: '仅站长可管理兽装相册' }), { status: 403 });
  }

  const { items } = await request.json();
  if (!Array.isArray(items) || items.length > 30) {
    return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  }
  const cleanItems = items.map(it => ({
    url: sanitize(String(it.image_url || '').slice(0, 500)),
    cap: sanitize(String(it.caption || '').slice(0, 60))
  })).filter(it => it.url && (it.url.startsWith('/api/report/view?key=') || it.url.startsWith('http') || it.url.startsWith('/images/')));

  await env.DB.exec('CREATE TABLE IF NOT EXISTS fursuit_album (id INTEGER PRIMARY KEY AUTOINCREMENT, image_url TEXT, caption TEXT, sort INTEGER DEFAULT 0)');
  await env.DB.prepare('DELETE FROM fursuit_album').run();
  for (let i = 0; i < cleanItems.length; i++) {
    await env.DB.prepare('INSERT INTO fursuit_album (image_url, caption, sort) VALUES (?, ?, ?)').bind(cleanItems[i].url, cleanItems[i].cap, i).run();
  }
  return new Response(JSON.stringify({ ok: true, count: cleanItems.length }));
}
