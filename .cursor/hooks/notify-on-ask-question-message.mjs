/**
 * 檔案用途區塊
 * @module notify-on-ask-question-message
 * @purpose 將 AskQuestion tool_input 轉換為 OS 通知正文
 */

const MAX_MESSAGE_LENGTH = 220;
const MAX_PROMPT_LENGTH = 140;
const MAX_OPTION_LABELS = 5;

/**
 * 宣告內容用途說明與單號關聯
 * @description 從多行 prompt 擷取第一行有意義文字，去除 markdown 標記。
 * @purpose 濃縮 Answer 視窗問題供 OS 通知顯示。
 */
function extractPromptSummary(prompt) {
  if (typeof prompt !== "string") return "";

  const lines = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-|*#_`>]+$/.test(line))
    .filter((line) => line !== "---");

  const first = lines[0] || "";
  return first
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/\[(.+?)\]\([^)]+\)/g, "$1")
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 將 AskQuestion tool_input 轉成 OS 通知正文。
 * @purpose 讓用戶不需回 chat 也能知道目前 pending 的問題與選項。
 */
export function buildAskQuestionNotificationMessage(toolInput = {}) {
  const parts = [];
  const formTitle =
    typeof toolInput.title === "string" ? toolInput.title.trim() : "";
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];

  if (formTitle) {
    parts.push(formTitle);
  }

  for (const [index, question] of questions.entries()) {
    if (index >= 2) break;

    const promptSummary = extractPromptSummary(question?.prompt);
    if (promptSummary) {
      parts.push(promptSummary);
    }

    const optionLabels = (Array.isArray(question?.options) ? question.options : [])
      .map((option) =>
        typeof option?.label === "string" ? option.label.trim() : "",
      )
      .filter(Boolean)
      .slice(0, MAX_OPTION_LABELS);

    if (optionLabels.length > 0) {
      parts.push(`選項：${optionLabels.join(" / ")}`);
    }
  }

  if (questions.length > 2) {
    parts.push(`（另有 ${questions.length - 2} 題）`);
  }

  const message = parts.filter(Boolean).join(" — ");
  if (!message) {
    return "Answer 視窗等待你的選擇";
  }

  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-23T00:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note 抽出訊息組裝邏輯，供 hook 與 pending scheduler 共用。
 */
