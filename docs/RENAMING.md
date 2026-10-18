# Weftelio 改名與相容性

Weftelio 原名 Cantus Panel，自 0.5.2 起採用新名稱。GitHub 儲存庫為 [arumwu/weftelio](https://github.com/arumwu/weftelio)，npm 專案名稱為 `weftelio`。這次是品牌與專案名稱更新，六項桌面介面、外框、配色與手機版操作維持既有行為。

## 舊設定繼續適用

`CANTUS_*` 環境變數、`X-Cantus-Token` 等通訊標頭、瀏覽器儲存鍵、JavaScript 內部名稱與既有狀態格式保留相容；它們是技術識別，不是畫面上的品牌。啟用執行仍須明確設定 `CANTUS_MODE=local` 與 `CANTUS_ENABLE_EXECUTION=1`。

`config/local.json`、`state/` 與登入憑證不會因改名而自動搬移、覆寫或公開。舊版與新版可在不同目錄、不同埠獨立運作；不要讓兩份程式同時寫入同一組狀態。既有服務不需因 GitHub 改名而重新啟動。

## 已有服務時另開示範

```bash
CANTUS_PANEL_PORT=4593 CANTUS_NEXT_PORT=4594 npm run start:desktop
```

開啟 <http://127.0.0.1:4594>。預設僅有虛構示範，不讀取帳號、不呼叫 AI。原有 4589、4591 服務可以繼續使用。

GitHub 改名不會重寫提交歷史，也不改變第三方元件的授權。專案仍為 `UNLICENSED`；隨附 MIT 元件的授權與來源聲明保持原樣。
