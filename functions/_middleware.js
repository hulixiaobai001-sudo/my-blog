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
  const headers = response.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self'; font-src 'self' data:;");
  return response;
}
