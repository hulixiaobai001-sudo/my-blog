export async function onRequestGet(context) {
  const { env } = context;
  try {
    await env.DB.exec('ALTER TABLE users ADD COLUMN qq TEXT DEFAULT \'\'');
  } catch(e) {}
  try {
    await env.DB.exec('ALTER TABLE users ADD COLUMN bio TEXT DEFAULT \'\'');
  } catch(e) {}
  try {
    await env.DB.exec('ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT \'\'');
  } catch(e) {}
  try {
    await env.DB.exec('ALTER TABLE users ADD COLUMN show_qq INTEGER DEFAULT 0');
  } catch(e) {}
  await env.DB.prepare("UPDATE users SET qq='3441972628' WHERE username='白沁'").run();
  return new Response(JSON.stringify({ ok: true }));
}
