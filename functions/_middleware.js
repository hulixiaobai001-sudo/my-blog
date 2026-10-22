export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 简单WAF：拦截常见攻击payload
  const blockedPatterns = [
    /union\s+select/i, /drop\s+table/i, /insert\s+into/i, /delete\s+from/i,
    /<script/i, /javascript:/i, /onerror\s*=/i, /onload\s*=/i,
    /'\s*or\s*'1'\s*=\s*'1/i, /--\s*$/, /\/\*.*\*\//s,
    /eval\s*\(/i, /document\.cookie/i, /localStorage\.clear/i
  ];
  const queryStr = url.search;
  for (const p of blockedPatterns) {
    if (p.test(queryStr)) return new Response('Forbidden', { status: 403 });
  }

  // API接口限制请求体大小
  if (url.pathname.startsWith('/api/')) {
    const ct = request.headers.get('Content-Length');
    if (ct && parseInt(ct) > 1024 * 1024) return new Response('Payload Too Large', { status: 413 });
  }

  const response = await context.next();

  // 404 异常访问记录（跳过 API 与静态资源，供管理后台审核）
  try {
    if (response.status === 404) {
      const path = url.pathname;
      const skipPrefixes = ['/api/', '/images/', '/img/', '/css/', '/js/', '/fonts/', '/favicon', '/robots.txt', '/sitemap'];
      const skipExts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.txt', '.xml', '.webmanifest'];
      if (skipPrefixes.some(p => path.startsWith(p))) return finalize();
      if (skipExts.some(e => path.toLowerCase().endsWith(e))) return finalize();

      const ip = request.headers.get('CF-Connecting-IP') || '';
      const ua = request.headers.get('User-Agent') || '';
      const referer = request.headers.get('Referer') || '';
      const lower = path.toLowerCase();
      const suspicious = ['wp-admin', 'wp-login', 'xmlrpc', '.env', '.git', 'config.php', 'config.json',
        'adminer', 'phpmyadmin', 'web.config', 'shell', 'cmd', 'exec', 'eval', 'sql', 'backup', 'bak.',
        'dump', 'passwd', 'shadow', 'aws', 'secret', 'token', 'login.php', '.php', 'jsp', 'aspx', 'cgi-bin'];
      const intent = suspicious.some(k => lower.includes(k)) ? '疑似扫描' : (path.length > 120 ? '异常路径' : '普通404');

      // 同 IP 60 秒限一条，防刷库
      const rateKey = 'seclog:' + ip;
      const last = await env.AUTH_KV.get(rateKey);
      if (!last) {
        await env.AUTH_KV.put(rateKey, String(Date.now()), { expirationTtl: 60 });
        try {
          await env.DB.exec("CREATE TABLE IF NOT EXISTS security_log (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, ip TEXT, ua TEXT, referer TEXT, intent TEXT, handled INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))");
        } catch (e) {}
        try {
          await env.DB.prepare('INSERT INTO security_log (path, ip, ua, referer, intent) VALUES (?, ?, ?, ?, ?)')
            .bind(path.slice(0, 300), String(ip).slice(0, 64), String(ua).slice(0, 300), String(referer).slice(0, 300), intent).run();
        } catch (e) {}
      }
    }
  } catch (e) {}

  const headers = response.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self'; font-src 'self' data:;");
  return response;
}
