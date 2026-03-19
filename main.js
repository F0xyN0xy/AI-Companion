const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { autoUpdater } = require('electron-updater');

// Load .env from app root (works both in dev and when packaged)
const dotenvPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '.env');
require('dotenv').config({ path: dotenvPath });

let mainWindow;
let rpcClient = null;
let rpcConnected = false;
let rpcStartTime = null;
let verifyServer = null;

// Safe send — guards against sending to a destroyed window
function safeSend(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  } catch (e) { }
}

// ─── Credentials (all loaded from .env) ──────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ─── JSONBin config ───────────────────────────────────────────────────────────
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// ─── Gmail config ─────────────────────────────────────────────────────────────
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASSWORD;

// ─── Local verify server port ─────────────────────────────────────────────────
const VERIFY_PORT = 3322;

// ─── Base dir ─────────────────────────────────────────────────────────────────
const BASE_DIR = path.join(os.homedir(), '.ai-companion');
const SESSION_FILE = path.join(BASE_DIR, 'session.json');

function ensureBase() {
  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
}

// ─── Session ──────────────────────────────────────────────────────────────────
function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      jwt.verify(s.token, JWT_SECRET);
      return s;
    }
  } catch (e) { }
  return null;
}

function saveSession(session) {
  ensureBase();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function clearSession() {
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch (e) { }
}

// ─── Per-user data paths ──────────────────────────────────────────────────────
function getUserDir(email) {
  const safe = email.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return path.join(BASE_DIR, 'users', safe);
}

function ensureDirs(userDir) {
  [userDir, path.join(userDir, 'assets'), path.join(userDir, 'chats')].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ─── JSONBin helpers ──────────────────────────────────────────────────────────
async function jsonbinRead() {
  const res = await fetch(JSONBIN_URL + '/latest', {
    headers: { 'X-Master-Key': JSONBIN_API_KEY },
  });
  if (!res.ok) throw new Error('JSONBin read failed: ' + res.status);
  const json = await res.json();
  return json.record || {};
}

async function jsonbinWrite(data) {
  const res = await fetch(JSONBIN_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_API_KEY },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('JSONBin write failed: ' + res.status);
}

// Read users array, apply mutator fn, write back
async function withUsers(fn) {
  const db = await jsonbinRead();
  const users = db.users || [];
  const result = await fn(users);
  await jsonbinWrite({ ...db, users });
  return result;
}

// ─── Email ────────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS },
  });
}

async function sendVerificationEmail(email, firstName, token) {
  const link = `http://localhost:${VERIFY_PORT}/verify?token=${token}`;
  await createTransport().sendMail({
    from: `"AI Companion" <${GMAIL_USER}>`,
    to: email,
    subject: 'Confirm your email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="margin-bottom:8px">Hey ${firstName} 👋</h2>
        <p style="color:#555;line-height:1.6">
          Thanks for signing up! Click below to confirm your email.
          This link expires in 24 hours and only works while the app is open.
        </p>
        <a href="${link}"
           style="display:inline-block;margin-top:24px;padding:12px 24px;
                  background:#1a1a2e;color:#fff;border-radius:8px;
                  text-decoration:none;font-weight:600">
          Confirm my email
        </a>
        <p style="margin-top:24px;font-size:12px;color:#999">
          Or paste in your browser: ${link}
        </p>
      </div>
    `,
  });
}

// ─── Local verify HTTP server ─────────────────────────────────────────────────
function startVerifyServer() {
  if (verifyServer) return;

  verifyServer = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://localhost:${VERIFY_PORT}`);

    if (parsed.pathname !== '/verify') {
      res.writeHead(404); res.end('Not found'); return;
    }

    const token = parsed.searchParams.get('token');
    if (!token) {
      res.writeHead(400); res.end('Missing token'); return;
    }

    try {
      const db = await jsonbinRead();
      const users = db.users || [];
      const idx = users.findIndex(u => u.verifyToken === token);

      if (idx === -1) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(verifyPage('❌ Invalid Link', 'This verification link is invalid or already used.', false));
        return;
      }

      const user = users[idx];

      if (new Date(user.verifyExpires) < new Date()) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(verifyPage('⏰ Link Expired', 'This link has expired. Please register again.', false));
        return;
      }

      // Mark verified
      users[idx] = { ...user, verified: true, verifyToken: null, verifyExpires: null };
      await jsonbinWrite({ ...db, users });

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(verifyPage('✅ Email Verified!', `Welcome, ${user.firstName}! You can now close this tab and sign in.`, true));

      // Notify renderer to stop polling and show success
      safeSend('email-verified', { email: user.email });

    } catch (e) {
      res.writeHead(500); res.end('Server error: ' + e.message);
    }
  });

  verifyServer.listen(VERIFY_PORT);
}

