#!/usr/bin/env node

/**
 * 自動將開發工具相關檔案添加到 .compassignore
 * 用於確保與產品打包無關的檔案不會被包含在構建中
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..', '..');

const COMPASSIGNORE_PATH = join(projectRoot, '.compassignore');

// 定義應該添加到 .compassignore 的檔案模式
const PATTERNS = {
  scripts: /^scripts\/.*\.(mjs|js|py|sh|ts)$/,
  cursorCommands: /^\.cursor\/commands\/.*\.md$/,
  cursorRules: /^\.cursor\/rules\/.*\.mdc$/,
  eslintConfig: /^\.eslintrc(\.js|\.json|\.yml)?$|^eslint\.config\.js$/,
  prettierConfig: /^\.prettierrc(\.js|\.json|\.yml|\.yaml)?$/,
  commitlintConfig: /^(commitlint|\.commitlintrc)\.config\.(js|json)$/,
  huskyConfig: /^\.husky\/.*$/,
  lintStagedConfig: /^\.lintstagedrc(\.js|\.json)?$/,
  storybookConfig: /^\.storybook\/.*$/,
  docs: /^docs\/.*$/,
  scriptsReadme: /^scripts\/README-.*\.md$/,
  viteConfig: /^vite\.config\.(mts|ts|js)$/,
  tailwindConfig: /^tailwind\.config\.(ts|js)$/,
  postcssConfig: /^postcss\.config\.(js|json)$/,
  vitestConfig: /^vitest\.config\.(ts|js)$/,
  tsconfig: /^tsconfig\.json$/,
};

// 定義檔案類型對應的區段
const SECTION_MAP = {
  scripts: '# 開發工具腳本（打包時不會使用）',
  scriptsReadme: '# 文檔檔案',
  cursorCommands: '# Cursor 指令檔案',
  cursorRules: '# Cursor 規則檔案',
  eslintConfig: '# 工具設定檔案',
  prettierConfig: '# 工具設定檔案',
  commitlintConfig: '# 工具設定檔案',
  huskyConfig: '# 工具設定檔案',
  lintStagedConfig: '# 工具設定檔案',
  storybookConfig: '# 工具設定檔案',
  viteConfig: '# 工具設定檔案',
  tailwindConfig: '# 工具設定檔案',
  postcssConfig: '# 工具設定檔案',
  vitestConfig: '# 工具設定檔案',
  tsconfig: '# 工具設定檔案',
  docs: '# 文檔檔案',
};

/**
 * 檢查檔案路徑是否匹配任何模式
 * @param {string} filePath - 相對於項目根目錄的檔案路徑
 * @returns {string|null} - 匹配的模式名稱，如果不匹配則返回 null
 */
function matchPattern(filePath) {
  // 正規化路徑（使用正斜線）
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const [patternName, pattern] of Object.entries(PATTERNS)) {
    if (pattern.test(normalizedPath)) {
      return patternName;
    }
  }
  return null;
}

/**
 * 讀取 .compassignore 檔案內容
 * @returns {string} 檔案內容
 */
function readCompassignore() {
  if (!existsSync(COMPASSIGNORE_PATH)) {
    return '';
  }
  return readFileSync(COMPASSIGNORE_PATH, 'utf-8');
}

/**
 * 解析 .compassignore 檔案，返回結構化數據
 * @param {string} content - 檔案內容
 * @returns {Object} 包含區段和檔案列表的對象
 */
function parseCompassignore(content) {
  const sections = {};
  let currentSection = null;
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // 檢查是否是區段標題
    if (trimmed.startsWith('#')) {
      currentSection = trimmed;
      if (!sections[currentSection]) {
        sections[currentSection] = [];
      }
    } else if (trimmed && currentSection) {
      // 添加到當前區段
      if (!sections[currentSection].includes(trimmed)) {
        sections[currentSection].push(trimmed);
      }
    }
  }

  return sections;
}

