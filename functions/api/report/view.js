export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400 });

  const image = await env.IMAGES_KV.get(key, { type: 'arrayBuffer' });
  if (!image) return new Response('Not found', { status: 404 });

  return new Response(image, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }
  });
}
