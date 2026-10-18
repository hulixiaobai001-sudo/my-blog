import { connect } from 'cloudflare:sockets';

function readResponse(reader, buffer = '') {
  return new Promise((resolve, reject) => {
    const chunk = new Uint8Array(1024);
    function read() {
      reader.read(chunk).then(({ done, value }) => {
        if (done) return resolve(buffer);
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split('\r\n');
        const last = lines[lines.length - 2] || lines[lines.length - 1];
        if (last.length >= 4 && last[3] === ' ') return resolve(buffer);
        read();
      }).catch(reject);
    }
    read();
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { email, code } = await request.json();

  try {
    const socket = connect({ hostname: 'smtp.163.com', port: 465, secureTransport: 'on', allowHalfOpen: false });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const enc = new TextEncoder();

    async function cmd(c) {
      await writer.write(enc.encode(c + '\r\n'));
      return readResponse(reader);
    }

    await readResponse(reader);
    await cmd('EHLO blog.ba3pkz.top');
    await cmd('AUTH LOGIN');
    await cmd(btoa('hulixiaobai1970@163.com'));
    await cmd(btoa(env.SMTP_PASS));
    await cmd(`MAIL FROM:<hulixiaobai1970@163.com>`);
    await cmd(`RCPT TO:<${email}>`);
    await cmd('DATA');
    const subject = btoa('你的验证码');
    const msg = `From: =?UTF-8?B?${btoa('狐狸白沁个人站')}?= <hulixiaobai1970@163.com>\r\nTo: <${email}>\r\nSubject: =?UTF-8?B?${subject}?=\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n你的验证码是：${code}\n5分钟内有效。\r\n.`;
    await cmd(msg);
    await cmd('QUIT');
    await writer.close();
    await socket.close();

    return new Response(JSON.stringify({ ok: true }));
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
