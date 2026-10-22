import { logAdmin } from '../../_lib.js';

// 积分商店商品管理
// GET  /api/shop/items          -> 上架商品（用户可见）
// GET  /api/shop/items?all=1    -> 全部商品（站长，含下架）
// POST /api/shop/items          -> 站长：新增/修改（{ id?, name, cost, desc, active }）
// DELETE /api/shop/items?id=x   -> 站长：删除商品
async function ensureTable(env) {
  try {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS shop_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, cost INTEGER, desc TEXT DEFAULT '', active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0)");
    // 首次运行播种默认商品
    const cnt = await env.DB.prepare('SELECT COUNT(*) as c FROM shop_items').first();
    if (!cnt || cnt.c === 0) {
      await env.DB.prepare('INSERT INTO shop_items (name, cost, desc) VALUES (?, ?, ?)').bind('奶茶', 1000, '请站长在后台填写说明与联系方式').run();
      await env.DB.prepare('INSERT INTO shop_items (name, cost, desc) VALUES (?, ?, ?)').bind('周边', 1500, '请站长在后台填写说明与联系方式').run();
    }
  } catch (e) {}
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const all = url.searchParams.get('all') === '1';
  await ensureTable(env);
  let isAdmin = false;
  if (all) {
    const cookie = request.headers.get('Cookie') || '';
    const token = cookie.match(/session=([^;]+)/)?.[1];
    if (token) {
      const session = await env.AUTH_KV.get(`session:${token}`);
      if (session) {
        const { userId } = JSON.parse(session);
        const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
        isAdmin = !!(me && me.is_admin);
      }
    }
    if (!isAdmin) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });
  }
  try {
    const where = all ? '' : 'WHERE active = 1';
    const { results } = await env.DB.prepare('SELECT id, name, cost, desc, active, sort FROM shop_items ' + where + ' ORDER BY sort ASC, id ASC').all();
    return new Response(JSON.stringify({ items: results || [] }));
  } catch (e) {
    return new Response(JSON.stringify({ items: [] }));
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
  const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!me || !me.is_admin) return new Response(JSON.stringify({ error: '仅站长可管理商品' }), { status: 403 });

  const body = await request.json();
  await ensureTable(env);
  const name = String(body.name || '').trim().slice(0, 30).replace(/[<>"'`]/g, '');
  const cost = parseInt(body.cost);
  const desc = String(body.desc || '').slice(0, 200).replace(/[<>]/g, '');
  const active = body.active ? 1 : 0;
  if (!name || !(cost >= 0 && cost <= 100000)) return new Response(JSON.stringify({ error: '名称与积分价格必填' }), { status: 400 });

  try {
    if (body.id) {
      const exists = await env.DB.prepare('SELECT id FROM shop_items WHERE id = ?').bind(parseInt(body.id)).first();
      if (!exists) return new Response(JSON.stringify({ error: '商品不存在' }), { status: 404 });
      await env.DB.prepare('UPDATE shop_items SET name = ?, cost = ?, desc = ?, active = ? WHERE id = ?').bind(name, cost, desc, active, parseInt(body.id)).run();
      await logAdmin(env, userId, '商店管理', '更新商品：' + name + (active ? '' : '（下架）'));
    } else {
      await env.DB.prepare('INSERT INTO shop_items (name, cost, desc, active) VALUES (?, ?, ?, ?)').bind(name, cost, desc, active).run();
      await logAdmin(env, userId, '商店管理', '新增商品：' + name);
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: '商品名已存在或保存失败' }), { status: 400 });
  }
  return new Response(JSON.stringify({ ok: true }));
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const session = await env.AUTH_KV.get(`session:${token}`);
  if (!session) return new Response(JSON.stringify({ error: '登录已过期' }), { status: 401 });
  const { userId } = JSON.parse(session);
  const me = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (!me || !me.is_admin) return new Response(JSON.stringify({ error: '仅站长可管理商品' }), { status: 403 });

  const id = parseInt(url.searchParams.get('id') || '0');
  if (!id) return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
  await env.DB.prepare('DELETE FROM shop_items WHERE id = ?').bind(id).run();
  await logAdmin(env, userId, '商店管理', '删除商品 #' + id);
  return new Response(JSON.stringify({ ok: true }));
}
