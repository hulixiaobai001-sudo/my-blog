// catch-all：接管所有未匹配静态资源与具体 API 路由的请求
// 这些请求在 Pages 平台层原本直接返回 404（不经 Functions），
// 导致 _middleware.js 里的 404 风控记录分支永远无法执行。
// 本函数统一接管并以 404 响应，使中间件能捕获并写入安全日志。
export async function onRequest(context) {
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
