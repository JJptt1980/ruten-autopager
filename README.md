# 露天賣場自動翻頁

[![Ko-fi](https://img.shields.io/badge/Ko--fi-%E8%AB%8B%E6%88%91%E5%96%9D%E6%9D%AF%E5%92%96%E5%95%A1-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/jjptt1980)

一個 Tampermonkey 使用者腳本：在露天拍賣的賣場頁面往下捲時，自動載入下一頁商品並接在下方。

## 為什麼不用東方永頁機

露天賣場頁是用 JS 動態產生的，「下一頁」按鈕沒有真正的網址，東方永頁機只能用 iframe 把整個頁面重新載入一遍，所以每翻一頁都要等很久。

這支腳本直接替你點露天自己的「下一頁」，讓露天用它原本的 API 載入商品（實測每頁約 0.7–1.2 秒，速度取決於露天），再把前一頁的商品保留在上方，所以看起來像無限捲動。

## 功能

- 距離列表底部還剩約 3 個螢幕高時就先載入下一頁，捲到時已經準備好
- 載入中繼續往下捲，畫面不會被拉回去
- 離畫面很遠的舊頁會先收起來，翻到一百頁也不會變卡
- 每頁之間有「第 N 頁」分隔線
- 換頁時不會跳回列表頂端
- 切換分類、排序時自動重設
- 到最後一頁自動停止
- 適用所有露天賣場（`https://www.ruten.com.tw/store/*`）

## 安裝

1. 在瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/)
2. 點這個連結：[安裝腳本](https://raw.githubusercontent.com/JJptt1980/ruten-autopager/main/ruten-autopager.user.js)，Tampermonkey 會跳出安裝畫面，按「安裝」
3. 如果有裝東方永頁機，請在露天停用它，避免兩個一起翻頁
4. 重新整理露天賣場頁面

用這個連結安裝的話，之後 repo 更新時 Tampermonkey 會自動更新腳本。

> 之前是用「新增腳本後貼上內容」安裝的，請先刪掉舊的，再用上面的連結重新安裝，才會有自動更新。

## 開發

每次修改腳本都要調高開頭的 `@version`，Tampermonkey 才會偵測到更新。

## 設定

腳本開頭的 `TRIGGER_SCREENS` 控制提早多少載入，數字越大越早載入。

## 偵錯

瀏覽器主控台（F12 → Console）會顯示 `[自動翻頁]` 開頭的記錄，例如 `載入第 3 頁，68 ms`。

## 授權

[MIT](LICENSE)