function verifyPage(title, message, success) {
  const color = success ? '#1a5c2e' : '#8b0000';
  return `<!DOCTYPE html><html><head><title>${title}</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
    height:100vh;margin:0;background:#f9f9f9}
    .box{text-align:center;padding:40px;background:#fff;border-radius:12px;
    box-shadow:0 2px 20px rgba(0,0,0,.08);max-width:400px}
    h1{color:${color};font-size:24px}p{color:#555;line-height:1.6}</style>
    </head><body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

// ─── IPC — auth ───────────────────────────────────────────────────────────────
ipcMain.handle('auth-get-session', () => {
  const s = loadSession();
  if (!s) return null;
  return { ...s, userDir: getUserDir(s.user.email) };
});

ipcMain.handle('auth-register', async (_, { email, password, firstName }) => {
  try {
    const db = await jsonbinRead();
    const users = db.users || [];

    // Check duplicate
    if (users.find(u => u.email === email.toLowerCase()))
      return { success: false, error: 'An account with that email already exists.' };

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    users.push({
      id: crypto.randomUUID(),
      email: email.toLowerCase(),
      firstName,
      passwordHash,
      verified: false,
      verifyToken,
      verifyExpires,
      createdAt: new Date().toISOString(),
    });

    await jsonbinWrite({ ...db, users });
    await sendVerificationEmail(email, firstName, verifyToken);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth-login', async (_, { email, password }) => {
  try {
    const db = await jsonbinRead();
    const users = db.users || [];
    const user = users.find(u => u.email === email.toLowerCase());

    if (!user) return { success: false, error: 'Invalid email or password' };

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return { success: false, error: 'Invalid email or password' };

    if (!user.verified)
      return { success: false, error: 'unverified', message: 'Please verify your email before signing in.' };

    const token = jwt.sign(
      { userId: user.id, email: user.email, firstName: user.firstName },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const userData = { email: user.email, firstName: user.firstName };
    saveSession({ token, user: userData });

    const userDir = getUserDir(user.email);
    const saved = loadData(userDir);
    // Small delay so Discord doesn't reject if previous session just closed
    setTimeout(() => {
      initDiscordRPC(saved?.companion?.name || 'Nova', saved?.mood || 'neutral');
    }, 2000);

    // Navigate to main app
    mainWindow?.loadFile('index.html');

    return { success: true, user: userData, userDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth-check-verified', async (_, { email }) => {
  try {
    const db = await jsonbinRead();
    const users = db.users || [];
    const user = users.find(u => u.email === email.toLowerCase());
    return !!user?.verified;
  } catch (e) { return false; }
});

ipcMain.handle('auth-logout', () => {
  clearSession();
  mainWindow?.loadFile('login.html');
  if (rpcClient) try { rpcClient.destroy(); } catch (e) { }
  rpcClient = null; rpcConnected = false;
});

// ─── Data ─────────────────────────────────────────────────────────────────────
function loadData(userDir) {
  try {
    ensureDirs(userDir);
    const f = path.join(userDir, 'data.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { }
  return {
    companion: { name: 'Nova', personality: 'friendly', customPersonality: '', avatar: '🌟', avatarType: 'emoji', color: '#7c6af7' },
    relationship: { xp: 0, label: 'Strangers', messageCount: 0 },
    mood: 'neutral',
    memory: [],
    modelId: 'llama-groq',
    activeChatId: null,
  };
}

function saveData(userDir, data) {
  try { ensureDirs(userDir); fs.writeFileSync(path.join(userDir, 'data.json'), JSON.stringify(data, null, 2)); } catch (e) { }
}

function listChats(userDir) {
  ensureDirs(userDir);
  try {
    return fs.readdirSync(path.join(userDir, 'chats'))
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(userDir, 'chats', f), 'utf8'));
          return { id: d.id, name: d.name, createdAt: d.createdAt, messageCount: (d.messages || []).length, lastMessage: d.lastMessage || '' };
        } catch (e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (e) { return []; }
}

function loadChat(userDir, id) {
  try {
    const f = path.join(userDir, 'chats', id + '.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { }
  return null;
}

function saveChat(userDir, chat) {
  ensureDirs(userDir);
  try { fs.writeFileSync(path.join(userDir, 'chats', chat.id + '.json'), JSON.stringify(chat, null, 2)); } catch (e) { }
}

function deleteChat(userDir, id) {
  try { const f = path.join(userDir, 'chats', id + '.json'); if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { }
}

async function pickAndSaveAsset(userDir, type) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const src = result.filePaths[0];
  const ext = path.extname(src);
  const dest = path.join(userDir, 'assets', type + ext);
  ensureDirs(userDir);
  fs.copyFileSync(src, dest);
  const data = fs.readFileSync(dest);
  const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return 'data:' + mime + ';base64,' + data.toString('base64');
}

function loadAsset(userDir, type) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp']) {
    const f = path.join(userDir, 'assets', type + ext);
    if (fs.existsSync(f)) {
      const data = fs.readFileSync(f);
      const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      return 'data:' + mime + ';base64,' + data.toString('base64');
    }
  }
  return null;
}

// ─── IPC — data ───────────────────────────────────────────────────────────────
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('load-data', (_, ud) => loadData(ud));
ipcMain.handle('save-data', (_, ud, d) => { saveData(ud, d); return true; });
ipcMain.handle('get-data-path', (_, ud) => ud);
ipcMain.handle('list-chats', (_, ud) => listChats(ud));
ipcMain.handle('load-chat', (_, ud, id) => loadChat(ud, id));
ipcMain.handle('save-chat', (_, ud, chat) => { saveChat(ud, chat); return true; });
ipcMain.handle('delete-chat', (_, ud, id) => { deleteChat(ud, id); return true; });
ipcMain.handle('pick-asset', async (_, ud, type) => pickAndSaveAsset(ud, type));
ipcMain.handle('load-asset', (_, ud, type) => loadAsset(ud, type));

// ─── Discord RPC ──────────────────────────────────────────────────────────────
let DiscordRPC;
try { DiscordRPC = require('discord-rpc'); } catch (e) { }

async function initDiscordRPC(companionName, mood) {
  if (!DiscordRPC) return;
  try {
    if (rpcClient) { try { await rpcClient.destroy(); } catch (e) { } rpcClient = null; rpcConnected = false; }
    DiscordRPC.register(DISCORD_CLIENT_ID);
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' });
    rpcClient.on('ready', () => {
      rpcConnected = true; rpcStartTime = new Date();
      setActivity(companionName, mood);
      safeSend('rpc-status', { connected: true });
    });
    rpcClient.on('disconnected', () => {
      rpcConnected = false;
      safeSend('rpc-status', { connected: false });
    });
    await rpcClient.login({ clientId: DISCORD_CLIENT_ID });
  } catch (e) {
    rpcConnected = false;
    safeSend('rpc-status', { connected: false, error: e.message });
  }
}

function setActivity(companionName, mood) {
  if (!rpcClient || !rpcConnected) return;
  const moodLabels = { happy: 'happy 😊', sad: 'sad 😢', excited: 'excited 🎉', curious: 'curious 🤔', neutral: 'neutral 😐', playful: 'playful 😄', thoughtful: 'thoughtful 💭', loving: 'loving 💕' };
  try {
    rpcClient.setActivity({
      details: `Chatting with ${companionName}`, state: `Feeling ${moodLabels[mood] || 'neutral 😐'}`,
      largeImageKey: 'companion', largeImageText: companionName,
      smallImageKey: 'heart', smallImageText: 'AI Companion',
      startTimestamp: rpcStartTime, instance: false,
    });
  } catch (e) { }
}

ipcMain.handle('init-rpc', async (_, { companionName, mood }) => { await initDiscordRPC(companionName, mood); return rpcConnected; });
ipcMain.handle('update-rpc-mood', (_, { companionName, mood }) => { setActivity(companionName, mood); return true; });

// ─── AI ───────────────────────────────────────────────────────────────────────
ipcMain.handle('call-ai', async (_, { provider, model, messages, systemPrompt }) => {
  try {
    let response;
    if (provider === 'groq') {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: model || 'llama-3.3-70b-versatile', max_tokens: 1024, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
      });
    } else {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'HTTP-Referer': 'https://ai-companion-app', 'X-Title': 'AI Companion' },
        body: JSON.stringify({ model: model || 'stepfun/step-3.5-flash:free', max_tokens: 1024, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
      });
    }
    if (!response.ok) { const e = await response.json(); throw new Error(e.error?.message || response.status); }
    const data = await response.json();
    return { success: true, content: data.choices[0].message.content };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('stream-ai', async (_, { provider, model, messages, systemPrompt }) => {
  try {
    const body = JSON.stringify({
      model: provider === 'groq' ? (model || 'llama-3.3-70b-versatile') : (model || 'stepfun/step-3.5-flash:free'),
      max_tokens: 1024, stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    });
    let response;
    if (provider === 'groq') {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` }, body,
      });
    } else {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'HTTP-Referer': 'https://ai-companion-app', 'X-Title': 'AI Companion' },
        body,
      });
    }
    if (!response.ok) {
      const e = await response.json();
      safeSend('ai-stream-error', e.error?.message || String(response.status));
      return { success: false };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]') continue;
        if (!t.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(t.slice(6));
          const token = json.choices?.[0]?.delta?.content;
          if (token) safeSend('ai-token', token);
        } catch (e) { }
      }
    }
    safeSend('ai-stream-done');
    return { success: true };
  } catch (e) {
    safeSend('ai-stream-error', e.message);
    return { success: false, error: e.message };
  }
});

