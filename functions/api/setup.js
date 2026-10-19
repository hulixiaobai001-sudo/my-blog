export async function onRequestGet(context) {
  const { env } = context;
  await env.DB.prepare("UPDATE users SET show_qq=1, bio='站长，无线电操作员BA3PKZ，爱喝酒的狐狸' WHERE username='白沁'").run();
  return new Response(JSON.stringify({ ok: true }));
}
