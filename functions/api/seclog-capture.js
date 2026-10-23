// 404 风控捕获函数：由 _redirects 兜底规则（/* -> /api/seclog-capture 404）触发
// 仅当请求未命中静态文件、也未命中具体 Functions 路由时才会进入这里，
// 不会影响任何真实页面。负责写入安全日志并返回统一 404 页面。
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 跳过 API 与静态资源扩展（与 _middleware 过滤口径一致，防噪声）
  const skipPrefixes = ['/api/', '/images/', '/img/', '/css/', '/js/', '/fonts/', '/favicon', '/robots.txt', '/sitemap'];
  const skipExts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.txt', '.xml', '.webmanifest', '.json', '.map'];
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
