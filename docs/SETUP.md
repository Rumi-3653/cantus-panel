# 設定自己的工作區

## 預設：示範模式

`npm start` 只監聽 `127.0.0.1:4589`。請使用這個位址，不要改成 `localhost`，因為服務會驗證 Host 與 Origin。

示範資料寫在 `demo.cjs`，沒有從真實帳號匯出。不要直接把未登入保護的面板轉送到公開網路。

## 來源閱讀

複製 `config/local.example.json` 到 `config/local.json`。後者已排除版本追蹤。

| 設定 | 用途 |
| --- | --- |
| `codexHome` | 自己的 Codex 設定、索引與 session 根目錄 |
| `claudeConfig` | 自己的 Claude CLI 設定目錄，對話位於其 `projects` 子目錄 |
| `claudeDesktop` | 自己的 Claude Desktop 資料目錄 |
| `codexBin` / `claudeBin` | 自行安裝的 CLI 執行檔絕對路徑 |
| `workRoot` | 模型清單查詢時的工作目錄 |
| `storageGuard` | 選填的本機檢查程式；成功時須輸出 `STATUS=OK` |

只保留已確認的設定；未設定的來源會指向空的保留位置，不會自動掃描你的家目錄。所有路徑必須是絕對路徑。設定檔不需要、也不應填入密碼或 API key。

```bash
CANTUS_MODE=local npm start
```

這會讀取已設定來源，但不允許建立或送出 AI 回合。Lineage 與路由設定仍可寫入面板自己的 `state/`，不是全站唯讀。

若要連面板設定也禁止修改：

```bash
CANTUS_MODE=local CANTUS_PANEL_READ_ONLY=1 npm start
```

## 選用：啟用 AI 執行

先在原 CLI 完成自己的登入，確認版本相容與資料備份，再明確啟用：

```bash
CANTUS_MODE=local CANTUS_ENABLE_EXECUTION=1 npm start
```

AI 執行會使用你的帳號與配額，可能執行工具。原生批准流程保留，分享版不啟用完整權限。不要在原 App 與面板同時對同一段對話送出訊息。

面板新建對話、派送收據、路由與工作關係位於 `state/`。跨提供者的切換是保留各自原生對話並傳遞上下文，不是讓兩個產品共用同一個原生 session。

## 選用：有登入保護的入口

這個分享版只有一個本機後端。沒有 SSH、隧道、主機清單、既有網域或部署帳號。公開部署需要自行準備 HTTPS 反向代理，並只允許它連到 loopback 的入口服務。

建立帳號時，`cloud/create-user.cjs` 從標準輸入讀取 JSON：`user`、`password`、選填 `role`。密碼需至少 20 字，角色為 `editor` 或 `viewer`。請從自己的密碼管理工具安全地提供輸入，不要把密碼放進命令列、shell 歷史或 repo。

啟動面板後，另開一個終端機啟動入口：

```bash
CANTUS_PUBLIC_HOST=panel.example.test npm run start:gateway
```

`panel.example.test` 是文件範例，必須換成自己已設定 HTTPS 的主機名稱。預設入口只監聽 `127.0.0.1:4588`；`CANTUS_GATEWAY_PORT` 可修改入口埠。入口與面板的 `CANTUS_PANEL_PORT` 必須一致。

入口使用 Secure、HttpOnly、SameSite=Strict cookie、同源檢查與寫入令牌；純 HTTP 瀏覽器無法正常持有登入 cookie。帳號雜湊與登入狀態放在 `state/gateway/`，不會加入 Git。這不是多租戶隔離系統：可登入的人會看到同一個已設定的工作區。

新部署仍需自行確認 TLS、反向代理、帳號管理、備份、網路限制與實際 CLI 相容性；本 repo 沒有替你完成這些項目。

登入入口只顯示「登出工作區」，不另設第二個登出選單。分享版只有一層登入，按下後會回到登入頁；不包含私人部署的雙層入口登入。直接使用本機示範模式時，沒有登入狀態，也不顯示登出按鈕。
