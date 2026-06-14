/**
 * 從多個來源獲取 chat 內容
 * @description 合併多個環境變數中與使用者輸入相關的訊息，作為後續參數偵測的輸入來源。
 * @purpose 與 getChatContent() 相關功能。
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @returns {string} - 合併後的 chat 內容
 */
export function getChatContent() {
  const sources = [
    process.env.CURSOR_CHAT_CONTENT,
    process.env.CHAT_CONTENT,
    process.env.USER_MESSAGE,
    process.env.MESSAGE,
  ];

  return sources.filter(Boolean).join(' ');
}

/**
 * 參數關鍵字映射表
 * @description 定義各參數對應的中英文關鍵字集合，用於從 chat 文字判斷使用者意圖。
 * @purpose 與 shouldSetParameter() 的參數意圖辨識相關。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const PARAMETER_KEYWORDS = {
  // --no-notify: 不要通知
  'no-notify': {
    chinese: [
      '不要通知',
      '不通知',
      '取消通知',
      '跳過通知',
      '禁用通知',
      '關閉通知',
      '停止通知',
      '無需通知',
      '不需要通知',
      '不用通知',
      '別通知',
      '勿通知',
      '免通知',
      '禁止通知',
    ],
    english: [
      'no notify',
      'no notification',
      'skip notify',
      'skip notification',
      'disable notify',
      'disable notification',
      'cancel notify',
      'cancel notification',
      'turn off notify',
      'turn off notification',
      "don't notify",
      "don't notification",
      'without notify',
      'without notification',
      'silent',
      'quiet',
      'mute notification',
      'suppress notification',
      'hide notification',
    ],
  },

  // --no-draft: 不要草稿 / 非草稿狀態
  'no-draft': {
    chinese: [
      '不要草稿',
      '不用草稿',
      '不需要草稿',
      '非草稿',
      '不是草稿',
      '直接提交',
      '正式提交',
      '直接合併',
      '正式合併',
      '不要 draft',
      '不用 draft',
      '不需要 draft',
      '非 draft',
      '不是 draft',
      'ready for review',
      'ready',
    ],
    english: [
      'no draft',
      'not draft',
      'without draft',
      'skip draft',
      'disable draft',
      'direct submit',
      'direct commit',
      'ready for review',
      'ready to merge',
      "don't draft",
      'not a draft',
      'non-draft',
      'final',
      'ready',
    ],
  },

  // --no-review: 不要送審 / 不送審
  'no-review': {
    chinese: [
      '不要送審',
      '不送審',
      '跳過送審',
      '不用送審',
      '不需要送審',
      '別送審',
      '勿送審',
      '免送審',
      '不要審查',
      '不審查',
      '不要 review',
      '不 review',
      '跳過 review',
      '不用 review',
    ],
    english: [
      'no review',
      'no submit review',
      'skip review',
      'skip submit',
      'without review',
      'without submit',
      "don't review",
      "don't submit",
      'no ai review',
      'skip ai review',
      'not for review',
    ],
  },

  // --reviewer: 指定審查者
  reviewer: {
    chinese: [
      'reviewer',
      '審查者',
      '審查人',
      '審核者',
      '給 @',
      '讓 @',
      '請 @',
      '由 @',
      '交給 @',
      '指定 @',
      '設置 @',
      '設置 reviewer',
      '指定 reviewer',
    ],
    english: [
      'reviewer',
      'review by',
      'review from',
      'reviewer is',
      'reviewer:',
      'assign to',
      'assign reviewer',
      'set reviewer',
      'for @',
      'to @',
      'by @',
    ],
  },

  // --target: 目標分支
  target: {
    chinese: [
      '目標分支',
      '合併到',
      '合併至',
      'merge to',
      'target branch',
      'target:',
      '合併到 ',
      '合併至 ',
      '要合併到',
      '要合併至',
      '目標是',
      '目標為',
    ],
    english: [
      'target branch',
      'target:',
      'merge to',
      'merge into',
      'merge target',
      'target is',
      'targeting',
      'to branch',
      'into branch',
    ],
  },

  // --related-tickets: 關聯單號
  'related-tickets': {
    chinese: [
      '關聯單號',
      '相關單號',
      '同時修復',
      '一起修復',
      '同步修復',
      '相關的',
      '關聯的',
      'related tickets',
      'related ticket',
      'related:',
    ],
    english: [
      'related tickets',
      'related ticket',
      'related:',
      'also fixes',
      'also fix',
      'fixes also',
      'related to',
      'related issues',
      'related jira',
      'together with',
      'along with',
    ],
  },

  // --skip-lint: 跳過 lint
  'skip-lint': {
    chinese: [
      '跳過 lint',
      '不用 lint',
      '不需要 lint',
      '不要 lint',
      '不執行 lint',
      '跳過檢查',
      '不用檢查',
      '不需要檢查',
    ],
    english: [
      'skip lint',
      'no lint',
      'without lint',
      'skip check',
      'no check',
      'skip format',
      'no format',
      'skip validation',
    ],
  },

  // --auto-push: 自動推送
  'auto-push': {
    chinese: ['自動推送', '自動 push', '直接推送', '直接 push', '立即推送', '立即 push', '推送', 'push'],
    english: [
      'auto push',
      'auto-push',
      'push automatically',
      'push now',
      'push directly',
      'push immediately',
      'and push',
      'then push',
    ],
  },
};

/**
 * 智能偵測是否要設置某個參數
 * @description 先檢查命令列參數（--${parameterName}），若未命中則以 chatContent + 環境變數內容進行中英文關鍵字比對。
 * @purpose 與解析各參數開關（如 no-notify/no-draft/no-review/skip-lint/auto-push）相關。
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} parameterName - 參數名稱（如 'no-notify', 'no-draft' 等）
 * @param {string[]} args - 命令行參數陣列
 * @param {string} chatContent - Chat 內容（可選）
 * @returns {boolean} - 如果應該設置該參數則返回 true
 */
