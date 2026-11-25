# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案用途

一支 Tampermonkey 使用者腳本 `ruten-autopager.user.js`，適用 `https://www.ruten.com.tw/store/*`，沒有建置步驟、沒有相依套件、沒有自動測試。進度、測試數據、已定案的決定都記在 `docs/STATUS.md`。

腳本分兩部分：

1. **自動翻頁**（檔案前段）：露天賣場頁是 Vue SPA，「下一頁」沒有真正的網址。腳本直接點露天自己的 `.rt-pagination li.next`，把前一頁商品複製保留在列表上方，看起來像無限捲動。
   - 離畫面 3000 px 以外的舊頁包成 `.rtap-page`，由 IntersectionObserver 收起和放回，避免節點太多變卡。
   - 露天換頁時會自己呼叫 `window.scrollTo` 捲回列表頂端，有時比載入完成還晚。所以腳本永久包住 `scrollTo`、`scroll`、`scrollIntoView`：載入中全擋，載完 5 秒內擋「往上拉超過半個螢幕」的捲動（`GUARD_MS`）。改捲動相關程式時不要拿掉這層。
   - 直接打開 `/list?sort=new/dc` 時，露天可能給新版頁面（`product-card-v3`，自己會無限捲動），這時自動翻頁不會動作，這是正常的。
2. **公仔總覽**（檔案後段）：賣場頁左下角的按鈕，打開 `#rtfig` 覆蓋層。它直接呼叫露天 API，抓 6 家信任賣場的商品，提供主題聯集篩選、看過紀錄、跨店比價和同款分組。
   - 賣場清單：`rtapi.ruten.com.tw/api/search/v3/index.php/core/seller/<賣家數字ID>/prod?sort=new/dc&limit=50&offset=N&q=`，`limit` 最大 50。
   - 商品明細：`rapi.ruten.com.tw/api/items/v2/list?level=simple&gno=<ids>`。偶爾某一批會卡很久，所以 `getItems` 4 秒沒回就把這批拆成兩半重試。
   - 主題比對（`matchThemes`）用 NFKC 轉換再轉大寫；英文關鍵字要整個字相符，避免 EVA 配到 Elevated。
   - 同款分組（`sameKey`、`isSame`、`groupSame`，用 union-find）：先把標題裡的店名、預購日期、品牌、運費等雜訊去掉；中文字照次數比，只容許差一個字；英文字和編號要完全一樣。寧可少歸一組，也不要把不同商品湊在一起。
   - 標價 10 萬以上（`ASK_PRICE`）是賣家表示已結單或要詢價（例如 450 標成 450999），顯示「已結單／請詢問」，不拿去比價。
   - 設定存在 localStorage，key 開頭 `rtfig_`。

## 重要慣例

- 每次改腳本都要調高 `@version`，Tampermonkey 才會自動更新。
- `@name`、`@namespace` 絕對不能改，否則 Tampermonkey 會當成另一支腳本，使用者收不到更新。
- 公仔總覽只抓 `STORES` 裡的 6 家（使用者只信任這幾家，其他賣家詐騙多），不要擴大到全站搜尋。賣家數字 ID 記在 `docs/STATUS.md`。
- 露天賣場最多只顯示 134 頁。
- 程式註解和 UI 文字用繁體中文。

## 怎麼測試

沒有自動測試，在 Claude 桌面版的內建瀏覽器實測：

1. 打開露天賣場頁，例如 `https://www.ruten.com.tw/store/fordaniel/`。
2. 用 javascript 工具把腳本注入頁面執行。

GitHub raw 的分支網址會被 CDN 快取，要從 GitHub 載入測試中的版本時，用 commit SHA 的 raw 網址。

驗證重點（數字和方法見 `docs/STATUS.md`）：

- 自動翻頁：一直往下捲時有沒有逾時、被拉回、頁碼跳號，以及卡頓次數（LoAF／longtask）。
- 公仔總覽：載入時間、主題有沒有抓錯、同款有沒有分錯組。

離線調整同款判斷時，可以用 Node 抓真實標題存成 JSON 再跑判斷函式，不用每次都開瀏覽器。
