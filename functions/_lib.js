// 全站共享安全工具
// 1) sanitize：纵深防御型内容清洗（去除脚本/事件属性/javascript 协议，保留其他文本原样，
//    前端渲染层仍须 escapeHtml，二者配合防止 XSS）
// 2) randomToken：兼容 Cloudflare Workers/Pages 运行时的随机 token（不用 crypto.randomUUID）

export function sanitize(str, maxLen) {
  let s = String(str === undefined || str === null ? '' : str);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
       .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
       .replace(/<object[\s\S]*?<\/object>/gi, '')
       .replace(/<embed[\s\S]*?<\/embed>/gi, '')
       .replace(/<style[\s\S]*?<\/style>/gi, '')
       .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
       .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
       .replace(/javascript\s*:/gi, '')
       .replace(/vbscript\s*:/gi, '')
       .replace(/data\s*:\s*text\/html/gi, '');
  if (maxLen && maxLen > 0 && s.length > maxLen) {
    s = s.slice(0, maxLen);
  }
  return s;
}

export function randomToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// 社区等级：按积分划分 LV1~LV5
export function getLevel(points) {
  const p = Number(points) || 0;
  if (p >= 3000) return 5;
  if (p >= 1000) return 4;
  if (p >= 500) return 3;
  if (p >= 100) return 2;
  return 1;
}

// 统一错误日志：写入 D1 error_log 表，供监控 Cron 检查
export async function logError(env, path, error) {
  try {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, message TEXT, created_at TEXT)');
    var msg = String(error && error.message ? error.message : error).slice(0, 500);
    await env.DB.prepare('INSERT INTO error_log (path, message, created_at) VALUES (?, ?, datetime(\'now\'))').bind(path, msg).run();
  } catch (e) {
    // 日志写入失败不影响主流程
  }
}

const DEFAULT_SENSITIVE_WORDS = ['色情', '赌博', '毒品', '枪支', '暴力', '诈骗', '黑客', '刷单', '代孕', '迷药'];

// 敏感词库：后台可配置，读取失败时回退默认词表
export async function getSensitiveWords(env) {
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS sensitive_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE, created_at TEXT)');
    const { results } = await env.DB.prepare('SELECT word FROM sensitive_words').all();
    if (results && results.length > 0) return results.map(r => r.word);
  } catch (e) {}
  return DEFAULT_SENSITIVE_WORDS;
}

// 封禁检查：banned 硬封禁 + ban_until 限期封禁（到期自动解封）
// 返回 null 表示可用；返回字符串表示封禁原因
export async function checkBanned(env, userId) {
  try {
    const me = await env.DB.prepare('SELECT banned, ban_until FROM users WHERE id = ?').bind(userId).first();
    if (!me) return '用户不存在';
    // 先查限期封禁：到期自动解封（同时清 banned）
    if (me.ban_until) {
      const until = new Date(String(me.ban_until).replace(' ', 'T') + 'Z');
      const now = new Date();
      if (until <= now) {
        await env.DB.prepare('UPDATE users SET banned = 0, ban_until = NULL WHERE id = ?').bind(userId).run();
        return null;
      }
      return '账号封禁中，解封时间：' + String(me.ban_until);
    }
    if (me.banned) return '账号已被封禁';
    return null;
  } catch (e) {
    return null;
  }
}

// 管理日志：记录后台关键操作，供站长审计
export async function logAdmin(env, actorId, action, detail) {
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT, detail TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
    await env.DB.prepare('INSERT INTO admin_log (actor_id, action, detail) VALUES (?, ?, ?)').bind(actorId, String(action).slice(0, 50), String(detail || '').slice(0, 500)).run();
  } catch (e) {}
}

// 站点开关：全局配置（注册/留言/维护模式/BGM等）
export async function getSiteSettings(env) {
  const defaults = { registration_open: '1', guestbook_open: '1', maintenance_mode: '0', bgm_url: '' };
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT)');
    const { results } = await env.DB.prepare('SELECT key, value FROM site_settings').all();
    for (const r of (results || [])) defaults[r.key] = r.value;
  } catch (e) {}
  return defaults;
}

// 系统通知：from_user=0 表示系统消息
export async function sendSystemMessage(env, userId, title, content) {
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, content TEXT, read INTEGER DEFAULT 0, from_user INTEGER DEFAULT 0, created_at TEXT)');
    await env.DB.prepare('INSERT INTO messages (user_id, title, content, read, from_user, created_at) VALUES (?, ?, ?, 0, 0, datetime(\'now\'))')
      .bind(userId, String(title).slice(0, 100), String(content).slice(0, 2000)).run();
  } catch (e) {}
}
