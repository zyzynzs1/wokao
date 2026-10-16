import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/api'

const api: Api = {
  ensureDefaultUser: () => ipcRenderer.invoke('auth:ensureDefaultUser'),

  getQuestions: () => ipcRenderer.invoke('questions:all'),
  getQuestion: (id) => ipcRenderer.invoke('questions:get', id),
  randomQuestion: (type, examType, province, difficultyId, userId, topic) =>
    ipcRenderer.invoke('questions:random', type, examType, province, difficultyId, userId, topic),
  getQuestionTypes: () => ipcRenderer.invoke('questions:types'),

  getPapers: () => ipcRenderer.invoke('papers:all'),
  generatePaper: (examType, subType, province, difficultyId, userId, topic) =>
    ipcRenderer.invoke('papers:generate', examType, subType, province, difficultyId, userId, topic),
  getPaper: (id) => ipcRenderer.invoke('papers:get', id),

  getRealPapers: () => ipcRenderer.invoke('realPapers:all'),
  getRealPaper: (id) => ipcRenderer.invoke('realPapers:get', id),
  importRealPaper: (paper, questions) => ipcRenderer.invoke('realPapers:import', { paper, questions }),

  getRecords: (userId) => ipcRenderer.invoke('records:list', userId),
  getRecord: (id) => ipcRenderer.invoke('records:get', id),
  deleteRecord: (id) => ipcRenderer.invoke('records:delete', id),
  submitAnswer: (payload) => ipcRenderer.invoke('records:submit', payload),
  reevaluateRecord: (id) => ipcRenderer.invoke('records:reevaluate', id),
  getPredictions: (userId) => ipcRenderer.invoke('predictions:get', userId),

  getSessions: (userId) => ipcRenderer.invoke('sessions:list', userId),
  saveSession: (session) => ipcRenderer.invoke('sessions:save', session),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),

  getStudyMaterials: () => ipcRenderer.invoke('study:all'),
  getStudyMaterial: (id) => ipcRenderer.invoke('study:get', id),

  listLocalStudy: () => ipcRenderer.invoke('localStudy:list'),
  openLocalStudy: (path) => ipcRenderer.invoke('localStudy:open', path),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (next) => ipcRenderer.invoke('settings:update', next),
  testConnection: () => ipcRenderer.invoke('settings:test'),

  // 局域网同步（桌面端为服务端）
  getLanSyncInfo: () => ipcRenderer.invoke('lanSync:info'),
  setLanSyncServer: (enabled) => ipcRenderer.invoke(enabled ? 'lanSync:start' : 'lanSync:stop'),
  regenerateSyncToken: () => ipcRenderer.invoke('lanSync:regenerateToken'),
  saveLanSyncClient: () => ipcRenderer.invoke('lanSync:info'),
  runLanSync: () => ipcRenderer.invoke('lanSync:run'),

  // 跨设备进度同步（云盘共享文件夹）
  getProgressSyncInfo: () => ipcRenderer.invoke('progressSync:info'),
  setProgressSyncDir: (dir) => ipcRenderer.invoke('progressSync:setDir', dir),
  pickProgressSyncDir: () => ipcRenderer.invoke('progressSync:pickDir'),
  runProgressSync: () => ipcRenderer.invoke('progressSync:run'),
  openProgressSyncDir: () => ipcRenderer.invoke('progressSync:openDir')
}

contextBridge.exposeInMainWorld('api', api)

// 窗口状态事件（用于作答计时冻结）
contextBridge.exposeInMainWorld('windowEvents', {
  onMinimized: (cb: () => void) => {
    ipcRenderer.on('window:minimized', cb)
    return () => ipcRenderer.removeListener('window:minimized', cb)
  },
  onRestored: (cb: () => void) => {
    ipcRenderer.on('window:restored', cb)
    return () => ipcRenderer.removeListener('window:restored', cb)
  },
  onBlurred: (cb: () => void) => {
    ipcRenderer.on('window:blurred', cb)
    return () => ipcRenderer.removeListener('window:blurred', cb)
  },
  onFocused: (cb: () => void) => {
    ipcRenderer.on('window:focused', cb)
    return () => ipcRenderer.removeListener('window:focused', cb)
  }
})
