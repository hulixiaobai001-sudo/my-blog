// about页面配置
const DEFAULT_CONFIG = {
  name: '白沁',
  badges: ['涿州','ENFP-T','业余无线电','福瑞','二次元','摄影'],
  info: [
    { label: '名字', value: '白沁（小白/白狐/狐狐）' },
    { label: '坐标', value: '来自东北，现居涿州' },
    { label: '属性', value: '18岁 · 处女座 · ENFP-T' },
    { label: '性向', value: '狐性恋' }
  ],
  bio: '一名苦命的电商学生，24h 在线。短期出毛的神，非常爱喝酒的狐狸。',
  activities: [
    { label: '业余无线电', value: 'BA3PKZ，欢迎换 QSL 卡' },
    { label: '摄影', value: '大疆重度发烧友' },
    { label: '印刷', value: '名片印刷狂魔' },
    { label: '日常', value: '上学、旅游、兽聚' }
  ],
  quote: '避雷：快手、特定称呼、NPD 人格。',
  contacts: [
    { name: '哔哩哔哩', url: 'https://b23.tv/j6Bfvnq', sub: '狐狸不想营业' },
    { name: 'QRZ.com', url: 'https://www.qrz.com/db/BA3PKZ', sub: 'BA3PKZ' },
    { name: 'GitHub', url: 'https://github.com/hulixiaobai001-sudo', sub: 'hulixiaobai001-sudo' },
    { name: '抖音', url: '#', sub: '狐狸不想干电商' },
    { name: 'QQ', url: '#', sub: '3441972628' },
    { name: '微信', url: '#', sub: 'HLBQBA3PKZ' },
    { name: '邮箱', url: 'mailto:3441972628@qq.com', sub: '3441972628@qq.com' }
  ]
};

export async function onRequestGet(context) {
  const { env } = context;
  const cfg = await env.AUTH_KV.get('about_config', { type: 'json' });
  return Response.json({ config: cfg || DEFAULT_CONFIG });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session=([^;]+)/)?.[1];
  if (!token) return Response.json({ error: '未登录' }, { status: 401 });
  const sess = await env.AUTH_KV.get(`session:${token}`);
  if (!sess) return Response.json({ error: '未登录' }, { status: 401 });
  if (!JSON.parse(sess).isAdmin) return Response.json({ error: '无权限' }, { status: 403 });
  const body = await request.json();
  await env.AUTH_KV.put('about_config', JSON.stringify(body.config));
  return Response.json({ ok: true });
}
