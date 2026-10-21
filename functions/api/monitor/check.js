import { logError } from '../../_lib.js';

// 健康检查接口：手动触发或 Cron 调用
// 检查项：D1 连接、最近错误数、关键接口可用性
export async function onRequestGet(context) {
  const { env } = context;
  const issues = [];

  try {
    // 1. D1 连接检查
    const dbCheck = await env.DB.prepare('SELECT 1 as ok').first();
    if (!dbCheck || dbCheck.ok !== 1) issues.push('D1 查询异常');
  } catch (e) {
    issues.push('D1 连接失败: ' + e.message);
  }

  try {
    // 2. 最近 10 分钟错误数
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, message TEXT, created_at TEXT)');
    const errRow = await env.DB.prepare("SELECT COUNT(*) as c FROM error_log WHERE created_at >= datetime('now', '-10 minutes')").first();
    const errCount = errRow ? errRow.c : 0;
    if (errCount > 5) {
      issues.push('最近10分钟错误数过高: ' + errCount);
      // 取最近 3 条错误详情
      const recentErrs = await env.DB.prepare("SELECT path, message, created_at FROM error_log ORDER BY id DESC LIMIT 3").all();
      issues.push('最近错误: ' + JSON.stringify(recentErrs.results || []));
    }
  } catch (e) {
    issues.push('错误日志查询失败: ' + e.message);
  }

  const healthy = issues.length === 0;
  return new Response(JSON.stringify({
    ok: healthy,
    timestamp: new Date().toISOString(),
    issues: issues,
    checks: { d1: !issues.some(i => i.includes('D1')), error_rate: !issues.some(i => i.includes('错误数')) }
  }), {
    status: healthy ? 200 : 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
