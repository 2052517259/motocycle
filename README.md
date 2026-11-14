# 我的个人网站

纯 HTML / CSS / JavaScript 构建的单页个人网站，零依赖、无构建工具，下载即用。

包含板块：**首页（Hero）· 关于我 · 项目展示 · 联系方式**，桌面与移动端自适应，自动跟随系统深浅色模式。

## 文件结构

```
personal-site/
├── index.html          # 页面骨架：四个板块的 HTML 结构（一般只需在换内容时才动它）
├── css/
│   └── style.css       # 全部样式：主题变量、导航、各板块、响应式断点（960px / 640px）
├── js/
│   ├── data.js         # ★ 内容配置：姓名、介绍、技能、联系方式、项目列表都在这里改
│   └── main.js         # 交互逻辑：渲染数据、汉堡菜单、滚动高亮、项目筛选、表单校验
├── assets/
│   └── avatar.svg      # 占位头像（放自己的照片进这个目录即可替换）
└── README.md           # 本说明文件
```

> **改内容只需要动 `js/data.js`**——所有文字、项目、联系方式都集中在这一个文件里，保存刷新即可生效。

## 本地运行

任选一种方式：

**方式一：VS Code Live Server（最简单）**
1. 用 VS Code 打开 `personal-site` 文件夹；
2. 安装 "Live Server" 扩展；
3. 右键 `index.html` → "Open with Live Server"。

**方式二：Python 自带服务器**
```bash
cd personal-site
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

**方式三：Node.js**
```bash
cd personal-site
npx serve .
```

> 直接双击 `index.html` 也能打开，功能完整；只是个别浏览器对本地文件的限制可能让图标字体等资源加载不一致，建议用上面的方式预览。

## 常见修改指南

| 想改什么 | 改哪里 |
|---|---|
| 姓名 / 职位 / 介绍 / 技能 / 联系方式 | `js/data.js` 的 `PROFILE` 对象 |
| 增删项目 | `js/data.js` 的 `PROJECTS` 数组（加一个对象即可，分类筛选自动更新） |
| 头像 | 把照片放进 `assets/`，改 `PROFILE.avatar` |
| 主题色 | `css/style.css` 顶部的 `--primary` 等变量 |
| 深浅色 | 自动跟随系统，无需配置；想强制浅色可删除 `@media (prefers-color-scheme: dark)` 段 |
| 表单接真实后端 | `js/main.js` 中 `initForm()` 里的 mailto 逻辑，替换成 `fetch()` 调用（有注释标注位置） |
| 板块顺序 / 增删板块 | `index.html` 中对应的 `<section>`，同时在 `data.js`、`css/style.css` 中同步调整 |

## 部署上线

- **GitHub Pages**：把整个文件夹推到一个仓库，仓库 Settings → Pages → 选择 `main` 分支根目录即可，地址为 `https://用户名.github.io/仓库名/`。
- **Vercel / Netlify**：拖拽文件夹到控制台即可，零配置。
