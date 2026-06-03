// 产品明细分销系统 - Cloudflare Pages Function 后端
// 数据存储：Cloudflare KV (通过环境变量绑定)
// 路径：/api/data, /api/sync, /api/user
// v3 - 增加 Token 认证

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

// 从请求中提取 Token
function extractToken(request) {
  const authHeader = request.headers.get('Authorization') || ''
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim()
  const url = new URL(request.url)
  return (url.searchParams.get('token') || '').trim()
}

// 验证 Token - 返回 { ok, data, isFirstSetup }
async function verifyToken(request, env) {
  const token = extractToken(request)
  if (!token || token.length < 3) {
    return { ok: false, status: 401, message: '请输入有效的访问令牌' }
  }

  const data = await readData(env)
  const apiToken = (data.config && data.config.apiToken) ? data.config.apiToken.trim() : ''

  if (apiToken) {
    // 已设置管理令牌：必须精确匹配
    if (token !== apiToken) {
      console.log(`[认证失败] Token 不匹配 (输入长度:${token.length}, 正确长度:${apiToken.length})`)
      return { ok: false, status: 401, message: '访问令牌无效' }
    }
    return { ok: true, data, isFirstSetup: false }
  } else {
    // 首次使用：将当前 token 设为管理令牌
    console.log(`[首次初始化] 设置 API 管理令牌 (长度:${token.length})`)
    if (!data.config) data.config = {}
    data.config.apiToken = token
    data._version = (data._version || 0) + 1
    data._updatedAt = new Date().toISOString()
    await env.DATA_KV.put(DATA_KEY, JSON.stringify(data))
    return { ok: true, data, isFirstSetup: true }
  }
}

// 验证写入权限（复用 verifyToken）
async function requireAuth(request, env) {
  return await verifyToken(request, env)
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
  }

  try {
    // GET /api/data — 获取数据（无需认证，访客可查看）
    if (method === 'GET' && path === '/api/data') {
      const data = await readData(env)
      return jsonResponse(data)
    }

    // POST/PUT /api/data — 保存数据（需要 Token 认证）
    if ((method === 'POST' || method === 'PUT') && path === '/api/data') {
      const auth = await requireAuth(request, env)
      if (!auth.ok) return jsonResponse({ message: auth.message }, auth.status)

      const body = await request.json()
      body._version = (body._version || 0) + 1
      body._updatedAt = new Date().toISOString()

      // 保护 apiToken 不被覆盖删除
      if (auth.data.config && auth.data.config.apiToken && (!body.config || !body.config.apiToken)) {
        if (!body.config) body.config = {}
        body.config.apiToken = auth.data.config.apiToken
      }

      await env.DATA_KV.put(DATA_KEY, JSON.stringify(body))
      return jsonResponse({ success: true, version: body._version })
    }

    // POST /api/sync — 同步数据（需要 Token 认证）
    if (method === 'POST' && path === '/api/sync') {
      const auth = await requireAuth(request, env)
      if (!auth.ok) return jsonResponse({ message: auth.message }, auth.status)

      const sd = await request.json()
      const cloud = auth.data

      // 产品：以id为key合并，客户端优先
      // 合并云端和客户端的已删除产品ID
      const deletedProductIds = new Set([...(cloud._deletedProductIds || []), ...(sd._deletedProductIds || [])])

      // 云端有但客户端没有的产品 = 客户端已删除 → 加入删除集合
      const clientProductIds = new Set((sd.products || []).map(p => p.id))
      ;(cloud.products || []).forEach(p => {
        if (!clientProductIds.has(p.id)) {
          deletedProductIds.add(p.id)
        }
      })

      const productMap = {}
      ;(cloud.products || []).forEach(p => { if (!deletedProductIds.has(p.id)) productMap[p.id] = p })
      ;(sd.products || []).forEach(p => { if (!deletedProductIds.has(p.id)) productMap[p.id] = p })  // 客户端优先
      const mergedProducts = Object.values(productMap)

      // 用户：以id为key合并
      const userMap = {}
      ;(cloud.users || []).forEach(u => { userMap[u.id] = u })
      ;(sd.users || []).forEach(u => { userMap[u.id] = u })
      const mergedUsers = Object.values(userMap)

      // 邀请码：以code为key合并
      const inviteMap = {}
      ;(cloud.invites || []).forEach(i => { inviteMap[i.code] = i })
      ;(sd.invites || []).forEach(i => { inviteMap[i.code] = i })
      const mergedInvites = Object.values(inviteMap)

      // 配置：深度合并，保护 apiToken
      const mergedConfig = { ...(cloud.config || {}), ...(sd.config || {}) }
      if (cloud.config && cloud.config.apiToken && !sd.config?.apiToken) {
        mergedConfig.apiToken = cloud.config.apiToken
      }

      const result = {
        products: mergedProducts,
        users: mergedUsers,
        invites: mergedInvites,
        config: mergedConfig,
        _deletedProductIds: [...deletedProductIds],
        _version: (cloud._version || 0) + 1,
        _updatedAt: new Date().toISOString()
      }

      await env.DATA_KV.put(DATA_KEY, JSON.stringify(result))
      return jsonResponse({ success: true, data: result, version: result._version })
    }

    // GET/POST /api/user — Token 验证登录（必须提供有效 Token）
    if ((method === 'GET' || method === 'POST') && path === '/api/user') {
      const auth = await verifyToken(request, env)
      if (!auth.ok) {
        return jsonResponse({ login: null, valid: false, message: auth.message }, auth.status)
      }

      const data = auth.data
      return jsonResponse({
        login: 'admin',
        name: data.config?.adminName || '管理员',
        valid: true,
        role: 'admin',
        firstSetup: auth.isFirstSetup,
        message: auth.isFirstSetup ? '首次连接成功，该令牌已设为管理密钥' : undefined
      })
    }

    return jsonResponse({ error: 'not found' }, 404)

  } catch (e) {
    console.error('API error:', e.message)
    return jsonResponse({ error: e.message }, 500)
  }
}
