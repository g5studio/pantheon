#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/notification/notify-cursor-rules-failed.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @external https://innotech.atlassian.net/browse/FE-7892
 */

/**
 * 檔案用途區塊
 * @module notify-cursor-rules-failed.mjs
 * @purpose 發送跨平台系統通知，提醒使用者 Cursor rules 檢查未通過（支援 macOS/Windows，其他系統僅輸出到控制台）。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */

import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { platform } from "os";
import { writeFileSync, unlinkSync, existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 宣告內容用途說明與單號關聯
 * @description 提供對外入口，針對「Cursor rules 檢查未通過」場景發送通知。
 * @purpose 將 title/message/mrUrl 轉交給通用通知發送流程。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
export function notifyCursorRulesFailed(title, message, mrUrl = "") {
  sendSystemNotification(title, message, mrUrl);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 通用通知發送器，依作業系統選擇 macOS/Windows/to console 的策略。
 * @purpose 封裝平台分支並統一輸入參數（url 為可選）。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
export function sendSystemNotification(title, message, url = "") {
  const osPlatform = platform();

  if (osPlatform === "darwin") {
    // macOS
    notifyMacOS(title, message, url);
  } else if (osPlatform === "win32") {
    // Windows
    notifyWindows(title, message, url);
  } else {
    // Linux 或其他系統，只輸出訊息
    console.log(`\n📢 ${title}`);
    console.log(`訊息: ${message}`);
    if (url) {
      console.log(`🔗 連結: ${url}\n`);
    }
  }
}

/**
 * macOS 系統通知
 * 注意：macOS 原生通知不支持點擊回調，無法實現點擊切換功能
 * 注意：此腳本在 Cursor sandbox 環境中執行時，osascript 可能被限制
 *       AI 在調用此腳本時應使用 required_permissions: ["all"] 來繞過 sandbox 限制
 */
function notifyMacOS(title, message, url = "") {
  const escapedMessage = message.replace(/"/g, '\\"').replace(/\n/g, " ");
  const escapedTitle = title.replace(/"/g, '\\"');

  // 使用 macOS 原生通知
  // 注意：macOS 原生通知不支持點擊回調，無法實現點擊切換功能
  // 注意：通知由系統發送，不依賴 Cursor 應用的通知權限
  // 注意：macOS 原生通知會使用發送通知的應用程序圖標（通常是終端機或腳本執行環境）
  // 要使用 Cursor 圖標，可以通過讓 Cursor 應用發送通知，但這需要 Cursor 應用支持
  const notifyScript = `
    tell application "System Events"
      display notification "${escapedMessage}" with title "${escapedTitle}" subtitle "請返回 Cursor 修正問題"
    end tell
  `;

  // 發送通知（同步執行以捕獲錯誤）
  try {
    execSync(`osascript -e '${notifyScript.replace(/'/g, "'\\''")}'`, {
      stdio: "pipe",
      timeout: 5000,
    });
    console.log(`\n📢 已發送系統通知: ${title}`);
    if (url) {
      console.log(`🔗 連結: ${url}\n`);
    }
  } catch (execError) {
    // 同步執行失敗，輸出警告訊息
    // 注意：不再使用異步 fallback，因為無法驗證是否成功
    console.error(`\n⚠️  發送通知失敗: ${execError.message}`);
    console.log(`\n💡 提示: 如果未看到系統通知，請檢查：`);
    console.log(`   1. 系統偏好設置 > 通知與專注模式 > 確保通知已開啟`);
    console.log(
      `   2. 系統偏好設置 > 安全性與隱私權 > 輔助使用 > 確保終端機或 Cursor 有權限`,
    );
    console.log(`   3. 通知可能被「請勿打擾」模式或專注模式阻擋`);
    console.log(
      `   4. 如果是 Cursor AI 執行此腳本，請確保使用 required_permissions: ["all"]`,
    );
    console.log(`\n📢 ${title}`);
    console.log(`訊息: ${message}`);
    if (url) {
      console.log(`🔗 連結: ${url}\n`);
    }
  }
}

/**
 * Windows 系統通知
 * 注意：通知不包含任何 action 按鈕，僅用於顯示訊息
 */
function notifyWindows(title, message, url = "") {
  try {
    // 轉義 XML 特殊字符
    const escapeXml = (str) => {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/\n/g, " ");
    };

    const escapedTitle = escapeXml(title);
    const escapedMessage = escapeXml(message);
    const escapedUrl = url ? escapeXml(url) : "";

    // 構建通知內容
    let notificationBody = escapedMessage;
    if (escapedUrl) {
      notificationBody += `\\n\\n連結: ${escapedUrl}`;
    }

    // 使用 PowerShell 發送 Windows Toast 通知（無 action 按鈕）
    // 嘗試獲取 Cursor 應用圖標路徑（在 JavaScript 中）
    let cursorIconPath = "";
    const possibleIconPaths = [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\cursor\\resources\\app\\assets\\icon.ico`,
      `${process.env.ProgramFiles || ""}\\Cursor\\resources\\app\\assets\\icon.ico`,
      `${process.env["ProgramFiles(x86)"] || ""}\\Cursor\\resources\\app\\assets\\icon.ico`,
      `${process.env.APPDATA || ""}\\Cursor\\resources\\app\\assets\\icon.ico`,
    ];
    for (const iconPath of possibleIconPaths) {
      if (iconPath && existsSync(iconPath)) {
        cursorIconPath = iconPath.replace(/\\/g, "/");
        break;
      }
    }

    const powershellScript = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
      
      $title = '${escapedTitle.replace(/'/g, "''")}'
      $body = '${notificationBody.replace(/'/g, "''")}'
      $iconPath = '${cursorIconPath.replace(/'/g, "''")}'
      
      # 構建 Toast XML，如果找到圖標則添加
      if ($iconPath -and (Test-Path $iconPath)) {
        $iconPathEscaped = $iconPath.Replace('\', '/')
        $template = @"
      <toast>
        <visual>
          <binding template="ToastGeneric">
            <text>$title</text>
            <text>$body</text>
            <image placement="appLogoOverride" src="file:///$iconPathEscaped"/>
          </binding>
        </visual>
      </toast>
"@
      } else {
        $template = @"
      <toast>
        <visual>
          <binding template="ToastGeneric">
            <text>$title</text>
            <text>$body</text>
          </binding>
        </visual>
      </toast>
"@
      }
      
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      $toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(5)
      
      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Cursor Rules Check")
      $notifier.Show($toast)
    `;

    // 執行 PowerShell 腳本（異步執行）
    spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        powershellScript,
      ],
      {
        detached: true,
        stdio: "ignore",
        shell: true,
      },
    ).unref();

    console.log(`\n📢 已發送系統通知: ${title}`);
    if (url) {
      console.log(`🔗 連結: ${url}\n`);
    }
  } catch (error) {
    // 如果 PowerShell 通知失敗，嘗試使用簡單的 msg 命令（Windows 7+）
    try {
      const simpleMessage = `${title}\n${message}${url ? `\n\n連結: ${url}` : ""}`;
      execSync(`msg %username% "${simpleMessage.replace(/"/g, '\\"')}"`, {
        stdio: "ignore",
        shell: true,
      });
      console.log(`\n📢 已發送系統通知: ${title}`);
      if (url) {
        console.log(`🔗 連結: ${url}\n`);
      }
    } catch (fallbackError) {
      // 如果所有通知方法都失敗，至少輸出錯誤訊息
      console.error(`\n⚠️  發送通知失敗: ${error.message}`);
      console.log(`\n📢 ${title}`);
      console.log(`訊息: ${message}`);
      if (url) {
        console.log(`🔗 連結: ${url}\n`);
      }
    }
  }
}

// 如果直接執行此腳本
if (import.meta.url === `file://${process.argv[1]}`) {
  const title = process.argv[2] || "Cursor Rules 檢查未通過";
  const message = process.argv[3] || "請返回 Cursor 修正問題";
  const mrUrl = process.argv[4] || "";

  notifyCursorRulesFailed(title, message, mrUrl);
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model gpt-4.1
 * @llm-review-note 依需求僅調整注釋並套用三段式註解格式；不變更任何執行邏輯。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T17:33:18.845Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 重構此檔案注釋為三區塊格式，並在宣告函式處補上對應 FE-7893 單號的 @external 標記；新增 llm 分析紀錄區；不修改任何程式邏輯。
 */