// ─── Window ───────────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920, height: 680, minWidth: 800, minHeight: 580,
    frame: false, backgroundColor: '#0b0b12',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });

  const session = loadSession();
  if (session) {
    mainWindow.loadFile('index.html');
    const saved = loadData(getUserDir(session.user.email));
    // Delay RPC init by 3s — gives Discord time to clean up any previous connection
    setTimeout(() => {
      initDiscordRPC(saved?.companion?.name || 'Nova', saved?.mood || 'neutral');
    }, 3000);
  } else {
    mainWindow.loadFile('login.html');
  }
}

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

app.whenReady().then(() => {
  startVerifyServer();
  createWindow();

  // Auto-update — checks GitHub releases silently, prompts user when one is ready
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', () => {
    safeSend('update-status', { status: 'downloading' });
  });

  autoUpdater.on('update-downloaded', () => {
    // Notify renderer so it can show an "Update ready" banner
    safeSend('update-status', { status: 'ready' });
  });

  autoUpdater.on('error', (err) => {
    console.log('Update error:', err.message);
  });

  // Check for updates 3 seconds after launch, then every 2 hours
  setTimeout(() => autoUpdater.checkForUpdates(), 3000);
  setInterval(() => autoUpdater.checkForUpdates(), 2 * 60 * 60 * 1000);
});

app.on('window-all-closed', async () => {
  if (verifyServer) verifyServer.close();
  if (rpcClient) {
    try {
      await rpcClient.clearActivity();
      await rpcClient.destroy();
    } catch (e) { }
    rpcClient = null;
    rpcConnected = false;
  }
  // Small wait so Discord fully registers the disconnect before process exits
  setTimeout(() => app.quit(), 500);
});
