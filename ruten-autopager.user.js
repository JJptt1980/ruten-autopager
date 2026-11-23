// ==UserScript==
// @name         露天賣場自動翻頁
// @namespace    https://github.com/JJptt1980
// @version      1.5
// @description  露天拍賣賣場頁捲到底自動載入下一頁，不用 iframe，速度和露天本身一樣快
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
