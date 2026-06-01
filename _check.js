
// ==================== 配置 ====================
const CONFIG = {
  owner: 'yaoyoatang',
  repo: 'product-data',
  dataPath: 'data.json',
}

// ==================== 全局状态 ====================
const state = {
  currentPage: 'login',
  pageStack: [],
  token: '',              // GitHub PAT (管理员云端模式)
  products: [],
  config: {},
  users: [],             // 所有用户列表
  invites: [],           // 邀请码列表
  currentUser: null,     // 当前登录的用户对象
  currentFilter: '全部',
  searchKeyword: '',
  currentProduct: null,
  editProductId: null,
  uploadImages: [],
  soldProductId: null,
  dataSha: '',
  cloudSync: false,      // 是否开启云端同步
  pendingCount: 0,       // 待同步的本地变更数
  editingUserId: null,   // 正在编辑权限的用户ID
}

// ==================== 工具函数 ====================
function showToast(msg, duration = 2000) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), duration)
}

function showSyncStatus(text, duration = 1500) {
  const el = document.getElementById('syncStatus')
  el.textContent = text
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), duration)
}

function fmtMoney(v) {
  if (v === undefined || v === null || v === '') return '—'
  const n = parseFloat(v)
  if (isNaN(n) || n === 0) return '—'
  return '¥' + n.toFixed(2)
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
}

function generateInviteCodeStr() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // 去掉容易混淆的字符
  let code = ''
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
  return code
}

function showLoading(text = '加载中…') {
  document.getElementById('loadingText').textContent = text
  document.getElementById('loadingOverlay').classList.remove('hidden')
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden')
}

function escHtml(s) {
  if (!s) return ''
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

// 简单密码哈希（非加密用途，仅防止明文存储）
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return 'h_' + Math.abs(hash).toString(36)
}

function isCurrentUserAdmin() {
  return state.currentUser && state.currentUser.role === 'admin'
}

function hasPermission(perm) {
  if (!state.currentUser) return false
  if (isCurrentUserAdmin()) return true
  const p = state.currentUser.permissions || {}
  if (perm === 'canViewAll') return !(p.brands && p.brands.length > 0)
  return !!p[perm]
}

// ==================== GitHub API 核心层 ====================
const GH_API = '/api'

async function ghFetch(path, options = {}) {
  const url = `${GH_API}${path}`
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${state.token}`,
    ...options.headers,
  }
  const res = await fetch(url, { ...options, headers })
  if (res.status === 401) throw new Error('Token无效或已过期')
  if (res.status === 403) throw new Error('权限不足')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`请求失败 (${res.status})`)
  const result = await res.json()
  if (result.sha) state.dataSha = result.sha
  return result
}

async function ghReadData() {
  try {
    const result = await ghFetch(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}`)
    if (!result) return getDefaultData()
    const decoded = atob(result.content)
    const data = JSON.parse(decoded)
    state.dataSha = result.sha
    return ensureDataSchema(data)
  } catch (err) {
    if (err.message.includes('Not Found')) return getDefaultData()
    throw err
  }
}

async function ghWriteData(data) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))))
  const body = {
    message: `update data ${new Date().toLocaleString()}`,
    content: content,
  }
  if (state.dataSha) body.sha = state.dataSha
  const result = await ghFetch(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  state.dataSha = result.content.sha
  return result
}

async function ghCreateRepo() {
  await ghFetch('/user/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: CONFIG.repo,
      description: '产品明细 - 数据存储',
      private: true,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
  })
}

// ==================== 数据模型 ====================
function getDefaultData() {
  return {
    products: [],
    config: { password: '', hidePriceDefault: false },
    users: [],
    invites: [],
  }
}

function ensureDataSchema(data) {
  if (!data.users) data.users = []
  if (!data.invites) data.invites = []
  if (!data.config) data.config = {}
  if (data.config.hidePriceDefault === undefined) data.config.hidePriceDefault = false
  return data
}

// ==================== 本地缓存 ====================
let localCache = null

function getLocalData() {
  if (!localCache) {
    try { localCache = JSON.parse(localStorage.getItem('pm_cache') || '{"products":[],"config":[],"users":[],"invites":[]}') } catch(e) { localCache = getDefaultData() }
  }
  return localCache
}

function saveLocalCache(data) {
  localCache = data
  try { localStorage.setItem('pm_cache', JSON.stringify(data)) } catch(e) {}
}

// ==================== 数据操作层 ====================
async function pullData(showLoadingFlag = true) {
  if (!state.cloudSync) {
    const cached = getLocalData()
    applyData(cached)
    return true
  }
  if (showLoadingFlag) showLoading('正在同步数据…')
  try {
    const data = await ghReadData()
    saveLocalCache(data)
    applyData(data)
    if (showLoadingFlag) hideLoading()
    return true
  } catch (err) {
    if (showLoadingFlag) hideLoading()
    const cached = getLocalData()
    applyData(cached)
    showToast('⚠️ 使用离线数据：' + err.message)
    return false
  }
}

function applyData(data) {
  state.products = data.products || []
  state.config = data.config || {}
  state.users = data.users || []
  state.invites = data.invites || []
}

async function pushData() {
  const data = collectData()
  saveLocalCache(data)

  if (!state.cloudSync) {
    state.pendingCount++
    showSyncStatus('💾 已保存（本地）')
    updateSyncUI()
    return true
  }
  showSyncStatus('正在同步…')
  try {
    await ghWriteData(data)
    state.pendingCount = 0
    showSyncStatus('✅ 已同步')
    updateSyncUI()
    return true
  } catch (err) {
    state.pendingCount++
    showSyncStatus(`⚠️ 待同步(${state.pendingCount})`)
    showToast('网络异常，已保存到本地，恢复网络后点击🔄同步')
    updateSyncUI()
    return false
  }
}

function collectData() {
  return { products: state.products, config: state.config, users: state.users, invites: state.invites }
}