export function shouldSetParameter(parameterName, args = [], chatContent = '') {
  // 1. 檢查命令行參數（優先級最高）
  const paramFlag = `--${parameterName}`;
  if (args.includes(paramFlag)) {
    return true;
  }

  // 2. 獲取 chat 內容
  const envChatContent = getChatContent();
  const allContent = `${chatContent} ${envChatContent}`.toLowerCase();

  // 3. 獲取該參數的關鍵字列表
  const keywords = PARAMETER_KEYWORDS[parameterName];
  if (!keywords) {
    return false;
  }

  // 4. 合併中英文關鍵字
  const allKeywords = [...keywords.chinese, ...keywords.english];

  // 5. 檢查是否包含任何關鍵字
  const hasKeyword = allKeywords.some((keyword) => allContent.includes(keyword.toLowerCase()));

  return hasKeyword;
}

/**
 * 智能偵測是否要跳過通知（向後兼容）
 * @description 封裝 shouldSetParameter('no-notify')，用於向後相容地判斷是否需要跳過通知。
 * @purpose 與 no-notify 訊息偵測相關。
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string[]} args - 命令行參數陣列
 * @param {string} chatContent - Chat 內容（可選）
 * @returns {boolean} - 如果應該跳過通知則返回 true
 */
export function shouldSkipNotification(args = [], chatContent = '') {
  return shouldSetParameter('no-notify', args, chatContent);
}

/**
 * 從 chat 內容中提取 reviewer 用戶名
 * @description 使用 @username 的模式從 chat 文字中抓取 reviewer，並排除常見非用戶名詞彙（如 main/develop/master 等）。
 * @purpose 與解析 reviewer 參數相關。
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} chatContent - Chat 內容
 * @returns {string|null} - 提取到的 reviewer 用戶名（包含 @ 符號），如果未找到則返回 null
 */
export function extractReviewer(chatContent = '') {
  const allContent = getChatContent() + ' ' + chatContent;

  // 匹配 @username 格式
  const reviewerPattern = /@([a-zA-Z0-9._-]+)/g;
  const matches = [...allContent.matchAll(reviewerPattern)];

  if (matches.length > 0) {
    // 排除常見的非用戶名詞彙
    const excludeList = ['main', 'develop', 'master', 'feature', 'bugfix', 'hotfix', 'release'];
    const reviewers = matches
      .map((match) => match[0])
      .filter((reviewer) => {
        const username = reviewer.replace('@', '');
        return !excludeList.includes(username.toLowerCase());
      });

    if (reviewers.length > 0) {
      return reviewers[0]; // 返回第一個匹配的 reviewer
    }
  }

  return null;
}

