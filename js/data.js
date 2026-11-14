/* ============================================================
   data.js — 网站内容数据（唯一的"内容配置文件"）
   ------------------------------------------------------------
   想修改网站上的文字、增删项目、换联系方式，只需要改这个文件，
   不用动 HTML / CSS / main.js。
   修改后保存、刷新浏览器即可生效。
   ============================================================ */

/* ---------- 个人基本信息 ---------- */
const PROFILE = {
  // 姓名 / 站点名（显示在首页大标题、导航 Logo、页脚）
  name: "你的名字",

  // 职位或一句话身份（显示在姓名下方）
  role: "前端工程师 · 独立开发者",

  // 首页的一句话介绍
  intro: "热爱写代码也喜欢折腾新事物，这个网站用来展示我做过的一些项目和想法。",

  // 头像图片路径（把自己的照片放进 assets/ 后替换，如 "assets/avatar.jpg"）
  avatar: "assets/avatar.svg",

  // 页脚署名（一般与 name 相同）
  footerName: "你的名字",

  // 「关于我」的详细段落（每段一个字符串，想加几段加几段）
  about: [
    "在这里写第一段自我介绍：例如教育背景、目前的工作、正在关注的技术方向等。",
    "第二段可以聊聊工作之外的你：兴趣、爱好、坚持在做的事情，让页面更有个人温度。"
  ],

  // 数据统计条：数字 + 说明，按需增删
  stats: [
    { num: "3+", label: "年开发经验" },
    { num: "10+", label: "完成的项目" },
    { num: "5", label: "掌握的语言" }
  ],

  // 技能标签：数组里加字符串即可
  skills: ["HTML / CSS", "JavaScript", "Vue / React", "Node.js", "Python", "Git"],

  // 联系方式：icon 用 emoji，label 是说明，value 是显示文字，href 是链接
  // 不想要的方式直接删掉整行即可
  contact: [
    { icon: "📧", label: "邮箱", value: "you@example.com", href: "mailto:you@example.com" },
    { icon: "🏠", label: "GitHub", value: "github.com/yourname", href: "https://github.com/yourname" },
    { icon: "✍️", label: "博客", value: "your-blog.com", href: "https://your-blog.com" }
  ]
};

/* ---------- 项目列表 ----------
   每个项目的字段：
   title : 项目名称
   tag   : 分类（用于筛选按钮，相同 tag 会自动归为一类）
   desc  : 一句话描述
   links : 可选，{ text: "链接文字", url: "地址" } 数组；没有就写 []
*/
const PROJECTS = [
  {
    title: "示例项目一",
    tag: "Web",
    desc: "这是一个示例项目描述：说明它解决了什么问题、用了什么技术、你负责了哪部分。替换成你的真实项目即可。",
    links: [
      { text: "在线演示", url: "https://example.com/demo1" },
      { text: "源代码", url: "https://github.com/yourname/project1" }
    ]
  },
  {
    title: "示例项目二",
    tag: "Web",
    desc: "第二个示例：项目卡片封面默认用主题色渐变，也可以在 HTML 渲染处换成 <img> 真实截图。",
    links: [
      { text: "源代码", url: "https://github.com/yourname/project2" }
    ]
  },
  {
    title: "示例项目三",
    tag: "工具",
    desc: "工具类项目示例：比如一个提升效率的小工具、命令行程序或自动化脚本。",
    links: []
  },
  {
    title: "示例项目四",
    tag: "其他",
    desc: "其他类型示例：设计作品、摄影集、翻译整理的资料等都可以放在这里。",
    links: [
      { text: "查看详情", url: "https://example.com/project4" }
    ]
  }
];
