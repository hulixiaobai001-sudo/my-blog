export async function onRequestGet(context) {
  const { env } = context;
  await env.DB.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS qq TEXT DEFAULT \'\'');
  await env.DB.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT \'\'');
  await env.DB.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT \'\'');
  await env.DB.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS show_qq INTEGER DEFAULT 0');
  const r = await env.DB.prepare("UPDATE users SET qq='3441972628' WHERE username='白沁'").run();
  return new Response(JSON.stringify({ ok: true, updated: r }));
}