/**
 * 從 chat 內容中提取目標分支名稱
 * @description 從文字中比對常見分支名稱（main/master/develop 等），以及 feature/bugfix/hotfix/release 類型的分支格式，提取出最先匹配結果。
 * @purpose 與解析 target 分支參數相關。
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} chatContent - Chat 內容
 * @returns {string|null} - 提取到的分支名稱，如果未找到則返回 null
 */
export function extractTargetBranch(chatContent = '') {
  const allContent = getChatContent() + ' ' + chatContent;

  // 常見分支名稱
  const commonBranches = ['main', 'master', 'develop', 'dev', 'staging', 'production', 'prod'];

  // 匹配分支格式：feature/xxx, bugfix/xxx, hotfix/xxx, release/xxx
  const branchPattern = /(?:feature|bugfix|hotfix|release)\/([a-zA-Z0-9._-]+)/g;
  const branchMatches = [...allContent.matchAll(branchPattern)];

  // 檢查常見分支名稱
  for (const branch of commonBranches) {
    const branchRegex = new RegExp(`\\b${branch}\\b`, 'i');
    if (branchRegex.test(allContent)) {
      return branch;
    }
  }

  // 檢查分支格式
  if (branchMatches.length > 0) {
    return branchMatches[0][0]; // 返回完整的分支名稱
  }

  return null;
}

/**
 * 從 chat 內容中提取關聯單號
 * @description 使用正規表示式抓取類似 FE-1234 的單號字串，並排除 currentTicket 以避免把當前分支的單號也納入關聯結果，最後去重。
 * @purpose 與解析 related-tickets 參數/關聯單號相關。
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} chatContent - Chat 內容
 * @param {string} currentTicket - 當前分支的單號（用於排除）
 * @returns {string[]} - 提取到的單號陣列
 */
export function extractRelatedTickets(chatContent = '', currentTicket = '') {
  const allContent = getChatContent() + ' ' + chatContent;

  // 匹配單號格式：FE-1234, IN-5678 等
  const ticketPattern = /([A-Z0-9]+-[0-9]+)/g;
  const matches = [...allContent.matchAll(ticketPattern)];

  // 提取所有單號並排除當前分支單號
  const tickets = matches
    .map((match) => match[0])
    .filter((ticket) => ticket !== currentTicket)
    .filter((ticket, index, self) => self.indexOf(ticket) === index); // 去重

  return tickets;
}

/**
 * 智能解析所有參數
 * @description 將多個偵測/提取函式的結果組裝成參數物件，包含 no-notify/no-draft/no-review/skip-lint/auto-push、reviewer、target、related-tickets。
 * @purpose 與整合參數解析流程相關。
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string[]} args - 命令行參數陣列
 * @param {string} chatContent - Chat 內容（可選）
 * @param {string} currentTicket - 當前分支的單號（用於提取關聯單號時排除）
 * @returns {Object} - 解析後的參數對象
 */
export function parseAllParameters(args = [], chatContent = '', currentTicket = '') {
  return {
    'no-notify': shouldSetParameter('no-notify', args, chatContent),
    'no-draft': shouldSetParameter('no-draft', args, chatContent),
    'no-review': shouldSetParameter('no-review', args, chatContent),
    'skip-lint': shouldSetParameter('skip-lint', args, chatContent),
    'auto-push': shouldSetParameter('auto-push', args, chatContent),
    reviewer: extractReviewer(chatContent),
    target: extractTargetBranch(chatContent),
    'related-tickets': extractRelatedTickets(chatContent, currentTicket),
  };
}
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:33:14.172Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Refactored file-level and declaration JSDoc comments to match required three-section layout, converted all @external tags to full Jira URLs, deduped/removed duplicate malformed llm analysis blocks, and ensured @external appears only for declarations with matching declarationOrigins tickets.
 */