// ==================== 路由 ====================
function goPage(name, pushStack = true) {
  if (pushStack && state.currentPage !== name) {
    state.pageStack.push(state.currentPage)
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById(name + '-page').classList.add('active')
  state.currentPage = name

  const tabbar = document.getElementById('tabbar')
  if (['index', 'add'].includes(name)) {
    tabbar.style.display = 'flex'
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'))
    const activeTab = document.getElementById('tab-' + name)
    if (activeTab) activeTab.classList.add('active')
  } else {
    tabbar.style.display = 'none'
  }

  updateUIForPermissions()

  if (name === 'index') { renderProductList(); updateSyncUI() }
  if (name === 'add') initAddPage()
  if (name === 'manage') loadManageConfig()
  if (name === 'users') renderUserList()
}

function goBack() {
  const prev = state.pageStack.pop()
  if (prev) goPage(prev, false)
  else goPage('index', false)
}

// 根据当前用户权限更新界面
function updateUIForPermissions() {
  const admin = isCurrentUserAdmin()
  // 管理入口：只有管理员可见
  const manageEntry = document.getElementById('manageEntry')
  if (manageEntry) manageEntry.style.display = admin ? '' : 'none'
  // 添加按钮
  const fabAdd = document.getElementById('fabAdd')
  if (fabAdd) fabAdd.style.display = hasPermission('canAdd') ? '' : 'none'
  // 详情编辑按钮
  const detailEditBtn = document.getElementById('detailEditBtn')
  if (detailEditBtn) detailEditBtn.style.display = hasPermission('canEdit') ? '' : 'none'
}

// ==================== 登录Tab切换 ====================
function switchLoginTab(tab) {
  document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'))
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active')
  document.getElementById('login' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Panel').style.display = ''
  if (tab === 'account') document.getElementById('loginTokenPanel').style.display = 'none'
  else document.getElementById('loginAccountPanel').style.display = 'none'
}

// ==================== 账号登录 ====================
async function doAccountLogin() {
  const username = document.getElementById('loginUsername').value.trim()
  const password = document.getElementById('loginPassword').value.trim()
  if (!username || !password) { showToast('请输入用户名和密码'); return }

  const btn = document.getElementById('acctLoginBtn')
  const errEl = document.getElementById('loginErr')

  btn.disabled = true
  btn.textContent = '登录中…'
  errEl.style.display = 'none'

  // 先尝试本地模式（从localStorage读取用户数据）
  showLoading('验证账号…')
  let success = false
  let needCloud = false

  // 先检查本地缓存有没有用户
  const localData = getLocalData()
  const user = findUser(localData.users, username, password)

  if (user) {
    success = true
    // 检查是否有缓存的Token可以做云端同步
    const cachedToken = localStorage.getItem('pm_token')
    if (cachedToken && user.role === 'admin') {
      state.token = cachedToken
      // 尝试验证Token
      try {
        await ghFetch('/user')
        state.cloudSync = true
      } catch(e) {
        // Token失效了，继续本地模式
        state.cloudSync = false
      }
    }
  }

  if (!success && localData.pm_cloud_ready !== true) {
    // 本地没找到用户，也没有云标记，说明是纯本地模式
    hideLoading()
    errEl.textContent = '用户名或密码错误'
    errEl.style.display = 'block'
    btn.disabled = false
    btn.textContent = '登 录'
    return
  }

  // 如果有Token，尝试从云端拉取最新用户列表
  if (!success && state.token) {
    try {
      const cloudData = await ghReadData()
      const cloudUser = findUser(cloudData.users, username, password)
      if (cloudUser) {
        user = cloudUser
        success = true
        saveLocalCache(cloudData)
      }
    } catch(e) {
      // 云端拉取失败，继续
    }
  }

  hideLoading()

  if (!success) {
    errEl.textContent = '用户名或密码错误'
    errEl.style.display = 'block'
    btn.disabled = false
    btn.textContent = '登 录'
    return
  }

  // 登录成功
  state.currentUser = user
  applyData(localData)

  // 保存登录状态
  try { localStorage.setItem('pm_last_user', username) } catch(e) {}

  // 全局密码检查
  if (state.config.password && !isCurrentUserAdmin()) {
    const pwd = prompt('请输入访问密码：')
    if (pwd !== state.config.password) {
      showToast('密码错误')
      btn.disabled = false
      btn.textContent = '登 录'
      return
    }
  }

  showToast(`✅ 欢迎，${user.name || user.username}`)
  setTimeout(() => {
    goPage('index', false)
    showSyncStatus(state.cloudSync ? `☁️ ${user.name || user.username}` : `📱 ${user.name || user.username}`)
  }, 200)
}

function findUser(users, username, password) {
  if (!users || !users.length) return null
  const hashed = simpleHash(password)
  return users.find(u =>
    u.username === username &&
    u.password === hashed &&
    u.status !== 'disabled'
  ) || null
}

// ==================== Token登录（管理员） ====================
async function doTokenLogin() {
  const token = document.getElementById('tokenInput').value.trim()
  if (!token) { showToast('请输入Token'); return }

  const btn = document.getElementById('tokenLoginBtn')
  const errEl = document.getElementById('tokenLoginErr')
  btn.disabled = true
  btn.textContent = '连接中…'
  errEl.style.display = 'none'

  state.token = token

  try {
    showLoading('验证Token…')
    const ghUser = await ghFetch('/user')
    if (!ghUser || !ghUser.login) throw new Error('Token无效')
    hideLoading()

    // 检查/创建仓库
    showLoading('检查数据仓库…')
    let data = await ghReadData()
    if (data === null || (data.products === undefined)) {
      hideLoading()
      if (confirm('检测到这是首次使用。\n\n点击「确定」将自动创建私有仓库并初始化系统。')) {
        showLoading('初始化系统中…')
        await ghCreateRepo()
        const initData = getDefaultData()
        await ghWriteData(initInitAdminUser(initData, ghUser.login))
        data = initAdminData(initData, ghUser.login)
        hideLoading()
        showToast('✅ 系统初始化成功！请设置管理员账号密码')
      } else {
        btn.disabled = false
        btn.textContent = '连接 GitHub'
        return
      }
    } else {
      hideLoading()
    }

    // 查找或关联管理员账户
    state.cloudSync = true
    let adminUser = data.users.find(u => u.role === 'admin' && u.githubLogin === ghUser.login)

    if (!adminUser && data.users.length === 0) {
      // 首次：还没有任何用户，自动创建管理员
      data = initAdminData(data, ghUser.login)
      await ghWriteData(data)
      adminUser = data.users[0]
    }

    if (adminUser) {
      state.currentUser = adminUser
    } else {
      // 找到了用户列表但没有匹配的管理员，用第一个admin
      adminUser = data.users.find(u => u.role === 'admin')
      if (adminUser) {
        state.currentUser = adminUser
      } else {
        // 兜底：创建一个临时管理员身份
        state.currentUser = {
          id: generateId(),
          username: ghUser.login,
          name: ghUser.name || ghUser.login,
          role: 'admin',
          githubLogin: ghUser.login,
          permissions: { brands: [], hidePrice: false, canEdit: true, canAdd: true, canDelete: true },
          status: 'active',
        }
      }
    }

    applyData(data)
    saveLocalCache(data)
    localStorage.setItem('pm_token', token)
    localStorage.setItem('pm_cloud_ready', 'true')

    btn.textContent = '✅ 已连接'
    btn.style.background = '#07c160'
    showToast('☁️ 管理员登录成功')

    setTimeout(() => {
      goPage('index', false)
      showSyncStatus(`☁️ @${ghUser.login}`)
    }, 300)

  } catch (err) {
    hideLoading()
    errEl.textContent = err.message || '连接失败'
    errEl.style.display = 'block'
    btn.disabled = false
    btn.textContent = '连接 GitHub'
  }
}

function initAdminData(data, githubLogin) {
  if (!data.users) data.users = []
  // 检查是否已有admin
  const existingAdmin = data.users.find(u => u.role === 'admin')
  if (!existingAdmin) {
    data.users.push({
      id: generateId(),
      username: githubLogin.toLowerCase().replace(/[^a-z0-9]/g, '') || 'admin',
      password: '',  // 需要后续设置密码
      name: githubLogin,
      role: 'admin',
      githubLogin: githubLogin,
      permissions: { brands: [], hidePrice: false, canEdit: true, canAdd: true, canDelete: true },
      createdAt: new Date().toISOString(),
      status: 'active',
    })
  }
  return data
}

function initInitAdminUser(data, githubLogin) {
  return initAdminData(data, githubLogin)
}

// ==================== 同步系统 ====================
function updateSyncUI() {
  const syncBtn = document.getElementById('syncBtn')
  if (!syncBtn) return
  // 只在有用户登录且进入主页面时显示同步按钮
  if (state.currentUser && state.currentPage === 'index') {
    syncBtn.style.display = ''
    if (state.pendingCount > 0) {
      syncBtn.textContent = `🔄 ${state.pendingCount}`
      syncBtn.style.color = '#ff8800'
      syncBtn.style.fontWeight = '700'
    } else if (state.cloudSync) {
      syncBtn.textContent = '☁️'
      syncBtn.style.color = '#07c160'
      syncBtn.style.fontWeight = '400'
    } else {
      syncBtn.textContent = '📱'
      syncBtn.style.color = '#888'
      syncBtn.style.fontWeight = '400'
    }
  } else {
    syncBtn.style.display = 'none'
  }
}

async function doManualSync() {
  // 如果没有Token，尝试用缓存的
  const cachedToken = localStorage.getItem('pm_token')
  if (!cachedToken) {
    showToast('请先连接 GitHub 才能同步', 2500)
    return
  }
  state.token = cachedToken

  showSyncStatus('正在同步…')
  try {
    // 先验证 Token
    await ghFetch('/user')
    state.cloudSync = true

    // 拉取远程最新数据，合并后推送
    let remoteData
    try {
      remoteData = await ghReadData()
    } catch(e) {
      remoteData = null
    }

    const localData = collectData()
    let finalData = localData

    if (remoteData) {
      // 简单合并：以本地产品数据为准（本地最新操作），但合并远程的用户/邀请码变更
      finalData.products = localData.products || []
      finalData.config = { ...(remoteData.config || {}), ...(localData.config || {}) }
      finalData.users = mergeUsers(remoteData.users || [], localData.users || [])
      finalData.invites = remoteData.invites || localData.invites || []
    }

    await ghWriteData(finalData)
    applyData(finalData)
    saveLocalCache(finalData)
    state.pendingCount = 0
    renderProducts()
    showSyncStatus('✅ 已同步到云端')
    showToast('✅ 数据已同步到云端')
  } catch (err) {
    showSyncStatus('❌ 同步失败')
    showToast('网络异常，请检查网络后重试')
  }
  updateSyncUI()
}

function mergeUsers(remote, local) {
  // 以 local 为准，补充 remote 中有但 local 没有的
  const map = {}
  ;(local || []).forEach(u => { map[u.id] = u })
  ;(remote || []).forEach(u => {
    if (!map[u.id]) map[u.id] = u
  })
  return Object.values(map)
}

// ==================== 本地模式 ====================
function useLocalMode() {
  state.pendingCount = 0
  const cached = getLocalData()
  applyData(cached)

  // 尝试用上次缓存的账号自动登录
  const lastUser = localStorage.getItem('pm_last_user')
  if (lastUser && cached.users && cached.users.length > 0) {
    const user = cached.users.find(u => u.username === lastUser && u.status !== 'disabled')
    if (user) {
      state.currentUser = user
      state.cloudSync = false
      goPage('index', false)
      // 检查是否有缓存的Token可以尝试云端
      const token = localStorage.getItem('pm_token')
      if (token) {
        showSyncStatus(`📱 ${user.name || user.username}（可点🔄同步）`)
        showToast(`欢迎回来，${user.name || user.username}`)
      } else {
        showSyncStatus(`📱 ${user.name || user.username}（离线）`)
        showToast(`欢迎回来，${user.name || user.username}`)
      }
      updateSyncUI()
      return
    }
  }

  // 兜底：有用户数据就用第一个可用用户
  if (cached.users && cached.users.length > 0) {
    const avail = cached.users.find(u => u.status !== 'disabled') || cached.users[0]
    state.currentUser = avail
    state.cloudSync = false
    goPage('index', false)
    showSyncStatus(`📱 ${avail.name || avail.username}`)
    showToast(`✅ 本地模式 - ${avail.name || avail.username}`)
    updateSyncUI()
    return
  }

  // 完全新用户
  showToast('📱 首次使用 - 请先注册或用管理员Token登录')
}

// ==================== 注册 ====================
async function doRegister() {
  const code = document.getElementById('regInviteCode').value.trim().toUpperCase()
  const username = document.getElementById('regUsername').value.trim().toLowerCase()
  const password = document.getElementById('regPassword').value.trim()
  const name = document.getElementById('regName').value.trim()

  if (!code || code.length !== 6) { showToast('请输入6位邀请码'); return }
  if (!username || username.length < 2) { showToast('用户名至少2个字符'); return }
  if (!password || password.length < 3) { showToast('密码至少3个字符'); return }
  if (!name) { showToast('请输入你的名字'); return }

  const btn = document.getElementById('regBtn')
  const errEl = document.getElementById('regErr')
  btn.disabled = true
  btn.textContent = '注册中…'
  errEl.style.display = 'none'

  // 验证邀请码
  showLoading('验证邀请码…')
  let data
  try {
    data = state.cloudSync ? await ghReadData() : getLocalData()
  } catch(e) {
    data = getLocalData()
  }
  hideLoading()

  const invite = (data.invites || []).find(i =>
    i.code === code && i.status === 'active' && (i.usedBy === null || i.usedBy === undefined)
  )

  if (!invite) {
    errEl.textContent = '邀请码无效或已过期'
    errEl.style.display = 'block'
    btn.disabled = false
    btn.textContent = '注 册'
    return
  }

  // 检查用户名是否重复
  if ((data.users || []).some(u => u.username === username)) {
    errEl.textContent = '该用户名已被占用'
    errEl.style.display = 'block'
    btn.disabled = false
    btn.textContent = '注 册'
    return
  }

  // 创建用户
  const defaultPerms = {
    brands: [],
    hidePrice: !!data.config.hidePriceDefault,
    canEdit: false,
    canAdd: false,
    canDelete: false,
  }

  const newUser = {
    id: generateId(),
    username: username,
    password: simpleHash(password),
    name: name,
    role: 'member',
    invitedBy: invite.createdBy,
    inviteCode: code,
    permissions: defaultPerms,
    createdAt: new Date().toISOString(),
    status: 'active',
  }

  data.users.push(newUser)

  // 标记邀请码为已使用
  const inviteIdx = data.invites.findIndex(i => i.code === code)
  if (inviteIdx >= 0) {
    data.invites[inviteIdx].usedBy = newUser.id
    data.invites[inviteIdx].usedAt = new Date().toISOString()
    data.invites[inviteIdx].status = 'used'
  }

  // 保存
  applyData(data)
  saveLocalCache(data)
  if (state.cloudSync) {
    try { await ghWriteData(data) } catch(e) { /* 继续本地 */ }
  }

  showToast('✅ 注册成功！正在登录…')

  setTimeout(() => {
    state.currentUser = newUser
    goPage('index', false)
    showSyncStatus(state.cloudSync ? `☁️ ${name}` : `📱 ${name}`)
  }, 800)
}

// ==================== 自动登录 ====================
async function autoLogin() {
  // 1. 检查上次登录的用户名（账号登录优先）
  const lastUser = localStorage.getItem('pm_last_user')
  if (lastUser) {
    const lastPwd = localStorage.getItem('pm_last_pwd')  // 不存密码，只存用户名用于提示
    // 尝试用缓存的Token做云端账号登录
    const cachedToken = localStorage.getItem('pm_token')
    if (cachedToken) {
      state.token = cachedToken
      try {
        const ghUser = await ghFetch('/user')
        if (ghUser && ghUser.login) {
          state.cloudSync = true
          const data = await ghReadData()
          // 查找上次登录的用户
          const user = data.users.find(u => u.username === lastUser)
          if (user) {
            applyData(data)
            saveLocalCache(data)
            state.currentUser = user
            document.getElementById('acctLoginBtn').textContent = '✅ 自动登录中'
            setTimeout(() => {
              goPage('index', false)
              showSyncStatus(`☁️ ${user.name || user.username}`)
            }, 300)
            return
          }
        }
      } catch(e) {
        // Token失效
        localStorage.removeItem('pm_token')
      }
    }
  }

  // 2. 检查纯本地模式的用户
  const localData = getLocalData()
  if (localData.users && localData.users.length > 0) {
    const admin = localData.users.find(u => u.role === 'admin')
    if (admin) {
      state.currentUser = admin
      applyData(localData)
      // 不自动进入，让用户手动点登录
    }
  }
}

// ==================== 退出登录 ====================
function doLogout() {
  if (!confirm('确定要退出登录吗？')) return
  localStorage.removeItem('pm_token')
  localStorage.removeItem('pm_last_user')
  localStorage.removeItem('pm_cache')
  state.token = ''
  state.currentUser = null
  state.products = []
  state.config = {}
  state.users = []
  state.invites = []
  state.pageStack = []
  state.dataSha = ''
  state.cloudSync = false
  localCache = null
  document.getElementById('loginUsername').value = ''
  document.getElementById('loginPassword').value = ''
  document.getElementById('tokenInput').value = ''
  document.getElementById('loginErr').style.display = 'none'
  document.getElementById('tokenLoginErr').style.display = 'none'
  goPage('login', false)
}

// ==================== 产品列表 ====================
function getBrands() {
  const set = new Set()
  state.products.forEach(p => { if (p.brand) set.add(p.brand) })
  return Array.from(set).sort()
}

function renderBrandTabs() {
  const tabs = ['全部', ...getBrands()]
  const container = document.getElementById('brandTabs')
  container.innerHTML = tabs.map(b =>
    `<div class="brand-tab ${b === state.currentFilter ? 'active' : ''}" onclick="filterBrand('${b}')">${escHtml(b)}</div>`
  ).join('')
}

function filterBrand(brand) {
  state.currentFilter = brand
  renderBrandTabs()
  renderProductList()
}

function onSearch(val) {
  state.searchKeyword = val
  document.getElementById('searchClear').style.display = val ? '' : 'none'
  clearTimeout(state._searchTimer)
  state._searchTimer = setTimeout(renderProductList, 200)
}

function clearSearch() {
  state.searchKeyword = ''
  document.getElementById('searchInput').value = ''
  document.getElementById('searchClear').style.display = 'none'
  renderProductList()
}

function getFilteredProducts() {
  let list = [...state.products]

  // 权限过滤：品牌
  if (!hasPermission('canViewAll')) {
    const allowedBrands = (state.currentUser.permissions || {}).brands || []
    if (allowedBrands.length > 0) {
      list = list.filter(p => !p.brand || allowedBrands.includes(p.brand))
    }
  }

  if (state.currentFilter !== '全部') {
    list = list.filter(p => p.brand === state.currentFilter)
  }
  if (state.searchKeyword) {
    const kw = state.searchKeyword.toLowerCase()
    list = list.filter(p =>
      (p.model && p.model.toLowerCase().includes(kw)) ||
      (p.brand && p.brand.toLowerCase().includes(kw))
    )
  }
  list.sort((a, b) => (b.create_time || '').localeCompare(a.create_time || ''))
  return list
}

function renderProductList() {
  const list = document.getElementById('productList')
  const filtered = getFilteredProducts()
  const hidePrice = !hasPermission('canViewPrice') || state.config.hidePrice || (state.currentUser && state.currentUser.permissions && state.currentUser.permissions.hidePrice)

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-tip"><div class="empty-icon">📦</div><div class="empty-text">暂无产品</div></div>`
    document.getElementById('brandTabs').innerHTML = ''
    return
  }

  renderBrandTabs()

  list.innerHTML = filtered.map(p => `
    <div class="product-card" onclick="goDetail('${p.id}')">
      <div class="product-card-header">
        <span class="product-model">${escHtml(p.model)}</span>
        ${p.brand ? `<span class="product-brand">${escHtml(p.brand)}</span>` : ''}
        ${(p.quantity||0) <= 0 ? '<span class="sold-badge">已售罄</span>' : ''}
      </div>
      <div class="product-qty">库存：<span class="qty-num">${p.quantity || 0}</span> 件${p.sold_count ? `　已售 <span class="qty-num" style="color:var(--warning)">${p.sold_count}</span> 件` : ''}</div>
      ${!hidePrice ? `
      <div class="product-price-row">
        <div class="price-item"><div class="price-label">进价</div><div class="price-value primary">${fmtMoney(p.price)}</div></div>
        ${p.sell > 0 ? `<div class="price-item"><div class="price-label">卖价</div><div class="price-value success">${fmtMoney(p.sell)}</div></div>` : ''}
        ${p.profit != null && p.profit !== 0 ? `<div class="price-item"><div class="price-label">利润</div><div class="price-value warning">${fmtMoney(p.profit)}</div></div>` : ''}
      </div>` : ''}
    </div>
  `).join('')
}

// ==================== 产品详情 ====================
function goDetail(id) {
  const product = state.products.find(p => p.id === id)
  if (!product) { showToast('产品不存在'); return }
  state.currentProduct = product
  renderDetailPage(product)
  goPage('detail')
}

function renderDetailPage(p) {
  const hidePrice = !hasPermission('canViewPrice') || state.config.hidePrice || (state.currentUser && state.currentUser.permissions && state.currentUser.permissions.hidePrice)

  const priceGrid = !hidePrice ? `
    <div class="detail-price-grid">
      <div class="price-cell"><div class="price-cell-label">进价</div><div class="price-cell-value blue">${fmtMoney(p.price)}</div></div>
      <div class="price-cell"><div class="price-cell-label">卖价</div>${p.sell > 0 ? `<div class="price-cell-value green">${fmtMoney(p.sell)}</div>` : `<div class="price-cell-value gray">待填写</div>`}</div>
      <div class="price-cell"><div class="price-cell-label">利润</div>${p.profit != null && p.profit !== 0 ? `<div class="price-cell-value orange">${fmtMoney(p.profit)}</div>` : `<div class="price-cell-value gray">—</div>`}</div>
    </div>` : ''

  const featureTags = (p.features || []).length ? `
    <div class="section">
      <div class="section-title">特性标签</div>
      <div class="feature-tags">${p.features.map(f => `<span class="feature-tag">${escHtml(f)}</span>`).join('')}</div>
    </div>` : ''

  const imgSection = (p.images || []).length ? `
    <div class="section">
      <div class="section-title">产品图片</div>
      <div class="img-scroll">${p.images.map((img, i) => `<img class="img-thumb" src="${img.startsWith('data:')?img:img}" onclick="openImgViewer('_base64_${i}')" data-idx="${i}">`).join('')}</div>
    </div>` : ''

  const infoSection = `
    <div class="section">
      <div class="section-title">库存信息</div>
      <div class="info-row"><span class="info-key">当前库存</span><span class="info-val">${p.quantity || 0} 件</span></div>
      <div class="info-row"><span class="info-key">累计已售</span><span class="info-val">${p.sold_count || 0} 件</span></div>
      <div class="info-row"><span class="info-key">录入时间</span><span class="info-val">${p.create_time ? p.create_time.slice(0, 19) : '—'}</span></div>
      <div class="info-row"><span class="info-key">最后更新</span><span class="info-val">${p.update_time ? p.update_time.slice(0, 19) : '—'}</span></div>
    </div>`

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-header" style="padding-bottom:16px">
      <div class="detail-model">${escHtml(p.model)}</div>
      ${p.brand ? `<span class="detail-brand-tag">${escHtml(p.brand)}</span>` : ''}
    </div>
    ${priceGrid}
    ${featureTags}
    ${imgSection}
    ${infoSection}
  `

  const btns = []
  if (hasPermission('canEdit') || isCurrentUserAdmin()) {
    btns.push(`<button class="btn btn-success" onclick="openSoldModal('${p.id}',${p.quantity||0})">标记卖出</button>`)
  }
  if (hasPermission('canDelete') || isCurrentUserAdmin()) {
    btns.push(`<button class="btn btn-danger" onclick="deleteProduct('${p.id}')">删除</button>`)
  }
  // 至少给一个返回按钮
  if (btns.length === 0) {
    btns.push(`<button class="btn btn-ghost" onclick="goBack()">返回</button>`)
  }
  document.getElementById('detailActions').innerHTML = btns.join('')
}

function goEditProduct() {
  if (!state.currentProduct) return
  state.editProductId = state.currentProduct.id
  initAddPage(state.currentProduct)
  goPage('add')
}

async function deleteProduct(id) {
  if (!confirm('确定删除这个产品吗？')) return
  state.products = state.products.filter(p => p.id !== id)
  await pushData()
  showToast('已删除')
  goBack()
  renderProductList()
}

// ==================== 标记卖出 ====================
function openSoldModal(id, stock) {
  state.soldProductId = id
  document.getElementById('soldModalStock').textContent = stock
  document.getElementById('soldQtyInput').value = ''
  document.getElementById('soldPriceInput').value = ''
  document.getElementById('soldModal').classList.add('show')
  setTimeout(() => document.getElementById('soldQtyInput').focus(), 300)
}

function closeSoldModal() {
  document.getElementById('soldModal').classList.remove('show')
}

async function confirmSold() {
  const soldQty = parseInt(document.getElementById('soldQtyInput').value)
  const soldPrice = parseFloat(document.getElementById('soldPriceInput').value) || 0
  if (!soldQty || soldQty < 1) { showToast('请输入卖出数量'); return }

  const idx = state.products.findIndex(p => p.id === state.soldProductId)
  if (idx < 0) { showToast('产品不存在'); return }

  const p = state.products[idx]
  const newQty = Math.max(0, (p.quantity || 0) - soldQty)
  const newSoldCount = (p.sold_count || 0) + soldQty

  state.products[idx] = {
    ...p,
    quantity: newQty,
    sold_count: newSoldCount,
    ...(soldPrice > 0 ? { sell: soldPrice, profit: soldPrice - (p.price || 0) } : {}),
    update_time: new Date().toISOString(),
  }

  await pushData()
  showToast('✅ 已标记卖出')
  closeSoldModal()
  if (state.currentPage === 'detail') {
    goDetail(state.soldProductId)
  }
  renderProductList()
}

document.getElementById('soldModal').addEventListener('click', function(e) {
  if (e.target === this) closeSoldModal()
})

// ==================== 图片查看器 ====================
function openImgViewer(srcOrIdx) {
  const imgs = document.querySelectorAll('.img-thumb')
  if (srcOrIdx.startsWith('_base64_')) {
    const idx = parseInt(srcOrIdx.replace('_base64_', ''))
    if (state.currentProduct && state.currentProduct.images[idx]) {
      document.getElementById('imgViewerSrc').src = state.currentProduct.images[idx]
    }
  } else {
    document.getElementById('imgViewerSrc').src = srcOrIdx
  }
  document.getElementById('imgViewer').classList.remove('hidden')
}

function closeImgViewer() {
  document.getElementById('imgViewer').classList.add('hidden')
}

// ==================== 添加/编辑产品 ====================
function initAddPage(product) {
  state.editProductId = product ? product.id : null
  document.getElementById('addPageTitle').textContent = product ? '编辑产品' : '添加产品'
  document.getElementById('submitBtn').textContent = product ? '保存修改' : '保存产品'
  document.getElementById('fieldBrand').value = product ? (product.brand || '') : ''
  document.getElementById('fieldModel').value = product ? product.model : ''
  document.getElementById('fieldFeatures').value = product ? (product.features || []).join(',') : ''
  document.getElementById('fieldPrice').value = product ? (product.price || '') : ''
  document.getElementById('fieldSell').value = product ? (product.sell || '') : ''
  document.getElementById('fieldQty').value = product ? (product.quantity || 1) : 1
  state.uploadImages = product ? [...(product.images || [])] : []
  calcProfit()
  renderUploadArea()
  renderHistoryBrands()
}

function renderHistoryBrands() {
  const brands = getBrands()
  const wrap = document.getElementById('historyBrandsWrap')
  const tags = document.getElementById('historyBrandTags')
  if (!brands.length) { wrap.style.display = 'none'; return }
  wrap.style.display = ''
  tags.innerHTML = brands.map(b => `<span class="history-tag" onclick="selectBrand(this)">${escHtml(b)}</span>`).join('')
}

function selectBrand(el) {
  document.getElementById('fieldBrand').value = el.textContent
}

function changeQty(delta) {
  const input = document.getElementById('fieldQty')
  input.value = Math.max(0, (parseInt(input.value) || 0) + delta)
}

function calcProfit() {
  const price = parseFloat(document.getElementById('fieldPrice').value) || 0
  const sell = parseFloat(document.getElementById('fieldSell').value) || 0
  const preview = document.getElementById('profitPreview')
  const val = document.getElementById('profitPreviewVal')
  if (price > 0 && sell > 0) {
    const profit = sell - price
    preview.style.display = 'flex'
    val.textContent = (profit >= 0 ? '+' : '') + '¥' + profit.toFixed(2)
    val.style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)'
  } else {
    preview.style.display = 'none'
  }
}

function renderUploadArea() {
  const area = document.getElementById('uploadArea')
  const items = state.uploadImages.map((url, i) => `
    <div class="img-upload-item">
      <img src="${url}" onclick="openImgViewer('_base64_${i}')">
      <div class="img-delete" onclick="removeUploadImg(${i})">×</div>
    </div>
  `).join('')
  const addBtn = state.uploadImages.length < 5 ? `
    <div class="img-add-btn" onclick="pickImage()">
      <span class="icon">📷</span>
      <span>添加图片</span>
    </div>` : ''
  area.innerHTML = items + addBtn
}

function removeUploadImg(i) {
  state.uploadImages.splice(i, 1)
  renderUploadArea()
}

function pickImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = async (e) => {
    const files = Array.from(e.target.files).slice(0, 5 - state.uploadImages.length)
    for (const file of files) {
      if (file.size > 1024 * 512) { showToast('单张图片不能超过512KB'); continue }
      const reader = new FileReader()
      await new Promise(resolve => { reader.onload = resolve; reader.readAsDataURL(file) })
      if (reader.result) state.uploadImages.push(reader.result)
    }
    renderUploadArea()
  }
  input.click()
}

async function submitForm() {
  const model = document.getElementById('fieldModel').value.trim()
  const price = document.getElementById('fieldPrice').value.trim()
  if (!model) { showToast('请填写型号/名称'); return }
  if (!price) { showToast('请填写进价'); return }

  const submitBtn = document.getElementById('submitBtn')
  submitBtn.disabled = true
  submitBtn.textContent = '保存中…'

  const featuresRaw = document.getElementById('fieldFeatures').value.trim()
  const features = featuresRaw ? featuresRaw.split(/[，,]/).map(f => f.trim()).filter(Boolean) : []

  const productData = {
    brand: document.getElementById('fieldBrand').value.trim(),
    model,
    price: parseFloat(price),
    sell: parseFloat(document.getElementById('fieldSell').value) || 0,
    quantity: parseInt(document.getElementById('fieldQty').value) || 0,
    features,
    images: state.uploadImages,
    update_time: new Date().toISOString(),
  }

  const now = new Date().toISOString()
  if (state.editProductId) {
    const idx = state.products.findIndex(p => p.id === state.editProductId)
    if (idx >= 0) state.products[idx] = { ...state.products[idx], ...productData }
  } else {
    const newProduct = { id: generateId(), ...productData, create_time: now, sold_count: 0 }
    state.products.unshift(newProduct)
  }

  await pushData()

  submitBtn.disabled = false
  submitBtn.textContent = state.editProductId ? '保存修改' : '保存产品'
  showToast(state.editProductId ? '✅ 修改成功' : '✅ 添加成功')

  if (state.editProductId) { goDetail(state.editProductId) }
  else { state.editProductId = null; initAddPage(); goPage('index') }
}

// ==================== 管理页 ====================
function loadManageConfig() {
  document.getElementById('mgAccessPwd').value = (state.config.password || '')
  document.getElementById('mgAccessPwdToggle').checked = !!(state.config.password)
  document.getElementById('mgAccessPwdWrap').style.display = state.config.password ? '' : 'none'
  document.getElementById('mgHidePriceDefault').checked = !!state.config.hidePriceDefault
  // 邀请区：只有管理员可见
  document.getElementById('inviteSection').style.display = isCurrentUserAdmin() ? '' : 'none'
  renderActiveInvite()
}

function toggleMgField(fieldId) {
  const wrap = document.getElementById(fieldId + 'Wrap')
  wrap.style.display = wrap.style.display === 'none' ? '' : 'none'
}

function renderActiveInvite() {
  const activeInvites = (state.invites || []).filter(i => i.status === 'active')
  const box = document.getElementById('activeInviteBox')
  if (activeInvites.length > 0) {
    const inv = activeInvites[activeInvites.length - 1]  // 显示最新的
    box.style.display = ''
    document.getElementById('activeInviteCode').textContent = inv.code
    const baseUrl = window.location.origin + window.location.pathname
    document.getElementById('inviteLinkDisplay').textContent = baseUrl + '?invite=' + inv.code
  } else {
    box.style.display = 'none'
  }
}

function generateInviteCode() {
  const code = generateInviteCodeStr()
  const invite = {
    code: code,
    createdBy: state.currentUser.id,
    createdByName: state.currentUser.name || state.currentUser.username,
    createdAt: new Date().toISOString(),
    status: 'active',
    usedBy: null,
    maxUses: 1,
  }
  state.invites.push(invite)
  renderActiveInvite()
  showToast('🎫 邀请码：' + code)
  // 自动保存
  pushData()
}

async function saveManageConfig() {
  state.config.password = document.getElementById('mgAccessPwd').value.trim()
  state.config.hidePriceDefault = document.getElementById('mgHidePriceDefault').checked
  await pushData()
  showToast('✅ 设置已保存')
}

function showChangePwdUI() {
  const area = document.getElementById('changePwdArea')
  area.style.display = area.style.display === 'none' ? '' : 'none'
}

async function changeMyPassword() {
  const newPwd = document.getElementById('newPwdInput').value.trim()
  if (!newPwd || newPwd.length < 3) { showToast('密码至少3个字符'); return }
  if (!state.currentUser) return
  const idx = state.users.findIndex(u => u.id === state.currentUser.id)
  if (idx >= 0) {
    state.users[idx].password = simpleHash(newPwd)
    await pushData()
    showToast('✅ 密码修改成功')
    document.getElementById('changePwdArea').style.display = 'none'
    document.getElementById('newPwdInput').value = ''
  }
}

function exportData() {
  const data = collectData()
  data.exportTime = new Date().toISOString()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `产品明细备份_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('✅ 导出成功')
}

function importData(event) {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result)
      if (!confirm(`即将导入 ${(imported.products||[]).length} 条产品、${(imported.users||[]).length} 个用户的数据，是否继续？\n（现有数据将被覆盖）`)) return
      applyData(imported)
      await pushData()
      showToast('✅ 导入成功')
      loadManageConfig()
      if (imported.users && imported.users.length) renderUserList()
    } catch(err) {
      showToast('文件格式错误')
    }
  }
  reader.readAsText(event.target.value = '')
}

