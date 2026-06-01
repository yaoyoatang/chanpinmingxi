# 产品明细 - GitHub 版部署指南

## 架构说明

```
你的手机/电脑浏览器（纯前端）
    ↕（GitHub API 读写数据）
GitHub 私有仓库 huaerge68/product-data
    ↕（自动部署静态页面）
GitHub Pages（免费托管前端）
```

**零服务器、零费用、永久免费、多设备同步。**

---

## 第一步：创建 GitHub Token

1. 打开这个链接（已自动配置好权限）：
   https://github.com/settings/tokens/new?scopes=repo&description=产品明细

2. 填写信息：
   - **Note（描述）**: `产品明细`
   - **Expiration（过期时间）**: 选 `No expiration`（永不过期）或 `90 days`
   - **权限勾选**: 只需勾选 ✅ **repo**（第一个，整个大项）

3. 滚动到底部，点绿色按钮 **「Generate token」**

4. ⚠️ **立即复制生成的 Token！**（`ghp_` 开头的长字符串，只显示一次）

---

## 第二步：本地测试

1. 双击 `index.html` 文件，在浏览器中打开
2. 粘贴 Token → 点「连接 GitHub」
3. 首次使用会提示创建仓库，点确定即可

---

## 第三步：部署到 GitHub Pages（让手机也能访问）

### 方法A：通过 GitHub 网页操作（推荐，最简单）

1. 在 GitHub 上新建一个公开仓库，名字叫 `product-manager-app`（或任意名字）
2. 进入仓库 → Settings → Pages → Source 选择 `Deploy from a branch`
3. Branch 选 `main`，目录选 `/ (root)`，点 Save
4. 上传 `index.html` 到仓库根目录
5. 几分钟后访问 `https://huaerge68.github.io/product-manager-app/`

### 方法B：用 GitHub CLI 一键部署（需要安装 gh 命令行）

```bash
# 1. 创建 GitHub Pages 仓库
gh repo create product-manager-app --public --description "产品明细应用"

# 2. 复制文件进去并推送
cp index.html /tmp/
cd /tmp && git init && git checkout -b main
git add index.html
git commit -m "init"
git remote add origin git@github.com:huaerge68/product-manager-app.git
git push -u origin main

# 3. 开启 Pages
gh api repos/huaerge68/product-manager-app/pages -X POST \
  -f build_type="branch" -f branch="main" -f path="/"
```

---

## 第四步：使用

### 打开方式
- **电脑**: 直接访问 GitHub Pages 链接
- **手机**: 微信/QQ内发送链接打开，或添加到主屏幕当App用

### 首次使用流程
1. 输入 GitHub Token → 连接
2. （首次）自动创建私有数据仓库 → 点确定
3. 可选设置访问密码
4. 开始使用！

### 多设备同步
- 手机和电脑都打开同一个链接
- 用同一个Token登录
- 数据自动从GitHub同步

### 设置访问密码
- 管理中心 → 填写密码 → 保存
- 下次登录时需要输入密码才能进入

---

## 功能清单

| 功能 | 说明 |
|------|------|
| ✅ 产品增删改查 | 完整的CRUD操作 |
| ✅ 标记卖出 | 弹窗输入数量+卖价 |
| ✅ 图片上传 | 最多5张，base64存JSON |
| ✅ 品牌筛选 | 自动提取历史品牌 |
| ✅ 搜索 | 型号/品牌模糊搜索 |
| ✅ 利润计算 | 实时显示预计利润 |
| ✅ 价格隐藏 | 管理中心可开启 |
| ✅ 数据导出 | JSON格式下载备份 |
| ✅ 数据导入 | 从备份文件恢复 |
| ✅ 访问密码 | 可选设置密码保护 |
| ✅ 离线缓存 | 断网时可用缓存数据 |
| ✅ 响应式布局 | 手机/平板/电脑自适应 |

---

## 注意事项

1. **图片大小限制**：单张不超过512KB（base64存JSON不能太大）
2. **数据量建议**：产品数在1000条以内体验最佳
3. **Token安全**：不要把Token分享给别人，相当于你的GitHub完全访问权限
4. **数据备份**：定期用「导出全部数据」功能备份JSON文件
5. **离线支持**：断网时会自动使用浏览器缓存的最近一次数据

## 文件结构

```
h5app-github/
└── index.html    ← 整个应用只有一个文件！
```

就这么简单。不需要服务器、不需要数据库、不需要域名。
