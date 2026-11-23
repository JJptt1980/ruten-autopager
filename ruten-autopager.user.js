// ==UserScript==
// @name         露天賣場自動翻頁
// @namespace    https://github.com/JJptt1980
// @version      1.6
// @description  露天賣場頁捲到底自動載入下一頁；左下角「公仔總覽」一次抓 6 家信任賣場的新上架商品，依主題篩選、跨店比價
// @match        https://www.ruten.com.tw/store/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/JJptt1980/ruten-autopager
// @updateURL    https://raw.githubusercontent.com/JJptt1980/ruten-autopager/main/ruten-autopager.user.js
// @downloadURL  https://raw.githubusercontent.com/JJptt1980/ruten-autopager/main/ruten-autopager.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LIST = '.rt-store-product-list-main';
  const NEXT_LI = '.rt-pagination li.next';
  const PAGE_INFO = '.page-info-pagenum';
  const TRIGGER_SCREENS = 3; // 距離列表底部還剩幾個螢幕高就先載入（露天每頁要 0.5～3 秒，太晚載入捲快了會看到空白）
  const TIMEOUT = 10000;

  let acc = null;
  let loading = false;
  // 網址扣掉頁碼 p 之後的部分：變了代表使用者換了分類、排序或搜尋
  const baseKey = () => {
    const u = new URL(location.href);
    u.searchParams.delete('p');
    u.searchParams.sort();
    return u.pathname.replace(/\/list\/?$/, '/').replace(/\/?$/, '/') + '?' + u.searchParams;
  };
  let lastKey = baseKey();
  let graceUntil = 0; // 自己翻頁後網址會晚一點才變，這段時間內不算使用者換分類

  const log = (...a) => console.log('[自動翻頁]', ...a);

  // 真正的商品列表（排除我們複製到累積區塊裡的那些）
  function getList() {
    return [...document.querySelectorAll(LIST)].find((l) => !l.closest('#rtap-acc')) || null;
  }

  function pageNum() {
    const m = (document.querySelector(PAGE_INFO)?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { cur: +m[1], total: +m[2] } : null;
  }

  function firstHref(list) {
    return list?.querySelector('a[href*="/item/"]')?.href || '';
  }

  function hasNext() {
    const li = document.querySelector(NEXT_LI);
    if (!li || /\b(current|disable)\b/.test(li.className)) return false;
    const p = pageNum();
    return !p || p.cur < p.total;
  }

  function ensureAcc(list) {
    if (acc && acc.isConnected) {
      if (acc.nextElementSibling !== list) list.parentNode.insertBefore(acc, list);
      return acc;
    }
    acc = document.createElement('div');
    acc.id = 'rtap-acc';
    list.parentNode.insertBefore(acc, list);
    return acc;
  }

  function separator(n) {
    const d = document.createElement('div');
    d.textContent = `— 第 ${n} 頁 —`;
    d.style.cssText = 'margin:16px 0;padding:6px 0;text-align:center;color:#888;font-size:14px;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;';
    return d;
  }

  // 離畫面很遠的舊頁先把商品拿掉、只留同樣高度的空框，捲回附近再放回去。
  // 翻了幾十頁、畫面上有幾千個商品時，換頁才不會越來越卡
  const pager = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const holder = e.target;
      if (e.isIntersecting) {
        if (!holder.firstChild) {
          holder.appendChild(holder._snap);
          holder.style.height = '';
        }
      } else if (holder.firstChild) {
        holder.style.height = e.boundingClientRect.height + 'px';
        holder.replaceChildren();
      }
    }
  }, { rootMargin: '3000px 0px' });

  // 載入中暫時停用網站的捲動，避免換頁時跳回列表頂端
  const orig = {
    scrollTo: window.scrollTo,
    scroll: window.scroll,
    scrollIntoView: Element.prototype.scrollIntoView,
    elScrollTo: Element.prototype.scrollTo,
  };
  function lockScroll() {
    const noop = function () {};
    window.scrollTo = window.scroll = noop;
    Element.prototype.scrollIntoView = noop;
    Element.prototype.scrollTo = noop;
  }
  function unlockScroll() {
    window.scrollTo = orig.scrollTo;
    window.scroll = orig.scroll;
    Element.prototype.scrollIntoView = orig.scrollIntoView;
    Element.prototype.scrollTo = orig.elScrollTo;
  }

  function loadNext() {
    const list = getList();
    const nextA = document.querySelector(NEXT_LI + ' a');
    if (!list || !nextA || !firstHref(list)) return;

    loading = true;
    const before = pageNum();
    const beforeHref = firstHref(list);
    const y = window.scrollY;
    const t0 = performance.now();

    const h = list.offsetHeight; // 先量好高度，避免改完畫面再量又要重排一次

    // 把目前這頁的商品複製一份留在列表上方
    const snap = list.cloneNode(true);
    snap.removeAttribute('id');
    const holder = document.createElement('div');
    holder.className = 'rtap-page';
    holder._snap = snap;
    holder.appendChild(snap);
    const box = ensureAcc(list);
    if (!box.children.length && before) box.appendChild(separator(before.cur));
    box.appendChild(holder);
    pager.observe(holder);
    const sep = separator(before ? before.cur + 1 : '?');
    box.appendChild(sep);

    list.style.minHeight = h + 'px';
    // 載入期間使用者還會繼續捲，記下使用者捲到的位置；
    // 一下子往上跳超過一個螢幕高的，當成是露天自己把畫面拉回列表頂端，不算
    let userY = y;
    const onScroll = () => {
      const cur = window.scrollY;
      if (userY - cur < window.innerHeight / 2) userY = cur;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    lockScroll();
    nextA.click();

    const done = (ok) => {
      clearInterval(timer);
      window.removeEventListener('scroll', onScroll);
      unlockScroll();
      list.style.minHeight = '';
      // 只在露天把畫面往上拉了一大段時才補救；使用者自己往下捲的不去動，免得被拉回一小段
      if (userY - window.scrollY > window.innerHeight / 2) orig.scrollTo.call(window, 0, userY);
      if (!ok) { pager.unobserve(holder); holder.remove(); sep.remove(); }
      loading = false;
      graceUntil = performance.now() + 1500;
      lastKey = baseKey();
      log(ok ? `載入第 ${pageNum()?.cur} 頁，${Math.round(performance.now() - t0)} ms` : '載入逾時');
      if (ok) setTimeout(check, 300);
    };

    const timer = setInterval(() => {
      const cur = getList();
      const p = pageNum();
      const changed = cur && cur.children.length && firstHref(cur) !== beforeHref &&
        (!before || (p && p.cur !== before.cur));
      if (changed) {
        // 等下一個畫面更新後再放開捲動鎖定
        requestAnimationFrame(() => done(true));
        clearInterval(timer);
      } else if (performance.now() - t0 > TIMEOUT) {
        done(false);
      }
    }, 30);
  }

  function check() {
    if (loading) return;
    const list = getList();
    if (!list || !hasNext()) return;
    const remain = list.getBoundingClientRect().bottom - window.innerHeight;
    if (remain < window.innerHeight * TRIGGER_SCREENS) loadNext();
  }

  // 使用者自己換分類、排序、搜尋時，清掉已累積的頁面
  setInterval(() => {
    const k = baseKey();
    if (k === lastKey) return;
    lastKey = k;
    if (loading || performance.now() < graceUntil) return;
    if (acc) {
      pager.disconnect();
      acc.remove();
      acc = null;
      log('換了分類或排序，重設');
    }
  }, 300);

  // 已經捲到底就不會再有 scroll 事件，定時補檢查一次
  setInterval(check, 800);

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; check(); });
  }, { passive: true });
})();

