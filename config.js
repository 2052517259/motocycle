/* MOTO // GARAGE — global namespace & public configuration */
window.MOTO = window.MOTO || {};

MOTO.CONFIG = {
  appName: 'MOTO // GARAGE',
  /* 云服务公开配置：由平台下发，仅含可公开字段，无任何密钥 */
  cloud: {
    endpoint: 'https://wbapp-4ahooqceit2m0ldsodoed0.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_4AHOoQCEIt2m0ldsodoed0_kqGWSouvSxxq5NPwRBLI3ulT23s9vy7o',
    sdk: 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js',
    /* 官方发布链接（云登录仅在此域名可用：接口与页面同源，不受跨域限制）。
       在 GitHub Pages 等第三方域名打开时，云同步面板会提示用户改用此链接登录。 */
    officialUrl: 'https://wbapp-4ahooqceit2m0ldsodoed0.app.workbuddy.host/?sharecode=UDV6QXBHZK',
    mediaUploadMs: 120000  // 云端媒体上传超时（超时即视为跳过，不阻塞本机保存）
  },

  /* 油价接口：免费公开接口，支持跨域；带缓存与降级策略 */
  oilApi: 'https://cn.apihz.cn/api/jinrong/youjia.php',
  oilRefreshMs: 5 * 60 * 1000,     // 自动轮询间隔
  oilCacheTtlMs: 30 * 60 * 1000,   // 缓存有效时长
  wallpaperIntervalMs: 30 * 1000,  // 首页壁纸自动切换间隔
  maxFileSize: 200 * 1024 * 1024,  // （已不再作为硬性限制，上传不对文件类型与大小做限制；仅作内部参考）

  /* 壁纸：移除本地固定图，改为从外部图床（Unsplash / Pexels CDN）按批次动态获取 */
  photoPool: [
    { t:'us', id:'1558981806-ec527fa84c39' },
    { t:'us', id:'1568772585407-9361f9bf3a87' },
    { t:'us', id:'1449426468159-d96dbf08f19f' },
    { t:'us', id:'1591637333184-19aa84b3e01f' },
    { t:'us', id:'1547549082-6bc09f2049ae' },
    { t:'us', id:'1511994298241-608e28f14fde' },
    { t:'us', id:'1571068316344-75bc76f77890' },
    { t:'us', id:'1558618666-fcd25c85cd64' },
    { t:'us', id:'1502744688674-c619d1586c9e' },
    { t:'us', id:'1502920917128-1aa500764cbd' },
    { t:'us', id:'1560472354-b33ff0c44a43' },
    { t:'us', id:'1503387762-592deb58ef4e' },
    { t:'us', id:'1571607388263-1044f9ea01dd' },
    { t:'us', id:'1519641471654-76ce0107ad1b' },
    { t:'px', id:'2393821' },
    { t:'px', id:'1413412' },
    { t:'px', id:'6044224' },
    { t:'px', id:'3807305' },
    { t:'px', id:'2116475' },
    { t:'px', id:'112460' },
    { t:'px', id:'1191109' },
    { t:'px', id:'2768550' },
    { t:'px', id:'209263' },
    { t:'px', id:'259672' },
    { t:'px', id:'3577488' },
    { t:'px', id:'2036647' },
    { t:'px', id:'1631259' }
  ],
  photoBatchSize: 8,            // 每一批（一轮）的照片数量
  photoCrops: ['entropy','top','bottom','left','right','center'],
  photoLoadMs: 12000,           // 单张照片加载超时
  photoPrefetchAt: 3,           // 牌堆剩余 <= 此值时预热下一批

  /* 天气：多数据源 + 自动重试 + 缓存兜底
     默认使用 Open-Meteo（免 key、支持跨域）。若该源在您的网络下不稳定，
     可切换为和风天气（国内更稳，需免费 key）：
       weatherProvider: 'qweather', weatherKey: '你的和风key'
     其它源（wttr.in）会在主源彻底失败时自动作为备源尝试。 */
  weatherApi: 'https://api.open-meteo.com/v1/forecast',
  geocodeApi: 'https://geocoding-api.open-meteo.com/v1/search',
  weatherProvider: 'openmeteo', // 'openmeteo'（免 key） | 'qweather'（需 weatherKey）
  weatherKey: '',               // 和风天气 key（仅 weatherProvider='qweather' 需要）
  weatherApiHost: 'https://api.qweather.com',
  weatherRequestMs: 9000,       // 单次天气请求超时
  weatherRetries: 2,            // 单源失败自动重试次数
  weatherCacheTtlMs: 3 * 60 * 60 * 1000, // 天气缓存有效时长

  /* 高德地图：页内地图与路线跳转 */
  amapUri: 'https://uri.amap.com/navigation',   // 已知点位坐标时精确导航
  amapWeb: 'https://www.amap.com/dir',          // 文本地址检索路线（无需 key）
  amapSrc: 'moto-garage',
  /* 合规说明：请到高德开放平台（https://console.amap.com）申请「Web端(JS API)」Key，
     配置 Referer 域名白名单后，用真实 Key 替换下面的占位符。源码中不内置任何有效 Key。

     该 Key 的「域名白名单」需要加入以下 4 条（一行一条，不带协议、路径与端口）：
       localhost
       127.0.0.1
       2052517259.github.io                                  ← GitHub Pages
       wbapp-4ahooqceit2m0ldsodoed0.app.workbuddy.host         ← WorkBuddy 官方链接
     GitHub Pages 的 /motocycle/ 只是路径，不需要填进白名单。
     若控制台要求写成完整 URL，则改用：
       http://localhost:8000  /  http://127.0.0.1:8000
       https://2052517259.github.io
       https://wbapp-4ahooqceit2m0ldsodoed0.app.workbuddy.host */
  amapJsKey: 'f74b7fc0b1b7c7e931c4cacde1042206',
  /* 2021-12-02 之后申请的 Key 必须同时配置安全密钥（securityJsCode），
     否则白名单填对了也会报 INVALID_USER_SCODE。在控制台与 Key 一同获取后填入此处；
     旧 Key（无安全密钥）留空即可。 */
  amapJsSecurityCode: '2e09082502799b6788314ceec095db9f',
  amapJsVersion: '1.4.15',
  amapJsPlugins: ['AMap.Driving', 'AMap.Autocomplete', 'AMap.Geocoder', 'AMap.Geolocation']
};

MOTO.PROVINCES = ['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆'];

MOTO.OIL_LABELS = { '92':'92# 汽油', '95':'95# 汽油', '98':'98# 汽油', '0h':'0# 柴油', 'e92':'E92 乙醇汽油' };

MOTO.ROUTES = [
  { key:'home',  idx:'01', name:'首页 / HERO' },
  { key:'notes', idx:'02', name:'记事本 / NOTES' },
  { key:'fuel',  idx:'03', name:'油耗看板 / FUEL BOARD' },
  { key:'links', idx:'04', name:'网址收藏 / LINKS' },
  { key:'media', idx:'05', name:'媒体管理 / MEDIA' },
  { key:'ride',  idx:'06', name:'出行准备 / RIDE' }
];
