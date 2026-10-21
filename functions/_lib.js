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
