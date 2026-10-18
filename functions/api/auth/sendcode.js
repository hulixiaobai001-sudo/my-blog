import { connect } from 'cloudflare:sockets';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, code } = await request.json();

    const socket = connect({ hostname: 'smtp.163.com', port: 465, secureTransport: 'on', allowHalfOpen: false });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    let buf = '';
    async function readReply() {
      buf = '';
      while (true) {
        const { value } = await reader.read();
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\r\n');
        if (lines.length >= 2 && lines[lines.length - 2].length >= 4 && lines[lines.length - 2][3] === ' ') break;
      }
      return buf;
    }
    async function send(s) {
      await writer.write(enc.encode(s + '\r\n'));
    }

    await readReply();
    await send('EHLO blog.ba3pkz.top'); await readReply();
    await send('AUTH LOGIN'); await readReply();
    await send(btoa('hulixiaobai1970@163.com')); await readReply();
    await send(btoa(env.SMTP_PASS)); await readReply();
    await send('MAIL FROM:<hulixiaobai1970@163.com>'); await readReply();
    await send('RCPT TO:<' + email + '>'); await readReply();
    await send('DATA'); await readReply();
    const subject = btoa('你的验证码');
    const body = 'From: =?UTF-8?B?' + btoa('狐狸白沁个人站') + '?= <hulixiaobai1970@163.com>\r\n' +
      'To: <' + email + '>\r\n' +
      'Subject: =?UTF-8?B?' + subject + '?=\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      '\r\n你的验证码是：' + code + '\n5分钟内有效。\r\n.';
    await send(body); await readReply();
    await send('QUIT');
    await writer.close();
    await socket.close();

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
