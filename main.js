const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const jwt  = require('jsonwebtoken');

let mainWindow;
let rpcClient    = null;
let rpcConnected = false;
let rpcStartTime = null;

// ─── Credentials ──────────────────────────────────────────────────────────────
const GROQ_API_KEY       = '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';
const OPENROUTER_API_KEY = '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';
const DISCORD_CLIENT_ID  = '1482811470801666229';
const SERVER_URL         = 'https://ai-companion-nova.netlify.app';

// !! IMPORTANT — set this to the same value as JWT_SECRET in your Netlify env vars
const JWT_SECRET = 'ai-companion-nova-2026';

// ─── Base dir ─────────────────────────────────────────────────────────────────
const BASE_DIR    = path.join(os.homedir(), '.ai-companion');
const SESSION_FILE = path.join(BASE_DIR, 'session.json');

function ensureBase() {
  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
}

// ─── Session ──────────────────────────────────────────────────────────────────
function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      jwt.verify(s.token, JWT_SECRET); // throws if expired
      return s; // { token, user: { email, firstName } }
    }
  } catch(e) { /* expired or missing */ }
  return null;
}

function saveSession(session) {
  ensureBase();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function clearSession() {
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch(e) {}
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

// ─── Data ────────────────────────────────────────────────────────────────────
function loadData(userDir) {
  try {
    ensureDirs(userDir);
    const f = path.join(userDir, 'data.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch(e) {}
  return {
    companion:    { name:'Nova', personality:'friendly', customPersonality:'', avatar:'🌟', avatarType:'emoji', color:'#7c6af7' },
    relationship: { xp:0, label:'Strangers', messageCount:0 },
    mood:         'neutral',
    memory:       [],
    modelId:      'llama-groq',
    activeChatId: null,
  };
}

function saveData(userDir, data) {
  try { ensureDirs(userDir); fs.writeFileSync(path.join(userDir, 'data.json'), JSON.stringify(data, null, 2)); } catch(e) {}
}

function listChats(userDir) {
  ensureDirs(userDir);
  try {
    return fs.readdirSync(path.join(userDir, 'chats'))
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(userDir, 'chats', f), 'utf8'));
          return { id:d.id, name:d.name, createdAt:d.createdAt, messageCount:(d.messages||[]).length, lastMessage:d.lastMessage||'' };
        } catch(e) { return null; }
      })
      .filter(Boolean)
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch(e) { return []; }
}