/**
 * 將結構化數據轉換回 .compassignore 格式
 * @param {Object} sections - 區段和檔案列表
 * @returns {string} 格式化的檔案內容
 */
function formatCompassignore(sections) {
  const lines = [];

  // 定義區段的順序
  const sectionOrder = [
    '# 開發工具腳本（打包時不會使用）',
    '# Cursor 指令檔案',
    '# Cursor 規則檔案',
    '# 工具設定檔案',
    '# 文檔檔案',
  ];

  // 按順序輸出區段
  for (const section of sectionOrder) {
    if (sections[section] && sections[section].length > 0) {
      lines.push(section);
      // 排序檔案列表
      const sortedFiles = sections[section].sort();
      for (const file of sortedFiles) {
        lines.push(file);
      }
      lines.push(''); // 空行分隔
    }
  }

  // 輸出其他未定義順序的區段
  for (const [section, files] of Object.entries(sections)) {
    if (!sectionOrder.includes(section) && files.length > 0) {
      lines.push(section);
      const sortedFiles = files.sort();
      for (const file of sortedFiles) {
        lines.push(file);
      }
      lines.push('');
    }
  }

  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

/**
 * 添加檔案到 .compassignore
 * @param {string|string[]} filePaths - 要添加的檔案路徑（相對於項目根目錄）
 * @returns {boolean} 是否成功添加
 */
export function addToCompassignore(filePaths) {
  const filesToAdd = Array.isArray(filePaths) ? filePaths : [filePaths];
  const filesToAddMap = new Map(); // 使用 Map 來追蹤每個檔案應該添加到哪個區段

  // 檢查每個檔案是否應該被添加
  for (const filePath of filesToAdd) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const patternName = matchPattern(normalizedPath);

    if (patternName) {
      const section = SECTION_MAP[patternName] || '# 其他檔案';
      if (!filesToAddMap.has(section)) {
        filesToAddMap.set(section, []);
      }
      filesToAddMap.get(section).push(normalizedPath);
    }
  }

  if (filesToAddMap.size === 0) {
    console.log('沒有需要添加到 .compassignore 的檔案');
    return false;
  }

  // 讀取現有的 .compassignore
  const content = readCompassignore();
  const sections = parseCompassignore(content);

  // 添加新檔案到對應區段
  let hasChanges = false;
  for (const [section, files] of filesToAddMap.entries()) {
    if (!sections[section]) {
      sections[section] = [];
    }

    for (const file of files) {
      if (!sections[section].includes(file)) {
        sections[section].push(file);
        hasChanges = true;
        console.log(`✅ 已添加 ${file} 到 .compassignore (${section})`);
      } else {
        console.log(`ℹ️  ${file} 已存在於 .compassignore`);
      }
    }
  }

  if (hasChanges) {
    // 寫回檔案
    const newContent = formatCompassignore(sections);
    writeFileSync(COMPASSIGNORE_PATH, newContent, 'utf-8');
    console.log('\n✅ .compassignore 已更新');
    return true;
  }

  return false;
}

/**
 * 檢查檔案是否應該被添加到 .compassignore
 * @param {string} filePath - 檔案路徑
 * @returns {boolean} 是否應該添加
 */
export function shouldAddToCompassignore(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return matchPattern(normalizedPath) !== null;
}

// 如果直接執行此腳本
if (import.meta.url === `file://${process.argv[1]}`) {
  const filePaths = process.argv.slice(2);

  if (filePaths.length === 0) {
    console.log('用法: node add-to-compassignore.mjs <file1> [file2] ...');
    console.log(
      '範例: node .cursor/scripts/utilities/add-to-compassignore.mjs scripts/new-script.mjs .cursor/rules/new-rule.mdc',
    );
    process.exit(1);
  }

  // 將絕對路徑轉換為相對路徑
  const relativePaths = filePaths.map((filePath) => {
    if (filePath.startsWith(projectRoot)) {
      return relative(projectRoot, filePath);
    }
    return filePath;
  });

  addToCompassignore(relativePaths);
}

