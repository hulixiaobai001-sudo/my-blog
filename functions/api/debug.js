export async function onRequestGet({ env }) {
  const keys = Object.keys(env);
  return new Response(JSON.stringify({ keys, hasDB: !!env.DB, hasAuthKV: !!env.AUTH_KV, hasImagesKV: !!env.IMAGES_KV }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
