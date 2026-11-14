/* ============================================================
   main.js — 页面交互逻辑
   ------------------------------------------------------------
   一般不需要改这个文件；改内容请去 js/data.js。
   本文件负责：
   1. 把 data.js 的内容渲染到页面上
   2. 移动端汉堡菜单开关
   3. 滚动时高亮当前所在板块的导航项
   4. 项目分类筛选
   5. 留言表单校验（纯前端，用 mailto 调起邮件客户端）
   6. 滚动渐显动画 & 页脚年份自动更新
   ============================================================ */

/* ---------- 工具函数：安全地把文本写入 HTML（防止内容里的特殊字符破坏结构） ---------- */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- 1. 渲染 data.js 中的内容 ---------- */
function renderProfile() {
  // 首页 Hero
  setText("hero-name", PROFILE.name);
  setText("hero-role", PROFILE.role);
  setText("hero-intro", PROFILE.intro);
  setText("nav-logo", PROFILE.name);
  setText("footer-name", PROFILE.footerName || PROFILE.name);
  const avatar = document.getElementById("hero-avatar");
  if (avatar) avatar.src = PROFILE.avatar;

  // 「关于我」段落
  const aboutBox = document.querySelector(".about-text");
  if (aboutBox) {
    // 先移除占位的 <p>，再按 PROFILE.about 重新生成
    aboutBox.querySelectorAll("p").forEach(p => p.remove());
    PROFILE.about.forEach(txt => {
      const p = document.createElement("p");
      p.textContent = txt;
      aboutBox.insertBefore(p, document.getElementById("about-stats"));
    });
  }

  // 数据统计
  const statsBox = document.getElementById("about-stats");
  if (statsBox) {
    statsBox.innerHTML = PROFILE.stats.map(s =>
      `<div class="stat-item"><strong>${esc(s.num)}</strong><span>${esc(s.label)}</span></div>`
    ).join("");
  }

  // 技能标签
  const skillBox = document.getElementById("skill-list");
  if (skillBox) {
    skillBox.innerHTML = PROFILE.skills.map(s =>
      `<li class="skill-tag">${esc(s)}</li>`
    ).join("");
  }

  // 联系方式列表
  const contactBox = document.getElementById("contact-list");
  if (contactBox) {
    contactBox.innerHTML = PROFILE.contact.map(c =>
      `<li>
        <span class="contact-icon">${esc(c.icon)}</span>
        <span>
          <span class="contact-label">${esc(c.label)}</span>
          <a class="contact-value" href="${esc(c.href)}" target="_blank" rel="noopener">${esc(c.value)}</a>
        </span>
      </li>`
    ).join("");
  }
}

/* 小工具：按 id 设置文本（元素不存在时静默跳过，避免报错） */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ---------- 2. 渲染项目卡片与分类筛选 ---------- */
function renderProjects() {
  const grid = document.getElementById("project-grid");
  const filterBar = document.getElementById("filter-bar");
  if (!grid) return;

  /* 每个项目的封面用主题色 + 首字母，避免没有截图时卡片空白；
     以后想用真实截图，把 cover 的 innerHTML 换成
     `<img src="封面图地址" alt="">` 即可 */
  grid.innerHTML = PROJECTS.map((p, i) => `
    <article class="project-card reveal" data-tag="${esc(p.tag)}">
      <div class="project-cover" style="background:${coverColor(i)}">${esc(p.title.charAt(0))}</div>
      <div class="project-body">
        <p class="project-tag">${esc(p.tag)}</p>
        <h3 class="project-title">${esc(p.title)}</h3>
        <p class="project-desc">${esc(p.desc)}</p>
        <div class="project-links">
          ${(p.links || []).map(l =>
            `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)} →</a>`
          ).join("")}
        </div>
      </div>
    </article>
  `).join("");

  /* 根据 PROJECTS 中出现过的 tag 自动生成筛选按钮 */
  const tags = [...new Set(PROJECTS.map(p => p.tag))];   // 去重
  filterBar.innerHTML =
    `<button class="filter-btn active" data-filter="all">全部</button>` +
    tags.map(t => `<button class="filter-btn" data-filter="${esc(t)}">${esc(t)}</button>`).join("");

  /* 点击筛选按钮：匹配的卡片显示，其余隐藏 */
  filterBar.addEventListener("click", e => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    filterBar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tag = btn.dataset.filter;
    grid.querySelectorAll(".project-card").forEach(card => {
      card.classList.toggle("hidden", tag !== "all" && card.dataset.tag !== tag);
    });
  });
}

/* 封面配色：几个柔和的主题色轮换，让卡片不单调 */
function coverColor(i) {
  const colors = ["#4f6ef7", "#8a5cf6", "#00b8a9", "#f6a623"];
  return colors[i % colors.length];
}

/* ---------- 3. 移动端汉堡菜单 ---------- */
function initNav() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("nav-menu");

  toggle.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  /* 点击菜单里的链接后自动收起菜单（移动端体验） */
  menu.addEventListener("click", e => {
    if (e.target.closest(".nav-link")) {
      menu.classList.remove("open");
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* ---------- 4. 滚动时高亮当前板块对应的导航项 ---------- */
function initScrollSpy() {
  const sections = document.querySelectorAll("main section[id]");
  const links = document.querySelectorAll(".nav-link");

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      links.forEach(l => l.classList.toggle("active", l.hash === "#" + entry.target.id));
    });
  }, { rootMargin: "-40% 0px -55% 0px" });  // 板块进入屏幕中部才算"当前"

  sections.forEach(s => observer.observe(s));
}

/* ---------- 5. 留言表单：前端校验 + mailto 发送 ---------- */
function initForm() {
  const form = document.getElementById("contact-form");
  const error = document.getElementById("form-error");
  if (!form) return;

  form.addEventListener("submit", e => {
    e.preventDefault();  // 阻止默认提交，自己处理

    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const message = form.message.value.trim();

    /* 简单校验：不通过就显示错误提示 */
    let msg = "";
    if (!name) msg = "请填写你的称呼";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) msg = "请填写正确的邮箱地址";
    else if (message.length < 5) msg = "留言内容太短啦，多写几个字吧";
    if (msg) {
      error.textContent = msg;
      error.hidden = false;
      return;
    }
    error.hidden = true;

    /* 拼成邮件内容并调起本机邮件客户端。
       想接真实后端时，把下面两行换成：
       fetch("你的接口地址", { method: "POST", body: JSON.stringify({ name, email, message }) })
       然后按返回结果提示用户即可。 */
    const subject = encodeURIComponent(`来自个人网站的留言 - ${name}`);
    const body = encodeURIComponent(`${message}\n\n—— ${name}（${email}）`);
    window.location.href = `mailto:${PROFILE.contact[0].value}?subject=${subject}&body=${body}`;

    form.reset();
  });
}

/* ---------- 6. 滚动渐显动画 ---------- */
function initReveal() {
  const els = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);   // 只动画一次
      }
    });
  }, { threshold: 0.12 });
  els.forEach(el => observer.observe(el));
}

/* ---------- 入口：页面加载完成后统一初始化 ---------- */
document.addEventListener("DOMContentLoaded", () => {
  renderProfile();   // 先渲染内容
  renderProjects();
  initNav();
  initScrollSpy();
  initForm();
  initReveal();
  // 页脚年份自动更新，不用每年手动改
  const year = document.getElementById("footer-year");
  if (year) year.textContent = new Date().getFullYear();
});
