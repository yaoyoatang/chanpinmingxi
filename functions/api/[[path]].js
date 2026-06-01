// Cloudflare Pages Function - GitHub API 代理
// 所有 /api/* 请求会被转发到 api.github.com

export async function onRequest(context) {
  const { request } = context;

  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // 获取原始路径（去掉 /api 前缀）
  const url = new URL(request.url);
  const targetPath = url.pathname.replace(/^\/api/, '') + url.search;
  const targetUrl = `https://api.github.com${targetPath}`;

  try {
    // 转发请求到 GitHub API
    const ghHeaders = new Headers(request.headers);
    ghHeaders.delete('host'); // 移除 Pages 的 host header

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: ghHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.blob() : undefined,
    });

    // 创建响应，添加 CORS headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
