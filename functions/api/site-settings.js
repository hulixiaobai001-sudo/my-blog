import { getSiteSettings } from '../_lib.js';

// 公开站点设置：仅暴露展示用字段（BGM、维护模式提示）
export async function onRequestGet({ env }) {
  const s = await getSiteSettings(env);
  return new Response(JSON.stringify({
    bgm_url: s.bgm_url || '',
    maintenance_mode: s.maintenance_mode === '1',
    registration_open: s.registration_open === '1',
    guestbook_open: s.guestbook_open === '1'
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
