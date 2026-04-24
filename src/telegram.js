'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(process.cwd(), '.env');

function getConfig() {
  return {
    token: process.env.TG_BOT_TOKEN || '',
    chatId: process.env.TG_CHAT_ID || '',
  };
}

function isEnabled() {
  const { token, chatId } = getConfig();
  return Boolean(token && chatId);
}

async function sendMessage(text) {
  const { token, chatId } = getConfig();
  if (!token || !chatId) return { ok: false, skipped: true };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testConnection(token, chatId) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ <b>Arc Farm</b> connected',
        parse_mode: 'HTML',
      }),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function saveCreds(token, chatId) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) content = fs.readFileSync(ENV_PATH, 'utf8');
  content = upsertLine(content, 'TG_BOT_TOKEN', token);
  content = upsertLine(content, 'TG_CHAT_ID', chatId);
  fs.writeFileSync(ENV_PATH, content);
  process.env.TG_BOT_TOKEN = token;
  process.env.TG_CHAT_ID = chatId;
}

function upsertLine(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  if (content && !content.endsWith('\n')) content += '\n';
  return content + line + '\n';
}

module.exports = { sendMessage, testConnection, saveCreds, isEnabled, getConfig };
