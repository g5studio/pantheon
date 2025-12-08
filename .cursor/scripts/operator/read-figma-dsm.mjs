#!/usr/bin/env node

/**
 * 讀取 Figma DSM 數據
 */

import { getFigmaToken } from '../utilities/env-loader.mjs';

const DEFAULT_FIGMA_FILE_ID = 'H8Kn3hrZIWQCevagFC3bd8';
const DEFAULT_FIGMA_NODE_ID = '39245-34247';
const DEFAULT_FIGMA_TOKEN = 'figd_z9ZUQ_BAS7CbE0FuUnCETcTR5OAKCdrCezmU4Okl';

function rgbToHex(r, g, b, a = 1.0) {
  const toHex = (n) => {
    const hex = Math.round(n * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  if (a < 1.0) {
    return `${hex}${toHex(a)}`.toUpperCase();
  }
  return hex;
}

function extractDsmColorsFromFigmaNode(node, pathParts = [], variables = []) {
  const currentName = node?.name || '';
  const currentPath = pathParts.concat(currentName);

  if (currentName.toLowerCase() === 'swatch') {
    let colorValue = null;
    let alpha = 1.0;

    if (node.fills && Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill.type === 'SOLID' && fill.color) {
          const { r, g, b, a = 1.0 } = fill.color;
          alpha = a;
          colorValue = rgbToHex(r, g, b, a);
          break;
        }
      }
    }

    if (!colorValue && node.backgroundColor) {
      const { r, g, b, a = 1.0 } = node.backgroundColor;
      alpha = a;
      colorValue = rgbToHex(r, g, b, a);
    }

    if (colorValue) {
      const parentParts = currentPath
        .slice(0, -1)
        .filter((p) => !['Variable Color Swatches', 'Index', 'token-details'].includes(p));

      if (parentParts.length >= 2) {
        const category = parentParts[0];
        const varName = parentParts.slice(1).join('/');
        variables.push({
          name: `${category}/${varName}`,
          value: colorValue,
          alpha: alpha,
        });
      }
    }
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      extractDsmColorsFromFigmaNode(child, currentPath, variables);
    }
  }

  return variables;
}

async function fetchDsmFromFigma(fileId, nodeId) {
  // 使用 env-loader 取得 Figma token，支援 .env.local 和環境變數
  const token = getFigmaToken(DEFAULT_FIGMA_TOKEN);
  const url = `https://api.figma.com/v1/files/${fileId}/nodes?ids=${nodeId}`;

  console.log(`📡 正在從 Figma 獲取數據...`);

  const response = await fetch(url, {
    headers: { 'X-Figma-Token': token },
  });

  if (!response.ok) {
    throw new Error(`Figma API 請求失敗: ${response.status}`);
  }

  const data = await response.json();
  const nodeKey = nodeId.replace('-', ':');
  const nodeData = data?.nodes?.[nodeKey]?.document;

  if (!nodeData) {
    throw new Error('無法獲取節點數據');
  }

  console.log(`✅ 成功獲取節點: ${nodeData.name || 'N/A'}`);
  return { nodeData, variables: extractDsmColorsFromFigmaNode(nodeData) };
}

async function main() {
  const fileId = process.argv[2] || DEFAULT_FIGMA_FILE_ID;
  const nodeId = process.argv[3] || DEFAULT_FIGMA_NODE_ID;

  console.log('🎨 Figma DSM 數據讀取工具\n');

  try {
    const { variables } = await fetchDsmFromFigma(fileId, nodeId);

    if (variables.length === 0) {
      console.log('⚠️  未找到任何顏色變數');
    } else {
      console.log(`\n📊 找到 ${variables.length} 個顏色變數\n`);
      
      const grouped = {};
      for (const v of variables) {
        const cat = v.name.split('/')[0];
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(v);
      }

      for (const [cat, vars] of Object.entries(grouped).sort()) {
        console.log(`📁 ${cat} (${vars.length} 個):`);
        for (const v of vars.sort((a, b) => a.name.localeCompare(b.name))) {
          console.log(`   • ${v.name}: ${v.value}`);
        }
      }

      if (process.argv.includes('--json')) {
        console.log('\n' + JSON.stringify(variables, null, 2));
      }
    }
  } catch (error) {
    console.error(`\n❌ 錯誤: ${error.message}`);
    process.exit(1);
  }
}

main();