function loadChat(userDir, id) {
  try {
    const f = path.join(userDir, 'chats', id + '.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch(e) {}
  return null;
}

function saveChat(userDir, chat) {
  ensureDirs(userDir);
  try { fs.writeFileSync(path.join(userDir, 'chats', chat.id + '.json'), JSON.stringify(chat, null, 2)); } catch(e) {}
}

function deleteChat(userDir, id) {
  try { const f = path.join(userDir, 'chats', id + '.json'); if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {}
}

async function pickAndSaveAsset(userDir, type) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name:'Images', extensions:['png','jpg','jpeg','gif','webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const src  = result.filePaths[0];
  const ext  = path.extname(src);
  const dest = path.join(userDir, 'assets', type + ext);
  ensureDirs(userDir);
  fs.copyFileSync(src, dest);
  const data = fs.readFileSync(dest);
  const mime = ext==='.png'?'image/png':ext==='.gif'?'image/gif':'image/jpeg';
  return 'data:'+mime+';base64,'+data.toString('base64');
}

function loadAsset(userDir, type) {
  for (const ext of ['.png','.jpg','.jpeg','.gif','.webp']) {
    const f = path.join(userDir, 'assets', type + ext);
    if (fs.existsSync(f)) {
      const data = fs.readFileSync(f);
      const mime = ext==='.png'?'image/png':ext==='.gif'?'image/gif':'image/jpeg';
      return 'data:'+mime+';base64,'+data.toString('base64');
    }
  }
  return null;
}

// ─── Discord RPC ──────────────────────────────────────────────────────────────
let DiscordRPC;
try { DiscordRPC = require('discord-rpc'); } catch(e) {}

async function initDiscordRPC(companionName, mood) {
  if (!DiscordRPC) return;
  try {
    if (rpcClient) { try { await rpcClient.destroy(); } catch(e){} rpcClient = null; rpcConnected = false; }
    rpcClient = new DiscordRPC.Client({ transport:'ipc' });
    rpcClient.on('ready', () => {
      rpcConnected = true; rpcStartTime = new Date();
      setActivity(companionName, mood);
      mainWindow?.webContents.send('rpc-status', { connected:true });
    });
    rpcClient.on('disconnected', () => {
      rpcConnected = false;
      mainWindow?.webContents.send('rpc-status', { connected:false });
    });
    await rpcClient.login({ clientId: DISCORD_CLIENT_ID });
  } catch(e) {
    rpcConnected = false;
    mainWindow?.webContents.send('rpc-status', { connected:false, error:e.message });
  }
}

function setActivity(companionName, mood) {
  if (!rpcClient || !rpcConnected) return;
  const moodLabels = { happy:'happy 😊', sad:'sad 😢', excited:'excited 🎉', curious:'curious 🤔', neutral:'neutral 😐', playful:'playful 😄', thoughtful:'thoughtful 💭', loving:'loving 💕' };
  try {
    rpcClient.setActivity({
      details:`Chatting with ${companionName}`, state:`Feeling ${moodLabels[mood]||'neutral 😐'}`,
      largeImageKey:'companion', largeImageText:companionName,
      smallImageKey:'heart', smallImageText:'AI Companion',
      startTimestamp:rpcStartTime, instance:false,
    });
  } catch(e) {}
}

// ─── IPC — auth ───────────────────────────────────────────────────────────────
ipcMain.handle('auth-get-session', () => {
  const s = loadSession();
  if (!s) return null;
  return { ...s, userDir: getUserDir(s.user.email) };
});

ipcMain.handle('auth-login', async (_, { email, password }) => {
  try {
    const res  = await fetch(SERVER_URL + '/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { success:false, error:data.error, code:data.error };
    saveSession({ token:data.token, user:data.user });
    const userDir = getUserDir(data.user.email);
    // Load RPC with saved companion name
    const saved = loadData(userDir);
    initDiscordRPC(saved?.companion?.name || 'Nova', saved?.mood || 'neutral');
    return { success:true, user:data.user, userDir };
  } catch(e) {
    return { success:false, error:'Could not reach server. Check your internet connection.' };
  }
});

ipcMain.handle('auth-register', async (_, { email, password, firstName }) => {
  try {
    const res  = await fetch(SERVER_URL + '/api/register', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password, firstName }),
    });
    const data = await res.json();
    if (!res.ok) return { success:false, error:data.error };
    return { success:true };
  } catch(e) {
    return { success:false, error:'Could not reach server. Check your internet connection.' };
  }
});

ipcMain.handle('auth-check-verified', async (_, { email }) => {
  try {
    const res  = await fetch(SERVER_URL + '/api/check-verified?email=' + encodeURIComponent(email));
    const data = await res.json();
    if (data.verified) {
      // If newly verified, try to complete login if we have a pending session
      return true;
    }
    return false;
  } catch(e) { return false; }
});

ipcMain.handle('auth-logout', () => {
  clearSession();
  mainWindow?.loadFile('login.html');
  // Disconnect RPC on logout
  if (rpcClient) try { rpcClient.destroy(); } catch(e) {}
  rpcClient = null; rpcConnected = false;
});

// ─── IPC — data ───────────────────────────────────────────────────────────────
ipcMain.handle('load-data',    (_, ud)        => loadData(ud));
ipcMain.handle('save-data',    (_, ud, d)     => { saveData(ud, d); return true; });
ipcMain.handle('get-data-path',(_, ud)        => ud);
ipcMain.handle('list-chats',   (_, ud)        => listChats(ud));
ipcMain.handle('load-chat',    (_, ud, id)    => loadChat(ud, id));
ipcMain.handle('save-chat',    (_, ud, chat)  => { saveChat(ud, chat); return true; });
ipcMain.handle('delete-chat',  (_, ud, id)    => { deleteChat(ud, id); return true; });
ipcMain.handle('pick-asset',   async (_, ud, type) => pickAndSaveAsset(ud, type));
ipcMain.handle('load-asset',   (_, ud, type)  => loadAsset(ud, type));

ipcMain.handle('init-rpc',        async (_, { companionName, mood }) => { await initDiscordRPC(companionName, mood); return rpcConnected; });
ipcMain.handle('update-rpc-mood', (_, { companionName, mood }) => { setActivity(companionName, mood); return true; });

// Non-streaming fallback
ipcMain.handle('call-ai', async (_, { provider, model, messages, systemPrompt }) => {
  try {
    let response;
    if (provider === 'groq') {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_API_KEY}`},
        body: JSON.stringify({ model:model||'llama-3.3-70b-versatile', max_tokens:1024, messages:[{role:'system',content:systemPrompt},...messages] }),
      });
    } else {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENROUTER_API_KEY}`,'HTTP-Referer':'https://ai-companion-app','X-Title':'AI Companion'},
        body: JSON.stringify({ model:model||'stepfun/step-3.5-flash:free', max_tokens:1024, messages:[{role:'system',content:systemPrompt},...messages] }),
      });
    }
    if (!response.ok) { const e = await response.json(); throw new Error(e.error?.message||response.status); }
    const data = await response.json();
    return { success:true, content:data.choices[0].message.content };
  } catch(e) { return { success:false, error:e.message }; }
});