// ───────────────────────────────────────────────────────────────
// 公仔總覽：一次抓 6 家信任賣場的新上架商品，依主題篩選、跨店比價
// ───────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // 只抓這幾家（露天詐騙多，只信任這些賣場）。id 是露天內部的賣家編號
  const STORES = [
    { user: 'fordaniel', id: 8764119, name: '史派克工廠' },
    { user: 'macross50711', id: 1616967, name: '轉蛋概念館' },
    { user: 'aaa760531', id: 10228358, name: '萬年馬如龍' },
    { user: 'toytoy142000', id: 2353693, name: '冠軍玩具' },
    { user: 'ykohmkphilip', id: 4761983, name: '怨念事務所' },
    { user: 'mrjoe_model', id: 10057498, name: '密斯特喬' },
  ];

  // 主題：分組、名稱、比對用的關鍵字（標題含任一個就算）、要排除的字
  const T = (g, name, kw, not) => ({ g, name, kw: kw.split('、'), not: not ? not.split('、') : [] });
  const NOT_HUNTER = '魔物獵人、城市獵人、惡魔獵人、MONSTER HUNTER、CITY HUNTER';
  const THEMES = [
    T('我的主題', '美女', '美女、美少女、泳裝、兔女郎、女僕、BISHOUJO'),
    T('我的主題', '恐龍', '恐龍、暴龍、迅猛龍、三角龍、侏羅紀、JURASSIC'),
    T('我的主題', '機器人', '機器人、機甲、ROBOT、超合金'),
    T('我的主題', '進擊的巨人', '進擊的巨人、進擊巨人、艾連、兵長、里維'),
    T('我的主題', '灌籃高手', '灌籃高手、SLAM DUNK、SLAMDUNK、櫻木、流川'),
    T('我的主題', '幽遊白書', '幽遊白書、幽☆遊☆白書、飛影、藏馬、浦飯'),
    T('我的主題', '獵人', '獵人、HUNTER×HUNTER、HUNTERXHUNTER、小傑、奇犽、西索、酷拉皮卡', NOT_HUNTER),
    T('我的主題', '死亡筆記本', '死亡筆記、DEATH NOTE、DEATHNOTE、夜神月'),
    T('我的主題', '黃金神威', '黃金神威'),
    T('我的主題', '七龍珠', '七龍珠、龍珠、DRAGON BALL、DRAGONBALL、悟空、達爾、貝吉塔、弗利沙', '九龍珠'),
    T('我的主題', 'EVA', 'EVA、福音戰士、初號機、綾波、明日香'),
    T('我的主題', '迷宮飯', '迷宮飯'),
    T('我的主題', '鏈鋸人', '鏈鋸人、電鋸人、鍊鋸人、CHAINSAW、帕瓦、瑪奇瑪'),
    T('我的主題', '九龍珠', '九龍珠'),
    T('我的主題', '神龍之謎', '神龍之謎、達伊大冒險'),
    T('我的主題', 'JOJO', 'JOJO、喬喬、承太郎、空條'),
    T('我的主題', '魔動王', '魔動王、GRANZORT'),
    T('我的主題', '殺手童話', '殺手童話'),
    T('我的主題', '咒術迴戰', '咒術迴戰、咒術回戰、五條悟、虎杖、宿儺'),
    T('我的主題', '鋼之鍊金術師', '鋼之鍊金術師、鋼之煉金術師、鋼鍊、鋼煉'),
    T('我的主題', '電玩作品', '電玩、遊戲角色、電子遊戲'),
    T('我的主題', '星海爭霸', '星海爭霸、STARCRAFT'),
    T('我的主題', '世紀帝國', '世紀帝國、AGE OF EMPIRES'),
    T('我的主題', '暗黑破壞神', '暗黑破壞神、DIABLO'),
    T('我的主題', '蠟筆小新', '蠟筆小新'),
    T('我的主題', '哥布林殺手', '哥布林殺手、GOBLIN SLAYER'),
    T('我的主題', '飛躍動作', '飛躍、躍動、跳躍、動態'),
    T('我的主題', '筋斗雲', '筋斗雲、觔斗雲'),
    T('我的主題', '飛行', '飛行、飛翔、飛天'),
    T('我的主題', '亂馬 1/2', '亂馬'),
    T('我的主題', '棒球', '棒球、MLB、大谷'),
    T('我的主題', '籃球', '籃球、NBA'),
    T('我的主題', '高爾夫', '高爾夫、GOLF'),
    T('我的主題', '工程', '工程車、怪手、挖土機、推土機、吊車、砂石車'),
    T('我的主題', '機械', '機械、齒輪'),
    T('我的主題', '富堅義博', '富堅義博、幽遊白書、獵人、HUNTER×HUNTER、靈異E接觸、LEVEL E', NOT_HUNTER),
    T('新作', '葬送的芙莉蓮', '芙莉蓮'),
    T('新作', '膽大黨', '膽大黨'),
    T('新作', '怪獸8號', '怪獸8號、怪獸八號'),
    T('新作', '藥師少女', '藥師少女、藥屋少女'),
    T('新作', '我推的孩子', '我推的孩子、星野愛'),
    T('新作', '間諜家家酒', '間諜家家酒、SPY×FAMILY、SPYFAMILY、安妮亞'),
    T('新作', '排球少年', '排球少年'),
    T('冷門', '寄生獸', '寄生獸'),
    T('冷門', '銃夢', '銃夢、艾莉塔'),
    T('冷門', '烙印勇士', '烙印勇士、劍風傳奇、BERSERK'),
    T('冷門', '怪物（浦澤直樹）', '浦澤直樹'),
    T('冷門', '天元突破', '天元突破、古蓮拉剛'),
    T('冷門', '攻殼機動隊', '攻殼機動隊、草薙素子'),
    T('冷門', '星際牛仔', '星際牛仔、BEBOP'),
    T('冷門', '異獸魔都', '異獸魔都、DOROHEDORO'),
    T('冷門', '魔法陣', '魔法陣'),
    T('經典', '聖鬥士星矢', '聖鬥士、星矢、聖衣神話'),
    T('經典', '北斗神拳', '北斗神拳、拳四郎'),
    T('經典', '鋼彈', '鋼彈、GUNDAM、高達'),
    T('經典', '超人力霸王', '超人力霸王、奧特曼、ULTRAMAN'),
    T('經典', '假面騎士', '假面騎士、KAMEN RIDER'),
    T('經典', '哥吉拉', '哥吉拉、GODZILLA'),
    T('經典', '變形金剛', '變形金剛、TRANSFORMERS'),
    T('經典', '城市獵人', '城市獵人、CITY HUNTER'),
    T('電玩', '魔物獵人', '魔物獵人、MONSTER HUNTER'),
    T('電玩', '艾爾登法環', '艾爾登法環、ELDEN RING'),
    T('電玩', '太空戰士', '太空戰士、最終幻想、FINAL FANTASY'),
    T('電玩', '潛龍諜影', '潛龍諜影、METAL GEAR'),
    T('電玩', '薩爾達', '薩爾達、ZELDA'),
    T('電玩', '惡魔獵人', '惡魔獵人、DEVIL MAY CRY'),
    T('電玩', '洛克人', '洛克人、ROCKMAN、MEGA MAN'),
  ];

  const API_LIST = (sid, q, sort, offset) =>
    'https://rtapi.ruten.com.tw/api/search/v3/index.php/core/seller/' + sid +
    '/prod?sort=' + sort + '&limit=50&offset=' + offset + (q ? '&q=' + encodeURIComponent(q) : '');
  const API_ITEMS = (ids) => 'https://rapi.ruten.com.tw/api/items/v2/list?level=simple&gno=' + ids.join(',');
  const ASK_PRICE = 1000000; // 賣家用來代表「價格請詢問」的離譜價格

  // ── 存在瀏覽器裡的設定與資料 ──
  const K = 'rtfig_';
  const load = (k, d) => { try { const v = localStorage.getItem(K + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) { /* 存不下就算了 */ } };
  const cfg = Object.assign({
    checked: null, // null 代表全選
    stores: STORES.map((s) => s.user),
    pages: 4, // 每家抓幾頁（每頁 50 件）
    onlyNew: false,
    min: '', max: '',
    sort: 'new',
    tab: 'new',
  }, load('cfg', {}));
  let custom = load('custom', []); // 自訂主題 [{name, kw:[...]}]
  const seen = new Set(load('seen', []));
  let cache = load('items', null); // {time, items}
  let cmp = null; // 比價結果 {q, items}

  const allThemes = () => THEMES.concat(custom.map((c) => ({ g: '自訂', name: c.name, kw: c.kw, not: [] })));
  const isChecked = (name) => !cfg.checked || cfg.checked.includes(name);
  const norm = (s) => (s || '').normalize('NFKC').toUpperCase();
  // 英文關鍵字要整個字相符（EVA 不能配到 Elevated、BERSERK 不能配到 Berserker）
  const reCache = new Map();
  const has = (t, k) => {
    k = norm(k);
    if (!/^[A-Z0-9 .×-]+$/.test(k)) return t.includes(k);
    if (!reCache.has(k)) reCache.set(k, new RegExp('(^|[^A-Z])' + k.replace(/[.×-]/g, '\\$&') + '($|[^A-Z])'));
    return reCache.get(k).test(t);
  };
  const matchThemes = (title) => {
    const t = norm(title);
    return allThemes().filter((th) => th.kw.some((k) => has(t, k)) && !th.not.some((k) => has(t, k)));
  };

  // ── 抓資料 ──
  // 每次最多等 timeout 毫秒，失敗重試 tries 次
  async function getJSON(url, timeout = 8000, tries = 3) {
    for (let i = 0; i < tries; i++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      try {
        const r = await fetch(url, { credentials: 'omit', signal: ac.signal });
        if (r.ok) return await r.json();
      } catch (e) { /* 重試 */ } finally { clearTimeout(timer); }
      if (i < tries - 1) await new Promise((z) => setTimeout(z, 500 * (i + 1)));
    }
    throw new Error('連不上露天');
  }

  // 拿商品明細。露天偶爾某一批會卡 20 秒，等 4 秒沒回應就拆成兩半再試，
  // 拆到單件還拿不到就跳過那一件
  async function getItems(ids) {
    try {
      return (await getJSON(API_ITEMS(ids), 4000, 1)).data || [];
    } catch (e) {
      if (ids.length === 1) return [];
      const mid = ids.length >> 1;
      const [a, b] = await Promise.all([getItems(ids.slice(0, mid)), getItems(ids.slice(mid))]);
      return a.concat(b);
    }
  }

  async function pool(tasks, n) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); }
    }));
    return out;
  }

  function slim(x, store) {
    const lo = x.goods_price_range?.min ?? x.goods_price;
    const hi = x.goods_price_range?.max ?? x.goods_price;
    return {
      id: x.id, name: x.name, store: store.name, user: store.user,
      price: lo, hi, img: x.images?.m_url?.[0] || x.images?.url?.[0] || '',
      t: +x.post_time || 0, sold: x.sold_num || 0, stock: x.stock_status,
    };
  }

  // 抓一家的商品：先拿編號清單，再分批拿明細
  async function fetchStore(store, q, sort, pages, progress) {
    const ids = [];
    for (let p = 0; p < pages; p++) {
      const j = await getJSON(API_LIST(store.id, q, sort, p * 50 + 1));
      const rows = j.Rows || [];
      ids.push(...rows.map((r) => r.Id));
      if (progress) progress();
      if (rows.length < 50 || ids.length >= (j.TotalRows || 0)) break;
    }
    const batches = [];
    for (let i = 0; i < ids.length; i += 30) batches.push(ids.slice(i, i + 30));
    const res = await pool(batches.map((b) => () => getItems(b)), 3);
    // 只留真的是這家賣的
    return res.flat().filter((x) => x.user === store.user).map((x) => slim(x, store));
  }

  async function fetchAll(q, sort, pages) {
    const stores = STORES.filter((s) => cfg.stores.includes(s.user));
    let n = 0;
    const total = stores.length * pages;
    const progress = () => setStatus('抓取中… ' + Math.min(++n, total) + ' / ' + total);
    const lists = await pool(stores.map((s) => () => fetchStore(s, q, sort, pages, progress).catch((e) => {
      console.warn('[公仔總覽]', s.name, e);
      return [];
    })), 3);
    const map = new Map();
    lists.flat().forEach((it) => map.set(it.id, it));
    return [...map.values()];
  }

  // ── 畫面 ──
  let root = null;
  const $ = (sel) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setStatus = (s) => { if (root) $('#rtfig-status').textContent = s; };
  const fmtDate = (t) => { const d = new Date(t * 1000); return (d.getMonth() + 1) + '/' + d.getDate(); };
  const fmtPrice = (it) => it.price >= ASK_PRICE ? '價格請詢問'
    : '$' + it.price.toLocaleString() + (it.hi > it.price && it.hi < ASK_PRICE ? ' 起' : '');

  const CSS = `
#rtfig{position:fixed;inset:0;z-index:2147483000;background:#f5f5f7;color:#1d1d1f;overflow:auto;font:14px/1.5 -apple-system,"PingFang TC","Microsoft JhengHei",sans-serif}
#rtfig *{box-sizing:border-box}
#rtfig .bar{position:sticky;top:0;z-index:2;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);border-bottom:1px solid #ddd;padding:10px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#rtfig h1{font-size:18px;margin:0 8px 0 0}
#rtfig button,#rtfig select,#rtfig input{font:inherit;border:1px solid #ccc;border-radius:8px;padding:5px 10px;background:#fff;color:inherit}
#rtfig button{cursor:pointer}
#rtfig button:disabled{opacity:.5;cursor:default}
#rtfig button.pri{background:#0071e3;border-color:#0071e3;color:#fff}
#rtfig .tabs button.on{background:#1d1d1f;color:#fff;border-color:#1d1d1f}
#rtfig .wrap{display:flex;gap:16px;padding:16px 20px;align-items:flex-start}
#rtfig .side{width:290px;flex:none;position:sticky;top:64px;max-height:calc(100vh - 80px);overflow:auto;background:#fff;border-radius:12px;padding:12px}
#rtfig .side h3{font-size:13px;color:#666;margin:12px 0 4px;display:flex;gap:8px;align-items:center}
#rtfig .side h3 a,#rtfig .grp a{font-weight:normal;color:#0071e3;cursor:pointer;font-size:12px}
#rtfig .grp{font-size:12px;color:#999;margin-top:8px}
#rtfig .chips{display:flex;flex-wrap:wrap;gap:4px}
#rtfig .chips label{border:1px solid #ddd;border-radius:14px;padding:1px 9px;cursor:pointer;font-size:13px;user-select:none}
#rtfig .chips label.on{background:#e8f1fd;border-color:#0071e3;color:#0058b0}
#rtfig .chips input{display:none}
#rtfig .chips .cnt{color:#999;font-size:11px;margin-left:3px}
#rtfig .chips .del{color:#c00;margin-left:4px}
#rtfig .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}
#rtfig .main{flex:1;min-width:0}
#rtfig .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
#rtfig .card{background:#fff;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;display:flex;flex-direction:column;position:relative}
#rtfig .card:hover{box-shadow:0 4px 16px rgba(0,0,0,.12)}
#rtfig .card img{width:100%;aspect-ratio:1;object-fit:contain;background:#fafafa}
#rtfig .card .t{padding:6px 8px 0;font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
#rtfig .card .p{padding:4px 8px;font-weight:600;color:#d70015}
#rtfig .card .m{padding:0 8px 8px;font-size:11px;color:#888;margin-top:auto}
#rtfig .card .new{position:absolute;top:6px;left:6px;background:#ff3b30;color:#fff;font-size:11px;padding:1px 6px;border-radius:8px}
#rtfig .card .best{position:absolute;top:6px;right:6px;background:#34c759;color:#fff;font-size:11px;padding:1px 6px;border-radius:8px}
#rtfig .tags{padding:0 8px;font-size:11px;color:#0058b0}
#rtfig .empty{padding:60px;text-align:center;color:#888;grid-column:1/-1}
#rtfig-btn{position:fixed;left:16px;bottom:16px;z-index:2147482000;background:#1d1d1f;color:#fff;border:0;border-radius:20px;padding:8px 16px;font:14px -apple-system,"PingFang TC",sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25)}
@media (max-width:760px){#rtfig .wrap{flex-direction:column}#rtfig .side{width:100%;position:static;max-height:none}}`;

  const HTML = `
<div class="bar">
  <h1>公仔總覽</h1>
  <span class="tabs"><button data-tab="new">新上架</button> <button data-tab="cmp">比價</button></span>
  <span id="rtfig-cmpbox" class="row"><input id="rtfig-q" placeholder="作品或商品名，例如：西索" size="22"><button class="pri" id="rtfig-go">比價</button></span>
  <button class="pri" id="rtfig-refresh">抓最新商品</button>
  <button id="rtfig-seen">全部標為看過</button>
  <span id="rtfig-status" style="color:#666"></span>
  <span style="flex:1"></span>
  <button id="rtfig-close">關閉</button>
</div>
<div class="wrap">
  <div class="side">
    <h3>賣場</h3><div class="chips" id="rtfig-stores"></div>
    <h3>條件</h3>
    <div class="row"><label><input type="checkbox" id="rtfig-onlynew"> 只看沒看過的</label></div>
    <div class="row">價格 <input id="rtfig-min" size="5" placeholder="最低"> ～ <input id="rtfig-max" size="5" placeholder="最高"></div>
    <div class="row">排序 <select id="rtfig-sort"><option value="new">最新上架</option><option value="lo">價格低到高</option><option value="hi">價格高到低</option><option value="sold">賣最多</option></select></div>
    <div class="row">每家抓 <select id="rtfig-pages"><option>2</option><option>4</option><option>8</option><option>12</option></select> 頁（每頁 50 件）</div>
    <h3>主題（符合任一個就列出）<a id="rtfig-all">全選</a><a id="rtfig-none">全不選</a></h3>
    <div id="rtfig-themes"></div>
    <h3>自訂主題</h3>
    <div class="row"><input id="rtfig-cname" placeholder="名稱" size="7"><input id="rtfig-ckw" placeholder="關鍵字，用、分開" size="13"><button id="rtfig-cadd">加</button></div>
  </div>
  <div class="main"><div id="rtfig-info" style="margin-bottom:8px;color:#666"></div><div class="grid" id="rtfig-grid"></div></div>
</div>`;

  function open() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'rtfig';
    root.innerHTML = HTML;
    document.body.appendChild(root);
    document.documentElement.style.overflow = 'hidden';
    bind();
    renderSide();
    render();
    if (!cache) refresh();
    else setStatus('上次抓取：' + new Date(cache.time).toLocaleString());
  }

  function close() {
    if (root) root.remove();
    root = null;
    document.documentElement.style.overflow = '';
  }

  const persist = () => save('cfg', cfg);

  function bind() {
    $('#rtfig-close').onclick = close;
    $('#rtfig-refresh').onclick = refresh;
    $('#rtfig-seen').onclick = () => {
      ((cache && cache.items) || []).concat((cmp && cmp.items) || []).forEach((it) => seen.add(it.id));
      save('seen', [...seen].slice(-20000));
      render();
    };
    root.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { cfg.tab = b.dataset.tab; persist(); render(); }));
    $('#rtfig-go').onclick = () => compare($('#rtfig-q').value.trim());
    $('#rtfig-q').onkeydown = (e) => { if (e.key === 'Enter') compare($('#rtfig-q').value.trim()); };
    const onlyNew = $('#rtfig-onlynew');
    onlyNew.checked = cfg.onlyNew;
    onlyNew.onchange = () => { cfg.onlyNew = onlyNew.checked; persist(); render(); };
    for (const k of ['min', 'max']) {
      const el = $('#rtfig-' + k);
      el.value = cfg[k];
      el.oninput = () => { cfg[k] = el.value.replace(/\D/g, ''); persist(); render(); };
    }
    $('#rtfig-sort').value = cfg.sort;
    $('#rtfig-sort').onchange = (e) => { cfg.sort = e.target.value; persist(); render(); };
    $('#rtfig-pages').value = String(cfg.pages);
    $('#rtfig-pages').onchange = (e) => { cfg.pages = +e.target.value; persist(); };
    $('#rtfig-all').onclick = () => { cfg.checked = null; persist(); renderSide(); render(); };
    $('#rtfig-none').onclick = () => { cfg.checked = []; persist(); renderSide(); render(); };
    $('#rtfig-cadd').onclick = () => {
      const name = $('#rtfig-cname').value.trim();
      const kw = $('#rtfig-ckw').value.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
      if (!name) return;
      custom = custom.filter((c) => c.name !== name).concat({ name, kw: kw.length ? kw : [name] });
      save('custom', custom);
      if (cfg.checked && !cfg.checked.includes(name)) cfg.checked.push(name);
      persist();
      $('#rtfig-cname').value = '';
      $('#rtfig-ckw').value = '';
      renderSide();
      render();
    };
  }

  function setChecked(names, on) {
    if (!cfg.checked) cfg.checked = allThemes().map((t) => t.name);
    cfg.checked = on ? [...new Set(cfg.checked.concat(names))] : cfg.checked.filter((n) => !names.includes(n));
    persist();
  }

  function renderSide() {
    const st = $('#rtfig-stores');
    st.innerHTML = STORES.map((s) =>
      '<label class="' + (cfg.stores.includes(s.user) ? 'on' : '') + '"><input type="checkbox" data-u="' + s.user + '">' + esc(s.name) + '</label>').join('');
    st.querySelectorAll('input').forEach((i) => (i.onchange = () => {
      const u = i.dataset.u;
      cfg.stores = cfg.stores.includes(u) ? cfg.stores.filter((x) => x !== u) : cfg.stores.concat(u);
      persist(); renderSide(); render();
    }));

    const counts = {};
    ((cache && cache.items) || []).forEach((it) => matchThemes(it.name).forEach((t) => (counts[t.name] = (counts[t.name] || 0) + 1)));
    const groups = {};
    allThemes().forEach((t) => (groups[t.g] = groups[t.g] || []).push(t));
    const th = $('#rtfig-themes');
    th.innerHTML = Object.entries(groups).map(([g, list]) =>
      '<div class="grp">' + esc(g) + ' <a data-g="' + esc(g) + '">整組切換</a></div><div class="chips">' +
      list.map((t) => '<label class="' + (isChecked(t.name) ? 'on' : '') + '" title="' + esc(t.kw.join('、')) + '">' +
        '<input type="checkbox" data-n="' + esc(t.name) + '">' + esc(t.name) +
        '<span class="cnt">' + (counts[t.name] || '') + '</span>' +
        (t.g === '自訂' ? '<span class="del" data-del="' + esc(t.name) + '">×</span>' : '') + '</label>').join('') +
      '</div>').join('');
    th.querySelectorAll('input').forEach((i) => (i.onchange = () => {
      const n = i.dataset.n;
      if (cfg.tab === 'cmp') { $('#rtfig-q').value = n; compare(n); return; }
      setChecked([n], !isChecked(n)); renderSide(); render();
    }));
    th.querySelectorAll('[data-g]').forEach((a) => (a.onclick = () => {
      const names = allThemes().filter((t) => t.g === a.dataset.g).map((t) => t.name);
      setChecked(names, !names.every(isChecked)); renderSide(); render();
    }));
    th.querySelectorAll('[data-del]').forEach((x) => (x.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      custom = custom.filter((c) => c.name !== x.dataset.del);
      save('custom', custom); renderSide(); render();
    }));
  }

  function filtered(items, useThemes) {
    const min = cfg.min ? +cfg.min : 0;
    const max = cfg.max ? +cfg.max : Infinity;
    const hasRange = min > 0 || max < Infinity;
    return items.filter((it) => {
      if (!cfg.stores.includes(it.user)) return false;
      if (cfg.onlyNew && seen.has(it.id)) return false;
      if (hasRange && (it.price >= ASK_PRICE || it.price < min || it.price > max)) return false;
      const m = matchThemes(it.name);
      it.tags = (useThemes ? m.filter((t) => isChecked(t.name)) : m).map((t) => t.name);
      return !useThemes || it.tags.length > 0;
    });
  }

  function sortItems(list, how) {
    const lo = (it) => (it.price >= ASK_PRICE ? Infinity : it.price);
    const hi = (it) => (it.price >= ASK_PRICE ? -1 : it.price);
    const f = {
      new: (a, b) => b.t - a.t,
      lo: (a, b) => lo(a) - lo(b),
      hi: (a, b) => hi(b) - hi(a),
      sold: (a, b) => b.sold - a.sold,
    }[how];
    return list.sort(f);
  }

  function card(it, minPrice) {
    const meta = esc(it.store) + '・' + fmtDate(it.t) + ' 上架' + (it.sold ? '・賣出 ' + it.sold : '') + (it.stock === 2 ? '・預購' : '');
    return '<a class="card" href="https://www.ruten.com.tw/item/show?' + it.id + '" target="_blank" rel="noopener">' +
      (seen.has(it.id) ? '' : '<span class="new">新</span>') +
      (it.price === minPrice ? '<span class="best">最便宜</span>' : '') +
      '<img loading="lazy" src="' + esc(it.img) + '" alt="">' +
      '<div class="t">' + esc(it.name) + '</div>' +
      '<div class="tags">' + esc((it.tags || []).join('・')) + '</div>' +
      '<div class="p">' + fmtPrice(it) + '</div>' +
      '<div class="m">' + meta + '</div></a>';
  }

  function render() {
    if (!root) return;
    root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === cfg.tab));
    $('#rtfig-cmpbox').style.display = cfg.tab === 'cmp' ? '' : 'none';
    let list;
    let minPrice = -1;
    if (cfg.tab === 'cmp') {
      if (!cmp) {
        $('#rtfig-info').textContent = '輸入作品或商品名稱按「比價」，或在左邊點一個主題。會在勾選的賣場裡搜尋，依價格排好。';
        $('#rtfig-grid').innerHTML = '';
        return;
      }
      list = sortItems(filtered(cmp.items, false), cfg.sort);
      const cheapest = {};
      list.forEach((it) => { if (it.price < ASK_PRICE && !(it.store in cheapest)) cheapest[it.store] = it.price; });
      const priced = list.filter((i) => i.price < ASK_PRICE).map((i) => i.price);
      minPrice = priced.length ? Math.min(...priced) : -1;
      const per = Object.entries(cheapest).map(([s, p]) => s + ' $' + p.toLocaleString()).join('、');
      $('#rtfig-info').textContent = '「' + cmp.q + '」共 ' + list.length + ' 件。各家最低價：' + (per || '無');
    } else {
      const items = (cache && cache.items) || [];
      list = sortItems(filtered(items, true), cfg.sort);
      const newN = list.filter((it) => !seen.has(it.id)).length;
      $('#rtfig-info').textContent = '符合主題 ' + list.length + ' 件（沒看過 ' + newN + ' 件），從各家最新的 ' + items.length + ' 件商品中篩選';
    }
    const shown = list.slice(0, 600);
    $('#rtfig-grid').innerHTML = shown.length ? shown.map((it) => card(it, minPrice)).join('')
      : '<div class="empty">沒有符合條件的商品</div>';
    if (list.length > shown.length) {
      $('#rtfig-grid').insertAdjacentHTML('beforeend', '<div class="empty">還有 ' + (list.length - shown.length) + ' 件沒顯示，請少勾一些主題或加價格條件</div>');
    }
  }

  async function refresh() {
    const btn = $('#rtfig-refresh');
    btn.disabled = true;
    const t0 = performance.now();
    try {
      const items = await fetchAll('', 'new/dc', cfg.pages);
      cache = { time: Date.now(), items };
      save('items', cache);
      setStatus('抓到 ' + items.length + ' 件，' + ((performance.now() - t0) / 1000).toFixed(1) + ' 秒');
    } catch (e) {
      setStatus('抓取失敗：' + e.message);
    }
    if (root) { btn.disabled = false; renderSide(); render(); }
  }

  async function compare(q) {
    if (!q) return;
    cfg.tab = 'cmp';
    // 比價預設照價格由低到高，排序選單也跟著改，免得顯示「最新上架」卻是照價格排
    if (cfg.sort === 'new') { cfg.sort = 'lo'; $('#rtfig-sort').value = 'lo'; }
    persist();
    render();
    setStatus('搜尋「' + q + '」…');
    const th = allThemes().find((t) => t.name === q);
    // 點主題的話，用它的前幾個關鍵字分別搜尋再合併
    const words = th ? th.kw.slice(0, 3) : [q];
    const t0 = performance.now();
    const all = (await Promise.all(words.map((w) => fetchAll(w, 'new/dc', 2)))).flat();
    const map = new Map();
    all.forEach((it) => map.set(it.id, it));
    let items = [...map.values()];
    if (th) items = items.filter((it) => matchThemes(it.name).some((m) => m.name === th.name));
    cmp = { q, items };
    setStatus('找到 ' + items.length + ' 件，' + ((performance.now() - t0) / 1000).toFixed(1) + ' 秒');
    render();
  }

  // 樣式和左下角的開啟按鈕
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const btn = document.createElement('button');
  btn.id = 'rtfig-btn';
  btn.textContent = '公仔總覽';
  btn.onclick = open;
  document.body.appendChild(btn);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root) close(); });
})();
