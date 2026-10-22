import { getSiteSettings, logAdmin } from '../../_lib.js';

// 站点设置（写）：仅站长可修改全局开关与 BGM 地址
export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!me || me.role !== 'super_admin') return new Response(JSON.stringify({ error: '仅站长可操作' }), { status: 403 });

  const body = await request.json();
  const allowKeys = ['registration_open', 'guestbook_open', 'maintenance_mode', 'bgm_url'];
  for (const key of allowKeys) {
    if (body[key] === undefined) continue;
    let val = String(body[key]);
    if (key === 'bgm_url') val = val.slice(0, 500);
    else val = (val === '1' || val === 'true') ? '1' : '0';
    await env.DB.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, val).run();
  }
  await logAdmin(env, userId, '站点设置', JSON.stringify(Object.keys(body).filter(k => allowKeys.includes(k)).join(',')));
  const s = await getSiteSettings(env);
  return new Response(JSON.stringify({ ok: true, settings: s }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!me || me.role !== 'super_admin') return new Response(JSON.stringify({ error: '仅站长可操作' }), { status: 403 });
  const s = await getSiteSettings(env);
  return new Response(JSON.stringify({ settings: s }));
}
