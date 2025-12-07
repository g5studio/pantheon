#!/usr/bin/env node

/**
 * 檢查 .compassignore 中列出的檔案是否存在，移除不存在的檔案
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..', '..');

const COMPASSIGNORE_PATH = join(projectRoot, '.compassignore');

// 檢查 .compassignore 是否存在
if (!existsSync(COMPASSIGNORE_PATH)) {
  console.log('ℹ️  .compassignore 檔案不存在');
  process.exit(0);
}

// 讀取 .compassignore
const content = readFileSync(COMPASSIGNORE_PATH, 'utf-8');
const lines = content.split('\n');

// 解析檔案結構
const sections = {};
let currentSection = null;

for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) {
    currentSection = trimmed;
    if (!sections[currentSection]) {
      sections[currentSection] = [];
    }
  } else if (trimmed && currentSection) {
    sections[currentSection].push(trimmed);
  }
}

// 檢查每個檔案是否存在
const missingFiles = [];
const existingFiles = {};

for (const [section, files] of Object.entries(sections)) {
  existingFiles[section] = [];
  for (const file of files) {
    const fullPath = join(projectRoot, file);
    if (existsSync(fullPath)) {
      existingFiles[section].push(file);
    } else {
      missingFiles.push({ section, path: file });
      console.log(`❌ 檔案不存在: ${file}`);
    }
  }
}

if (missingFiles.length === 0) {
  console.log('✅ 所有檔案都存在，無需更新 .compassignore');
  process.exit(0);
}

console.log(`\n發現 ${missingFiles.length} 個不存在的檔案，將從 .compassignore 中移除...`);

// 更新 sections
for (const [section, files] of Object.entries(sections)) {
  sections[section] = existingFiles[section];
}

// 格式化並寫回
const sectionOrder = [
  '# 開發工具腳本（打包時不會使用）',
  '# Cursor 指令檔案',
  '# Cursor 規則檔案',
  '# 工具設定檔案',
  '# 文檔檔案',
  '# 環境變數檔案',
];

const newLines = [];
for (const section of sectionOrder) {
  if (sections[section] && sections[section].length > 0) {
    newLines.push(section);
    const sortedFiles = sections[section].sort();
    for (const file of sortedFiles) {
      newLines.push(file);
    }
    newLines.push('');
  }
}

// 輸出其他未定義順序的區段
for (const [section, files] of Object.entries(sections)) {
  if (!sectionOrder.includes(section) && files.length > 0) {
    newLines.push(section);
    const sortedFiles = files.sort();
    for (const file of sortedFiles) {
      newLines.push(file);
    }
    newLines.push('');
  }
}

const newContent = newLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
writeFileSync(COMPASSIGNORE_PATH, newContent, 'utf-8');
console.log('✅ .compassignore 已更新');
console.log(`\n已移除以下 ${missingFiles.length} 個不存在的檔案:`);
for (const { path } of missingFiles) {
  console.log(`  - ${path}`);
}

