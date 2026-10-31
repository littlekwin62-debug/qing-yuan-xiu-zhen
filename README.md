# 《青元修真》网页部署包

这个文件夹就是可以直接上传到 GitHub Pages 的成品，四个文件缺一不可：

| 文件 | 作用 |
|---|---|
| `index.html` | 游戏本体（单文件，图片字体全内联，2.0 MB） |
| `manifest.webmanifest` | 让手机能「添加到主屏幕」当 App 用 |
| `icon-192.png` / `icon-512.png` | 主屏幕图标 |

## 一、第一次上线（网页点选，不用命令行）

1. 打开 github.com，登录或注册（免费账号即可）。
2. 右上角 `+` → **New repository**。
   - Repository name 填 `qingyuan`（随便起，这就是网址里的一段）。
   - 选 **Public**（私有仓库的 Pages 要付费）。
   - 不要勾 Add a README，直接 **Create repository**。
3. 进入仓库，点 **uploading an existing file**（或 Add file → Upload files），
   把本文件夹里的**四个文件全部选中**拖进去（注意是文件本身，不是 `发布` 这个文件夹）。
4. 下方 Commit changes 提交。
5. 仓库顶部 **Settings** → 左侧 **Pages** →
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，目录选 **/ (root)** → **Save**
6. 等 1~2 分钟，刷新这个 Pages 页面，顶部会出现
   `Your site is live at https://你的用户名.github.io/qingyuan/`
   这个网址就是发给朋友的链接。

> 手机上第一次访问会加载 2 MB，之后有缓存就快了。iOS 用 Safari 分享 → 添加到主屏幕；Android 用 Chrome 菜单 → 安装应用，图标和名字都来自 manifest。

## 二、以后更新（关键流程）

1. 我把新版传给你，你在本地仓库页面点 **Add file → Upload files**，
   把新的 `index.html` 拖上去覆盖同名文件（GitHub 会提示“同名文件将被替换”，确认即可）。
2. Commit。
3. 等 1~2 分钟（GitHub Pages 有约 10 分钟 CDN 缓存）。

**朋友那边怎么看到新版：**

- 页面自己会检测：打开后 1.5 秒去无缓存抓一次自己，发现线上 BUILD 号比当前大，顶部就会弹一条金色提示「有新版本 0.1.2 · 点此刷新」，点一下即可。
- 也可以手动：电脑 `Ctrl + F5`；手机 Chrome 三点菜单 → 刷新，Safari 下拉刷新。
- 实在不更新：在网址后面加个参数，如 `?v=2`，这是全新地址，一定拉新版。

## 三、发版要注意的三件事

1. **版本号**：`index.html` 里有一行 `const BUILD = '0.1.1';`（约在文件末尾的自动更新脚本里）。每次发版必须把这个数字往上涨，否则朋友那边不会收到更新提示。
2. **存档跟着域名走**：`localStorage` 绑定在 `你的用户名.github.io` 上。只要仓库名不变，换版本不影响存档；一旦换仓库名或换托管平台，旧档不在新网址里 —— 换之前先在游戏里点「导出存档」存一份 JSON，到新网址再「导入存档」。
3. **别改文件夹结构**：`index.html`、`manifest.webmanifest`、两个图标必须放在仓库根目录同一层，否则图标和 PWA 会失效（游戏本身仍能玩）。

## 四、常见问题

- **打开是 404**：Pages 分支目录选错了，重选 `main` + `/ (root)`；或者文件没传到根目录。
- **白屏**：多半是浏览器太老（需要支持 `backdrop-filter` 之外的现代 CSS，Chrome 90+ / Safari 15+ 都行）。
- **「添加到主屏幕」没有图标**：manifest 或 png 没传，或者浏览器缓存了旧 manifest，清一次站点数据再看。
- **朋友说还是旧版**：等 10 分钟，或让他用 `?v=2` 这种带参数的链接。
- **想加自己的域名**：Settings → Pages → Custom domain，并在域名商处按提示配 CNAME；国内访问 GitHub Pages 有时慢，介意的话可以换 Cloudflare Pages / 腾讯云 EdgeOne（流程类似，也是拖文件）。
