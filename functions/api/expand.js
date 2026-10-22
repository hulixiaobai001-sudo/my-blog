import { getLevel } from '../_lib.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
  const offset = (page - 1) * pageSize;
  try {
    const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE show_qq = 1').first();
    const total = countRow ? countRow.c : 0;
    const { results } = await env.DB.prepare('SELECT id, username, bio, avatar, qq, points FROM users WHERE show_qq = 1 ORDER BY id ASC LIMIT ? OFFSET ?').bind(pageSize, offset).all();
    const list = results.map(u => ({ id: u.id, username: u.username, bio: u.bio, avatar: u.avatar, qq: u.qq, points: u.points || 0, level: getLevel(u.points) }));
    return new Response(JSON.stringify({ users: list, total: total, hasMore: offset + results.length < total }));
  } catch (e) {
    return new Response(JSON.stringify({ users: [], total: 0, hasMore: false }));
  }
}
