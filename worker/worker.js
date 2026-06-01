// Cloudflare Worker - GitHub API Proxy
// 部署后国内就能访问 GitHub API 了

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname + url.search;

    // 只代理 GitHub API
    const targetUrl = `https://api.github.com${path}`;

    try {
      const newHeaders = new Headers(request.headers);
      // 转发 Authorization 和 Content-Type
      const authHeader = request.headers.get('Authorization');
      if (authHeader) {
        newHeaders.set('Authorization', authHeader);
      }
      newHeaders.set('User-Agent', 'chanpinmingxi-app');
      newHeaders.delete('Host');
      // 移除可能导致问题的头
      newHeaders.delete('cf-connecting-ip');
      newHeaders.delete('cf-ray');
      newHeaders.delete('cf-visitor');

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });

      const responseData = await response.arrayBuffer();

      return new Response(responseData, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...Object.fromEntries(response.headers),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': '*',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
