// catch-all：接管所有未匹配静态资源与具体 API 路由的请求
// 这些请求在 Pages 平台层原本直接返回 404（不经 Functions），
// 导致 _middleware.js 里的 404 风控记录分支永远无法执行。
// 本函数统一接管并以 404 响应，同时自身完成安全日志写入（不依赖中间件）。
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 跳过 API 与静态资源（与 _middleware 的过滤口径一致）
  const skipPrefixes = ['/api/', '/images/', '/img/', '/css/', '/js/', '/fonts/', '/favicon', '/robots.txt', '/sitemap'];
  const skipExts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.txt', '.xml', '.webmanifest'];
  if (skipPrefixes.some(p => path.startsWith(p)) || skipExts.some(e => path.toLowerCase().endsWith(e))) {
    return new Response('Not Found', { status: 404 });
  }

  // 记录 404 异常访问（同 IP 60 秒限一条，防刷库）
  try {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';
    const referer = request.headers.get('Referer') || '';
    const lower = path.toLowerCase();
    const suspicious = ['wp-admin', 'wp-login', 'xmlrpc', '.env', '.git', 'config.php', 'config.json',
      'adminer', 'phpmyadmin', 'web.config', 'shell', 'cmd', 'exec', 'eval', 'sql', 'backup', 'bak.',
      'dump', 'passwd', 'shadow', 'aws', 'secret', 'token', 'login.php', '.php', 'jsp', 'aspx', 'cgi-bin'];
    const intent = suspicious.some(k => lower.includes(k)) ? '疑似扫描' : (path.length > 120 ? '异常路径' : '普通404');

    const rateKey = 'seclog:' + ip;
    const last = await env.AUTH_KV.get(rateKey);
    if (!last) {
      await env.AUTH_KV.put(rateKey, String(Date.now()), { expirationTtl: 60 });
      await env.DB.exec("CREATE TABLE IF NOT EXISTS security_log (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, ip TEXT, ua TEXT, referer TEXT, intent TEXT, handled INTEGER DEFAULT 0, note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))");
      await env.DB.prepare('INSERT INTO security_log (path, ip, ua, referer, intent) VALUES (?, ?, ?, ?, ?)')
        .bind(path.slice(0, 300), String(ip).slice(0, 64), String(ua).slice(0, 300), String(referer).slice(0, 300), intent).run();
    }
  } catch (e) {
    // 写入失败不阻塞 404 响应，但记录错误便于排查
    console.error('seclog write error:', e && e.message);
  }

  return new Response(
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 - 页面不存在</title></head>' +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#141622;color:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;">' +
    '<div style="text-align:center;"><div style="font-size:72px;font-weight:800;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;background-clip:text;color:transparent;">404</div>' +
    '<p style="color:#94a3b8;margin:12px 0 4px;">这里什么都没有，也许你在找别的东西</p>' +
    '<p style="color:#64748b;font-size:13px;">该访问已记录在安全日志中</p>' +
    '<a href="/" style="display:inline-block;margin-top:18px;padding:10px 24px;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;font-size:14px;">回到首页</a>' +
    '</div></body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
