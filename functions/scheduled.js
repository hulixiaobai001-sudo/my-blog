// Cron 定时任务：每 10 分钟执行一次健康检查
// 配置在 wrangler.jsonc 的 triggers.crons 中
// 飞书机器人通知：设置环境变量 FEISHU_WEBHOOK 后自动推送告警

export async function scheduled(event, env, ctx) {
  const issues = [];

  try {
    // 检查最近 10 分钟错误数
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, message TEXT, created_at TEXT)');
    const errRow = await env.DB.prepare("SELECT COUNT(*) as c FROM error_log WHERE created_at >= datetime('now', '-10 minutes')").first();
    const errCount = errRow ? errRow.c : 0;

    if (errCount > 5) {
      issues.push('⚠️ 最近10分钟错误数: ' + errCount);
      const recentErrs = await env.DB.prepare("SELECT path, message, created_at FROM error_log ORDER BY id DESC LIMIT 5").all();
      for (const e of (recentErrs.results || [])) {
        issues.push('  [' + e.created_at + '] ' + e.path + ': ' + e.message);
      }
    }

    // D1 连接检查
    try {
      await env.DB.prepare('SELECT 1').first();
    } catch (e) {
      issues.push('❌ D1 连接失败: ' + e.message);
    }

    // 推送飞书机器人（如果配置了 webhook）
    if (issues.length > 0 && env.FEISHU_WEBHOOK) {
      const text = '【狐狸白沁个人站监控告警】\n' + issues.join('\n') + '\n时间: ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      await fetch(env.FEISHU_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: text } })
      });
    }

    // 每日汇总（早上 9 点左右）
    const now = new Date();
    const hour = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }));
    if (hour === 9 && env.FEISHU_WEBHOOK) {
      const regRow = await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-1 day')").first().catch(() => ({ c: 0 }));
      const totalErrRow = await env.DB.prepare("SELECT COUNT(*) as c FROM error_log WHERE created_at >= datetime('now', '-1 day')").first().catch(() => ({ c: 0 }));
      const dailyText = '【狐狸白沁个人站·每日汇总】\n昨日新增注册: ' + (regRow ? regRow.c : 0) + '\n昨日错误数: ' + (totalErrRow ? totalErrRow.c : 0) + '\n时间: ' + now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      await fetch(env.FEISHU_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: dailyText } })
      });
    }
  } catch (e) {
    // 监控自身失败不影响站点
    console.error('monitor scheduled error:', e);
  }
}
