/* bridge.js — 智能选号器手机壳（iOS / Android）的 Web 侧粘合层
 *
 * 设计原则：页面本身（lottery-pro-v2.html）一行都不改。
 * 桌面版靠 pywebview 注入 window.pywebview.api；这里就用同样的名字，
 * 把四个接口重新实现一遍，页面察觉不到自己不在桌面上。
 *
 *   原生侧只提供三件最笨的能力：http / cache / copy（+ openReport）
 *   抓官方接口、解析、归一化，全都在这一个 JS 文件里做，
 *   保证 iOS 与 Android 用的是同一份解析逻辑，不会各写一遍各错一遍。
 */
(function () {
  'use strict';
  if (window.__MOBILE_BRIDGE__) return;
  window.__MOBILE_BRIDGE__ = 1;

  var HANDLER_IOS = 'native';

  function iosBridge() {
    return (window.webkit && window.webkit.messageHandlers
      && window.webkit.messageHandlers[HANDLER_IOS]) || null;
  }
  function andBridge() {
    return (window.NativeBridge && window.NativeBridge.postMessage) ? window.NativeBridge : null;
  }

  /* ================= 1. 传输层 ================= */
  var seq = 0, pend = {};

  window.__NATIVE_REPLY = function (p) {
    if (!p || !p.id) return;
    var it = pend[p.id];
    if (!it) return;
    delete pend[p.id];
    clearTimeout(it.timer);
    if (p.ok) it.res(p.data);
    else it.rej(new Error(p.error || '原生调用失败'));
  };

  function call(method, args, ms) {
    return new Promise(function (res, rej) {
      var id = 'r' + (++seq);
      var msg = { id: id, method: method, args: args || {} };
      var timer = setTimeout(function () {
        if (pend[id]) { delete pend[id]; rej(new Error('原生调用超时：' + method)); }
      }, ms || 25000);
      pend[id] = { res: res, rej: rej, timer: timer };
      try {
        var i = iosBridge();
        if (i) { i.postMessage(msg); return; }
        var a = andBridge();
        if (a) { a.postMessage(JSON.stringify(msg)); return; }
        throw new Error('没有原生桥');
      } catch (e) {
        delete pend[id]; clearTimeout(timer); rej(e);
      }
    });
  }

  function cacheGet(key) {
    return call('cacheGet', { key: key }, 6000).then(function (r) {
      return (r && typeof r.value === 'string') ? r.value : null;
    }, function () { return null; });
  }
  function cacheSet(key, value) {
    return call('cacheSet', { key: key, value: value }, 8000).catch(function () { return null; });
  }

  var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  function httpGetJson(url, referer, timeout) {
    var headers = {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Referer': referer
    };
    return call('http', { url: url, headers: headers, timeout: timeout || 15000 }, (timeout || 15000) + 9000)
      .then(function (r) {
        if (!r || typeof r.body !== 'string') throw new Error('无响应');
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
        return JSON.parse(r.body);
      });
  }

  /* ================= 2. 官方接口解析（与 fetch_recent.py 一一对应） ================= */
  var WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  var SOURCES = {
    ssq: { name: '双色球', org: '中国福利彩票发行管理中心', url: 'https://www.cwl.gov.cn/kjxx/ssq/kjgg/' },
    fc3d: { name: '福彩3D', org: '中国福利彩票发行管理中心', url: 'https://www.cwl.gov.cn/kjxx/3d/kjgg/' },
    dlt: { name: '大乐透', org: '国家体育总局体育彩票管理中心', url: 'https://www.lottery.gov.cn/kj/kjlb.html?dlt' },
    pl5: { name: '排列5', org: '国家体育总局体育彩票管理中心', url: 'https://www.lottery.gov.cn/kj/kjlb.html?pl5' }
  };

  function num(s) {
    s = (s === null || s === undefined) ? '' : String(s);
    s = s.replace(/,/g, '').replace(/元/g, '').trim();
    if (!s || s === '--' || s === '-' || s === 'null') return null;
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoOf(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function weekdayCn(iso) {
    var p = iso.split('-');
    if (p.length !== 3) return '';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return '';
    var w = d.getDay();               // 0=周日
    return WEEK[(w + 6) % 7];
  }

  function fetchCwl(name, referer, size, timeout) {
    var url = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice'
      + '?name=' + encodeURIComponent(name) + '&pageNo=1&pageSize=' + (size || 30) + '&systemType=PC';
    return httpGetJson(url, referer, timeout).then(function (j) {
      return (j && j.result) || [];
    });
  }

  function parseCwl(it, game) {
    var red = String(it.red || '').split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return /^\d+$/.test(x); })
      .map(function (x) { return parseInt(x, 10); });
    var blue = String(it.blue === null || it.blue === undefined ? '' : it.blue).trim();
    var t1 = {};
    (it.prizegrades || []).forEach(function (g) {
      if (String(g.type) === '1') {
        t1 = { count: num(g.typenum), money: num(g.typemoney) };
      }
    });
    return {
      game: game,
      issue: it.code,
      date: String(it.date || '').substring(0, 10),
      nums: red,
      extra: (/^\d+$/.test(blue) && blue !== '0') ? [parseInt(blue, 10)] : [],
      sales: num(it.sales),
      pool: num(it.poolmoney),
      first_count: t1.count === undefined ? null : t1.count,
      first_money: t1.money === undefined ? null : t1.money,
      detail_url: it.detailsLink || SOURCES[game].url
    };
  }

  function fetchSporttery(gameNo, size, timeout) {
    var url = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry'
      + '?gameNo=' + gameNo + '&provinceId=0&pageSize=' + (size || 30)
      + '&isVerify=1&pageNo=1';
    return httpGetJson(url, 'https://www.lottery.gov.cn/kj/kjlb.html', timeout).then(function (j) {
      return ((j && j.value) || {}).list || [];
    });
  }

  function parseSporttery(it, game) {
    var nums = String(it.lotteryDrawResult || '').split(/\s+/)
      .filter(function (x) { return /^\d+$/.test(x); })
      .map(function (x) { return parseInt(x, 10); });
    var t1 = {};
    (it.prizeLevelList || []).forEach(function (g) {
      if (String(g.prizeLevel || '').trim() === '一等奖') {
        t1 = { count: num(g.stakeCount), money: num(g.stakeAmountFormat || g.stakeAmount) };
      }
    });
    var main, extra;
    if (game === 'dlt') {
      main = nums.slice(0, 5).sort(function (a, b) { return a - b; });
      extra = nums.slice(5, 7).sort(function (a, b) { return a - b; });
    } else {
      // 排列5 的号码顺序就是票面（41572 与 25147 是两张不同的票），绝不能排序
      main = nums.slice(0, 5);
      extra = [];
    }
    return {
      game: game,
      issue: it.lotteryDrawNum,
      date: String(it.lotteryDrawTime || '').substring(0, 10),
      nums: main,
      extra: extra,
      sales: num(it.totalSaleAmount),
      pool: num(it.poolBalanceAfterdraw),
      first_count: t1.count === undefined ? null : t1.count,
      first_money: t1.money === undefined ? null : t1.money,
      detail_url: SOURCES[game].url
    };
  }

  function dateKey(r) {
    var p = String(r.date || '').split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    var iss = String(r.issue || '');
    return [y || 0, m || 0, d || 0, /^\d+$/.test(iss) ? parseInt(iss, 10) : 0];
  }

  function cmpKeyDesc(a, b) {          // 期号/日期倒序
    var ka = dateKey(a), kb = dateKey(b);
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    }
    return 0;
  }

  var ORDER = { ssq: 0, dlt: 1, fc3d: 2, pl5: 3 };

  function collect(days) {
    days = Math.max(1, Math.min(30, days || 5));
    var today = isoOf(new Date());
    var startD = new Date();
    startD.setDate(startD.getDate() - (days - 1));
    var start = isoOf(startD);

    var items = [], errors = [], rawCount = {};

    var plan = [
      ['ssq', function () {
        return fetchCwl('ssq', 'https://www.cwl.gov.cn/kjxx/ssq/kjgg/').then(function (arr) {
          return arr.map(function (x) { return parseCwl(x, 'ssq'); });
        });
      }],
      ['fc3d', function () {
        return fetchCwl('3d', 'https://www.cwl.gov.cn/kjxx/3d/kjgg/').then(function (arr) {
          return arr.map(function (x) { return parseCwl(x, 'fc3d'); });
        });
      }],
      ['dlt', function () {
        return fetchSporttery(85).then(function (arr) {
          return arr.map(function (x) { return parseSporttery(x, 'dlt'); });
        });
      }],
      ['pl5', function () {
        return fetchSporttery(350133).then(function (arr) {
          return arr.map(function (x) { return parseSporttery(x, 'pl5'); });
        });
      }]
    ];

    function wait(ms) {
      return new Promise(function (r) { setTimeout(r, ms); });
    }

    return plan.reduce(function (chain, step) {
      return chain.then(function () {
        var gid = step[0];
        return step[1]().then(function (rows) {
          rawCount[gid] = rows.length;
          var keep = rows.filter(function (r) {
            return r.date && start <= r.date && r.date <= today;
          });
          keep.forEach(function (r) {
            r.name = SOURCES[gid].name;
            r.weekday = weekdayCn(r.date);
            r.source = SOURCES[gid].org;
            r.digit = (gid === 'fc3d' || gid === 'pl5');
            if (gid === 'ssq' || gid === 'dlt') {
              var seen = {}, uniq = [];
              r.nums.forEach(function (n) {
                if (!seen[n]) { seen[n] = 1; uniq.push(n); }
              });
              r.nums = uniq.sort(function (a, b) { return a - b; });
            }
          });
          Array.prototype.push.apply(items, keep);
        }, function (e) {
          errors.push({
            game: gid, name: SOURCES[gid].name,
            error: (e && e.name ? e.name : 'Error') + ': '
              + String((e && e.message) || e).substring(0, 120)
          });
        }).then(function () { return wait(300); });
      });
    }, Promise.resolve()).then(function () {
      items.sort(function (a, b) {
        var d = ORDER[a.game] - ORDER[b.game];
        return d !== 0 ? d : cmpKeyDesc(a, b);
      });
      return {
        fetched_at: localStamp(),
        days: days,
        window: { from: start, to: today },
        items: items,
        raw_count: rawCount,
        errors: errors,
        client: 'mobile'
      };
    });
  }

  function localStamp() {
    var d = new Date();
    return isoOf(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* ================= 3. 对页面暴露 pywebview.api ================= */
  var CACHE_KEY = 'recent.json';

  function refreshRecent(days) {
    var n = parseInt(days, 10);
    if (isNaN(n)) n = 5;
    return collect(n).then(function (rec) {
      if (!rec.items.length && rec.errors.length) {
        return {
          ok: false,
          error: rec.errors.map(function (e) {
            return e.name + ' ' + e.error.substring(0, 60);
          }).join('；')
        };
      }
      cacheSet(CACHE_KEY, JSON.stringify(rec));
      return { ok: true, source: 'live', data: rec };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    });
  }

  function recent() {
    return cacheGet(CACHE_KEY).then(function (txt) {
      if (txt) {
        try {
          var d = JSON.parse(txt);
          if (d && d.items) return { ok: true, source: 'cache', data: d };
        } catch (e) { /* 缓存坏了就用内置快照 */ }
      }
      if (window.__BUNDLED_RECENT && window.__BUNDLED_RECENT.items) {
        return { ok: true, source: 'bundle', data: window.__BUNDLED_RECENT };
      }
      return { ok: false, error: '内置快照缺失' };
    }).catch(function () {
      if (window.__BUNDLED_RECENT && window.__BUNDLED_RECENT.items) {
        return { ok: true, source: 'bundle', data: window.__BUNDLED_RECENT };
      }
      return { ok: false, error: '内置快照缺失' };
    });
  }

  function openReport() {
    return call('openReport', {}).then(function () { return true; },
      function () { return false; });
  }

  var hasNative = !!(iosBridge() || andBridge());

  if (hasNative) {
    window.pywebview = window.pywebview || {};
    window.pywebview.api = {
      refresh_recent: refreshRecent,
      recent: recent,
      open_report: openReport,
      version: function () { return (window.__APP_VERSION__ || '3.0.0'); }
    };

    /* 桌面版这个事件由 pywebview 自己发；这里等页面脚本都跑完再发一次，
       让 init() 里注册的监听器能收到，走「优先读缓存」那条分支。 */
    var fired = false;
    function announce() {
      if (fired) return;
      fired = true;
      try { window.dispatchEvent(new Event('pywebviewready')); } catch (e) {
        try {
          var ev = document.createEvent('Event');
          ev.initEvent('pywebviewready', true, true);
          window.dispatchEvent(ev);
        } catch (e2) { /* 老 WebView 就算了 */ }
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(announce, 60);
      });
    } else {
      setTimeout(announce, 60);
    }
  }

  /* ================= 4. 剪贴板：绕开 WebView 对 file:// 的限制 =================
   * 页面用 navigator.clipboard.writeText(t).then(onOk, ...)，
   * 但 file:// 不是安全上下文，这个 API 在 WKWebView / Android WebView 里
   * 要么没有、要么直接 reject。改成走原生剪贴板，返回的 Promise 形状保持一致。*/
  function nativeCopy(text) {
    return call('copy', { text: String(text) }, 6000).then(function () { return true; });
  }

  if (hasNative) {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: nativeCopy }
      });
    } catch (e) {
      try {
        Object.defineProperty(Navigator.prototype, 'clipboard', {
          configurable: true,
          get: function () { return { writeText: nativeCopy }; }
        });
      } catch (e2) { /* 交给下面的 execCommand 兜底 */ }
    }

    // 最后一道保险：页面的 fallback() 会先选中一个 textarea 再 execCommand('copy')
    var rawExec = document.execCommand ? document.execCommand.bind(document) : null;
    document.execCommand = function (cmd) {
      if (String(cmd).toLowerCase() === 'copy') {
        var el = document.activeElement;
        var t = (el && typeof el.value === 'string') ? el.value : '';
        if (!t && window.getSelection) t = String(window.getSelection());
        if (t) {
          nativeCopy(t).catch(function () { });
          return true;
        }
      }
      return rawExec ? rawExec.apply(document, arguments) : false;
    };
  }

  /* ================= 5. 手机端版式 =================
   * 桌面版是「左控制 300px + 右结果」的两栏；竖屏塞不下，
   * 改成：结果在上、控制在下的单栏，并把「生成号码」做成常驻底部按钮。
   * 样式在 DOMContentLoaded 时才插到 head 末尾——必须晚于页面自己的 <style>，
   * 否则同样优先级下会被覆盖。*/
  var MOBILE_CSS = [
    '@media(max-width:760px){',
    'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
    'body{padding-bottom:calc(86px + env(safe-area-inset-bottom));',
    '  -webkit-tap-highlight-color:transparent}',
    '.wrap{padding:calc(10px + env(safe-area-inset-top)) 12px 18px}',

    /* 顶栏：标题一行，页签一行，横向可滑 */
    '.top{gap:8px;padding:2px 0 10px;flex-wrap:nowrap;align-items:flex-start}',
    '.brand{gap:9px;flex:1 1 auto;min-width:0}',
    '.logo{width:34px;height:34px;flex:0 0 34px}',
    '.logo .r{width:25px;height:25px;font-size:12.5px}',
    '.logo .b2{width:18px;height:18px;font-size:9.5px}',
    'h1{font-size:16.5px;white-space:nowrap}',
    'h1 em{font-size:10.5px;padding:1px 6px}',
    '.sub{font-size:10.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;',
    '  -webkit-box-orient:vertical;overflow:hidden}',
    '.topright{flex:0 0 auto;flex-wrap:nowrap;gap:6px}',
    '.tabs{padding:3px;border-radius:9px;max-width:calc(100vw - 150px);overflow-x:auto;',
    '  -webkit-overflow-scrolling:touch;scrollbar-width:none}',
    '.tabs::-webkit-scrollbar{display:none}',
    '.tabs button{flex:0 0 auto;padding:6px 10px;font-size:12.5px;white-space:nowrap}',
    '.repbtn{display:none!important}',

    /* 单栏：结果在前 */
    '.grid{display:flex;flex-direction:column;gap:12px}',
    '.grid>.card:first-child{order:2}',
    '.grid>main{order:1}',
    '.card{padding:14px;border-radius:12px}',
    '.two{grid-template-columns:1fr}',
    '.kpi{grid-template-columns:repeat(2,1fr)}',

    /* 触控尺寸 */
    '.chip{padding:8px 12px;font-size:14px}',
    '.chip small{font-size:10px}',
    '.lbl:not(:first-child){margin-top:15px}',

    /* 球号：竖屏一排 6 个刚好塞下 */
    '.bet{padding:11px 0;gap:8px}',
    '.balls{gap:5px}',
    '.ball{width:29px;height:29px;flex:0 0 29px;font-size:13px}',
    '.idx{padding-top:7px}',
    '.drow{grid-template-columns:74px 1fr;row-gap:3px}',
    '.dcell{display:none}',
    '.rechead{flex-direction:column;align-items:flex-start;gap:8px}',
    '.recacts{width:100%;justify-content:space-between}',

    /* 常驻底部操作条 */
    '#genBtn{position:fixed;left:12px;right:104px;bottom:calc(10px + env(safe-area-inset-bottom));',
    '  width:auto;margin:0;height:50px;padding:0;border-radius:12px;',
    '  font-size:16.5px;z-index:60;box-shadow:0 8px 22px rgba(198,40,40,.36)}',
    '#copyBtn{position:fixed;right:12px;bottom:calc(10px + env(safe-area-inset-bottom));',
    '  width:84px;margin:0;height:50px;padding:0;border-radius:12px;font-size:13px;',
    '  background:#fff;z-index:60;box-shadow:0 8px 20px rgba(16,24,40,.16)}',
    '.hint{font-size:11px;margin-top:10px}',

    /* 提示条抬高，别被底部按钮压住 */
    '#pop{bottom:calc(72px + env(safe-area-inset-bottom));max-width:88vw;padding:12px 20px}',
    '#pop b{font-size:14px}',
    '}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('__mobileCss')) return;
    var st = document.createElement('style');
    st.id = '__mobileCss';
    st.textContent = MOBILE_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCss);
  } else {
    injectCss();
  }
})();