// Streaming — sends tokens to renderer via 'ai-token' IPC events
ipcMain.handle('stream-ai', async (_, { provider, model, messages, systemPrompt }) => {
  try {
    const body = JSON.stringify({
      model:      provider === 'groq' ? (model||'llama-3.3-70b-versatile') : (model||'stepfun/step-3.5-flash:free'),
      max_tokens: 1024,
      stream:     true,
      messages:   [{ role:'system', content:systemPrompt }, ...messages],
    });
    let response;
    if (provider === 'groq') {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_API_KEY}`},
        body,
      });
    } else {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENROUTER_API_KEY}`,'HTTP-Referer':'https://ai-companion-app','X-Title':'AI Companion'},
        body,
      });
    }
    if (!response.ok) {
      const e = await response.json();
      mainWindow?.webContents.send('ai-stream-error', e.error?.message || String(response.status));
      return { success:false };
    }
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]') continue;
        if (!t.startsWith('data: ')) continue;
        try {
          const json  = JSON.parse(t.slice(6));
          const token = json.choices?.[0]?.delta?.content;
          if (token) mainWindow?.webContents.send('ai-token', token);
        } catch(e) {}
      }
    }
    mainWindow?.webContents.send('ai-stream-done');
    return { success:true };
  } catch(e) {
    mainWindow?.webContents.send('ai-stream-error', e.message);
    return { success:false, error:e.message };
  }
});

// ─── Deep link — catches aicompanion://verified?token=xxx ─────────────────────
app.setAsDefaultProtocolClient('aicompanion');

function handleDeepLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'verified') {
      const token = parsed.searchParams.get('token');
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        saveSession({ token, user: { email:decoded.email, firstName:decoded.firstName } });
        mainWindow?.loadFile('index.html');
      }
    }
  } catch(e) { console.log('Deep link error:', e.message); }
}

app.on('second-instance', (_, argv) => {
  const url = argv.find(a => a.startsWith('aicompanion://'));
  if (url) handleDeepLink(url);
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.on('open-url', (_, url) => handleDeepLink(url));

// ─── Window ───────────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

function createWindow() {
  mainWindow = new BrowserWindow({
    width:920, height:680, minWidth:800, minHeight:580,
    frame:false, backgroundColor:'#0b0b12',
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false },
  });

  const session = loadSession();
  if (session) {
    mainWindow.loadFile('index.html');
    const saved = loadData(getUserDir(session.user.email));
    initDiscordRPC(saved?.companion?.name || 'Nova', saved?.mood || 'neutral');
  } else {
    mainWindow.loadFile('login.html');
  }
}

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window-close',    () => mainWindow?.close());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (rpcClient) try { rpcClient.destroy(); } catch(e) {}
  app.quit();
});
