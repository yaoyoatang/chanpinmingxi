// 产品明细分销系统 - Cloudflare Pages Function 后端
// 数据存储：Cloudflare KV (通过环境变量绑定)
// 路径：/api/data, /api/sync, /api/user
// v2

const DATA_KEY = 'app_data'

// 确保数据结构正确（兼容旧数据）
function ensureSchema(data) {
  if (!data) data = {}
  if (!Array.isArray(data.products)) data.products = []
  if (!data.config || typeof data.config !== 'object') data.config = { brands: [], categories: [], priceVisible: true, hidePriceDefault: false }
  // users 兼容：旧数据可能是对象，转成数组
  if (!Array.isArray(data.users)) {
    if (data.users && typeof data.users === 'object') {
      data.users = Object.values(data.users)
    } else {
      data.users = []
    }
  }
  // invites 兼容：旧数据可能是 inviteCodes 对象
  if (!Array.isArray(data.invites)) {
    if (data.inviteCodes && typeof data.inviteCodes === 'object') {
      data.invites = Object.values(data.inviteCodes)
    } else {
      data.invites = []
    }
  }
  if (typeof data._version !== 'number') data._version = 1
  return data
}

async function readData(env) {
  const kv = env.DATA_KV
  if (!kv) {
    throw new Error('KV not bound. Please bind a KV namespace named DATA_KV in Pages settings.')
  }
  const raw = await kv.get(DATA_KEY)
  let data
  if (raw) {
    data = JSON.parse(raw)
  } else {
    // 首次使用，创建默认数据（和前端数据结构保持一致）
    data = {
      products: [],
      config: { brands: [], categories: [], priceVisible: true, hidePriceDefault: false },
      users: [],
      invites: [],
      _version: 1
    }
    await kv.put(DATA_KEY, JSON.stringify(data))
  }
  return ensureSchema(data)
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // CORS 预检
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })
  }

  try {
    // GET /api/data — 获取数据
    if (method === 'GET' && path === '/api/data') {
      const data = await readData(env)
      return jsonResponse(data)
    }

    // POST/PUT /api/data — 保存数据
    if ((method === 'POST' || method === 'PUT') && path === '/api/data') {
      const body = await request.json()
      body._version = (body._version || 0) + 1
      body._updatedAt = new Date().toISOString()
      await env.DATA_KV.put(DATA_KEY, JSON.stringify(body))
      return jsonResponse({ success: true, version: body._version })
    }

    // POST /api/sync — 同步数据
    if (method === 'POST' && path === '/api/sync') {
      const sd = await request.json()
      const cloud = await readData(env)
      const cv = cloud._version || 0
      const lv = sd._version || 0
      let result = cloud
      if (lv >= cv) {
        sd._version = cv + 1
        sd._updatedAt = new Date().toISOString()
        await env.DATA_KV.put(DATA_KEY, JSON.stringify(sd))
        result = sd
      }
      return jsonResponse({ success: true, data: result, version: result._version })
    }

    // GET /api/user — 用户登录
    if (method === 'GET' && path === '/api/user') {
      const data = await readData(env)
      return jsonResponse({ login: 'admin', valid: true, data })
    }

    return jsonResponse({ error: 'not found' }, 404)

  } catch (e) {
    console.error('API error:', e.message)
    return jsonResponse({ error: e.message }, 500)
  }
}
