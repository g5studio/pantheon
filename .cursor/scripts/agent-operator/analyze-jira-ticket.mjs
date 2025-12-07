#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const projectRoot = process.cwd();

function loadEnvLocal() {
  const envLocalPath = join(projectRoot, '.env.local');
  if (!existsSync(envLocalPath)) {
    return {};
  }
  const envContent = readFileSync(envLocalPath, 'utf-8');
  const env = {};
  envContent.split('\n').forEach((line) => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  });
  return env;
}

function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.text) return item.text;
        if (item?.content) return extractTextFromContent(item.content);
        return '';
      })
      .join('\n');
  }
  if (content?.text) return content.text;
  if (content?.content) return extractTextFromContent(content.content);
  return '';
}

function checkRDSuggestions(description, comments) {
  const suggestions = [];
  
  if (description) {
    const descText = typeof description === 'string' ? description : extractTextFromContent(description);
    const forAiMatch = descText.match(/for\s+ai\s*[,，:：]?\s*(.+?)(?=\n\n|$)/is);
    if (forAiMatch) {
      suggestions.push({ source: '描述', content: forAiMatch[1].trim() });
    }
    const toAiMatch = descText.match(/to\s+ai\s*[,，:：]?\s*(.+?)(?=\n\n|$)/is);
    if (toAiMatch) {
      suggestions.push({ source: '描述', content: toAiMatch[1].trim() });
    }
  }

  if (comments && comments.comments && Array.isArray(comments.comments)) {
    comments.comments.forEach((comment) => {
      const commentBody = comment.body || '';
      const commentText = typeof commentBody === 'string' ? commentBody : extractTextFromContent(commentBody);
      
      const forAiMatch = commentText.match(/for\s+ai\s*[,，:：]?\s*(.+?)(?=\n\n|$)/is);
      if (forAiMatch) {
        suggestions.push({
          source: `評論（${comment.author?.displayName || '未知'}）`,
          content: forAiMatch[1].trim(),
        });
      }
    });
  }

  return suggestions;
}

const ticket = process.argv[2];
if (!ticket) {
  console.error('請提供 Jira ticket 編號');
  process.exit(1);
}

const envLocal = loadEnvLocal();
const email = process.env.JIRA_EMAIL || envLocal.JIRA_EMAIL;
const apiToken = process.env.JIRA_API_TOKEN || envLocal.JIRA_API_TOKEN;

if (!email || !apiToken) {
  console.error('Jira 配置缺失');
  process.exit(1);
}

const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
const url = `https://innotech.atlassian.net/rest/api/3/issue/${ticket}?expand=renderedFields,comments`;

try {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const data = await response.json();
  const fields = data.fields || {};

  const summary = fields.summary || '無標題';
  const description = fields.description || '';
  const issueType = fields.issuetype?.name || '未知類型';
  const status = fields.status?.name || '未知狀態';
  const assignee = fields.assignee?.displayName || '未分配';
  const priority = fields.priority?.name || '未設置';
  const comments = fields.comment || {};

  const descriptionText = typeof description === 'string' ? description : extractTextFromContent(description);
  const rdSuggestions = checkRDSuggestions(description, comments);

  const result = {
    ticket,
    summary,
    issueType,
    status,
    assignee,
    priority,
    description: descriptionText,
    rdSuggestions,
    comments: comments.comments || [],
  };

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

