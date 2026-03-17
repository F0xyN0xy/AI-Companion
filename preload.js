const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electron', {
  // Auth
  authGetSession: () => ipcRenderer.invoke('auth-get-session'),
  authLogin: (o) => ipcRenderer.invoke('auth-login', o),
  authRegister: (o) => ipcRenderer.invoke('auth-register', o),
  authCheckVerified: (o) => ipcRenderer.invoke('auth-check-verified', o),
  authLogout: () => ipcRenderer.invoke('auth-logout'),
  // Data
  loadData: (ud) => ipcRenderer.invoke('load-data', ud),
  saveData: (ud, d) => ipcRenderer.invoke('save-data', ud, d),
  getDataPath: (ud) => ipcRenderer.invoke('get-data-path', ud),
  listChats: (ud) => ipcRenderer.invoke('list-chats', ud),
  loadChat: (ud, id) => ipcRenderer.invoke('load-chat', ud, id),
  saveChat: (ud, chat) => ipcRenderer.invoke('save-chat', ud, chat),
  deleteChat: (ud, id) => ipcRenderer.invoke('delete-chat', ud, id),
  pickAsset: (ud, type) => ipcRenderer.invoke('pick-asset', ud, type),
  loadAsset: (ud, type) => ipcRenderer.invoke('load-asset', ud, type),
  // AI
  callAI: (o) => ipcRenderer.invoke('call-ai', o),
  streamAI: (o) => ipcRenderer.invoke('stream-ai', o),
  onAIToken: (cb) => ipcRenderer.on('ai-token', (_, t) => cb(t)),
  onAIStreamDone: (cb) => ipcRenderer.on('ai-stream-done', () => cb()),
  onAIStreamError: (cb) => ipcRenderer.on('ai-stream-error', (_, e) => cb(e)),
  // RPC
  initRPC: (o) => ipcRenderer.invoke('init-rpc', o),
  updateRPCMood: (o) => ipcRenderer.invoke('update-rpc-mood', o),
  // Events
  onRPCStatus: (cb) => ipcRenderer.on('rpc-status', (_, d) => cb(d)),
  // Window
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
});
