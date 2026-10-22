import { randomToken } from '../../_lib.js';

// 自研图形验证码（零成本，不依赖短信网关）
// GET /api/auth/captcha -> { token, svg }，svg 为 SVG 字符串（前端 data URI 展示）
// 答案存 AUTH_KV：captcha:<token>，5 分钟有效，一次校验后删除
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I

export async function onRequestGet(context) {
  const { env } = context;
  // 频率限制：同一 IP 60 秒最多生成 10 次，防刷
  const ip = context.request.headers.get('CF-Connecting-IP') || '';
  const rateKey = 'captcha_rate:' + ip;
  const n = parseInt((await env.AUTH_KV.get(rateKey)) || '0');
  if (n >= 10) return Response.json({ error: '请求太频繁，请稍后再试' }, { status: 429 });
  await env.AUTH_KV.put(rateKey, String(n + 1), { expirationTtl: 60 });

  // 生成 4 位验证码
  let code = '';
  for (let i = 0; i < 4; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  const token = randomToken();
  await env.AUTH_KV.put('captcha:' + token, code, { expirationTtl: 300 });

  // 绘制 SVG：扭曲字符 + 干扰线 + 噪点
  const W = 130, H = 46;
  const colors = ['#8ab4ff', '#f0ad4e', '#4ade80', '#f87171', '#c084fc'];
  let chars = '';
  for (let i = 0; i < code.length; i++) {
    const x = 18 + i * 26;
    const y = 16 + Math.floor(Math.random() * 16);
    const rot = (Math.random() * 30 - 15).toFixed(1);
    const color = colors[Math.floor(Math.random() * colors.length)];
    chars += `<text x="${x}" y="${y + 26}" font-size="26" font-family="monospace" font-weight="bold" fill="${color}" transform="rotate(${rot} ${x} ${y + 26})">${code[i]}</text>`;
  }
  let lines = '';
  for (let i = 0; i < 3; i++) {
    const c = colors[Math.floor(Math.random() * colors.length)];
    lines += `<line x1="${Math.floor(Math.random() * W)}" y1="${Math.floor(Math.random() * H)}" x2="${Math.floor(Math.random() * W)}" y2="${Math.floor(Math.random() * H)}" stroke="${c}" stroke-width="1.2" opacity="0.6"/>`;
  }
  let dots = '';
  for (let i = 0; i < 40; i++) {
    const c = colors[Math.floor(Math.random() * colors.length)];
    dots += `<circle cx="${Math.floor(Math.random() * W)}" cy="${Math.floor(Math.random() * H)}" r="1.2" fill="${c}" opacity="0.5"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" rx="8" fill="#1b2030"/>${lines}${dots}${chars}</svg>`;
  return Response.json({ token, svg });
}