// ==================== 用户管理 ====================
function renderUserList() {
  const area = document.getElementById('userListArea')
  const users = state.users || []
  if (!users.length) {
    area.innerHTML = '<div class="empty-tip" style="padding:40px 0"><div class="empty-icon">👥</div><div class="empty-text">暂无其他用户</div></div>'
    return
  }

  area.innerHTML = users.map(u => {
    const perm = u.permissions || {}
    const brandInfo = perm.brands && perm.brands.length > 0 ? perm.brands.join('、') : '全部品牌'
    return `
    <div class="user-card">
      <div class="user-card-header">
        <span class="user-name">${escHtml(u.name || u.username)}</span>
        <span class="user-role-badge ${u.role === 'admin' ? 'role-admin' : 'role-member'}">${u.role === 'admin' ? '管理员' : '成员'}</span>
      </div>
      <div class="user-info">
        👤 @${escHtml(u.username)}<br>
        🏷️ 可见：${escHtml(brandInfo)}<br>
        💰 价格：${perm.hidePrice ? '隐藏' : '可见'} | ✏️ 编辑：${perm.canEdit ? '允许' : '禁止'} | ➕ 添加：${perm.canAdd ? '允许' : '禁止'}
      </div>
      <div class="user-actions">
        ${u.id !== (state.currentUser || {}).id ? `
          <button class="btn btn-primary" onclick="editUserPerm('${u.id}')">编辑权限</button>
          ${u.status !== 'disabled' ? '<button class="btn btn-danger" style="padding:7px 14px;font-size:12px" onclick="disableUser(\'' + u.id + '\')">禁用</button>' : '<button class="btn btn-success" style="padding:7px 14px;font-size:12px" onclick="enableUser(\'' + u.id + '\')">启用</button>'}
          ${u.role !== 'admin' ? '<button class="btn btn-ghost" style="padding:7px 14px;font-size:12px" onclick="setUserAdmin(\'' + u.id + '\')">设为管理员</button>' : ''}
        ` : '<span style="font-size:12px;color:var(--text-sub)">← 这是你自己</span>'}
      </div>
    </div>
    `}).join('')
}

