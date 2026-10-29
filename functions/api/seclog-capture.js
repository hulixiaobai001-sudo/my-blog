// 404 风控捕获函数：由前端 404 页（layouts/404.html）内嵌上报触发。
// 请求格式：POST|GET /api/seclog-capture?path=<真实404路径>
// 静态 404.html 优先于 _redirects，因此不再使用兜底规则，改由页面 JS 上报。
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  // 上报的真实路径来自 ?path=；未带参数时退回 url.pathname（兼容旧兜底调用）
  const path = (url.searchParams.get('path') || url.pathname || '/').slice(0, 300);

  // 跳过 API 与静态资源扩展（与 _middleware 过滤口径一致，防噪声）
  const skipPrefixes = ['/api/', '/images/', '/img/', '/css/', '/js/', '/fonts/', '/favicon', '/robots.txt', '/sitemap'];
  const skipExts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.txt', '.xml', '.webmanifest', '.json', '.map'];
  // 根路径与首页：部署切换窗口期静态文件短暂 miss 会误触，属部署噪声而非异常访问，一律不记录。
  const isRootNoise = path === '/' || path === '/index.html' || path === '/index.htm';
  if (isRootNoise) {
    return new Response('Not Found', { status: 404 });
  }
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

  return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
