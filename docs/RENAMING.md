# 名稱與相容性

專案與公開網址恢復使用 **Cantus**。GitHub 儲存庫為 [arumwu/cantus-panel](https://github.com/arumwu/cantus-panel)，npm 專案名稱為 `cantus-panel`。這次只恢復名稱，桌面新版六個介面、外框、配色、手機版與既有資料保持不變。

## 原有設定繼續適用

`CANTUS_*` 環境變數、`X-Cantus-Token`、瀏覽器儲存鍵、JavaScript 內部名稱與狀態格式保持相容。啟用執行仍須明確設定 `CANTUS_MODE=local` 與 `CANTUS_ENABLE_EXECUTION=1`。

既有服務名稱、內部目錄、`config/local.json`、`state/` 與登入憑證不因名稱恢復而搬移或覆寫。原有帳號、對話與任務看板繼續使用；不回復舊版程式或舊資料。

## 另開示範

```bash
CANTUS_PANEL_PORT=4593 CANTUS_NEXT_PORT=4594 npm run start:desktop
```

開啟 <http://127.0.0.1:4594>。預設僅有虛構示範，不讀取帳號、不呼叫 AI。舊版與新版須使用獨立狀態目錄，避免同時寫入同一組資料。

GitHub 名稱恢復不重寫提交歷史。專案仍為 `UNLICENSED`；第三方 MIT 元件的授權與來源聲明保持原樣。