function editUserPerm(userId) {
  const user = state.users.find(u => u.id === userId)
  if (!user) return
  state.editingUserId = userId
  const perm = user.permissions || {}

  const allBrands = getBrands()
  const selectedBrands = perm.brands || []

  document.getElementById('permModalTitle').textContent = `编辑权限 - ${user.name || user.username}`
  document.getElementById('permModalBody').innerHTML = `
    <div class="perm-group">
      <div class="perm-group-label">可见品牌（不选则可看全部）</div>
      <div class="perm-brand-chips">
        ${allBrands.length > 0 ? allBrands.map(b =>
          `<span class="perm-brand-chip ${selectedBrands.includes(b) ? 'selected' : ''}" onclick="togglePermBrand(this,'${b}')">${escHtml(b)}</span>`
        ).join('') : '<span style="font-size:12px;color:#bbb">暂无品牌数据</span>'}
      </div>
    </div>
    <div class="perm-group">
      <div class="perm-group-label">价格权限</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
        <input type="checkbox" id="permHidePrice" ${perm.hidePrice ? 'checked' : ''}> 隐藏进价/利润信息
      </label>
    </div>
    <div class="perm-group">
      <div class="perm-group-label">操作权限</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="permCanEdit" ${perm.canEdit ? 'checked' : ''}> 允许编辑产品
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="permCanAdd" ${perm.canAdd ? 'checked' : ''}> 允许添加产品
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
        <input type="checkbox" id="permCanDelete" ${perm.canDelete ? 'checked' : ''}> 允许删除产品
      </label>
    </div>
  `
  document.getElementById('permModal').classList.add('show')
}

// 临时存储选中品牌
window._selectedPermBrands = []
function togglePermBrand(el, brand) {
  el.classList.toggle('selected')
  const chips = document.querySelectorAll('.perm-brand-chip.selected')
  window._selectedPermBrands = Array.from(chips).map(c => c.textContent)
}

function closePermModal() {
  document.getElementById('permModal').classList.remove('show')
  state.editingUserId = null
}

async function saveUserPerm() {
  if (!state.editingUserId) return
  const idx = state.users.findIndex(u => u.id === state.editingUserId)
  if (idx < 0) return

  state.users[idx].permissions = {
    brands: window._selectedPermBrands || [],
    hidePrice: !!document.getElementById('permHidePrice').checked,
    canEdit: !!document.getElementById('permCanEdit').checked,
    canAdd: !!document.getElementById('permCanAdd').checked,
    canDelete: !!document.getElementById('permCanDelete').checked,
  }

  await pushData()
  closePermModal()
  renderUserList()
  showToast('✅ 权限已更新')
}

async function disableUser(userId) {
  if (!confirm('确定禁用该用户？禁用后将无法登录')) return
  const idx = state.users.findIndex(u => u.id === userId)
  if (idx >= 0) {
    state.users[idx].status = 'disabled'
    await pushData()
    renderUserList()
    showToast('已禁用')
  }
}

async function enableUser(userId) {
  const idx = state.users.findIndex(u => u.id === userId)
  if (idx >= 0) {
    state.users[idx].status = 'active'
    await pushData()
    renderUserList()
    showToast('已启用')
  }
}

async function setUserAdmin(userId) {
  if (!confirm('确定将该用户提升为管理员？\n管理员拥有所有权限')) return
  const idx = state.users.findIndex(u => u.id === userId)
  if (idx >= 0) {
    state.users[idx].role = 'admin'
    state.users[idx].permissions = { brands: [], hidePrice: false, canEdit: true, canAdd: true, canDelete: true }
    await pushData()
    renderUserList()
    showToast('✅ 已设为管理员')
  }
}

// ==================== 初始化 ====================
autoLogin()
