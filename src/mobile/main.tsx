import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from '../renderer/src/App'
import { AuthProvider } from '../renderer/src/context/AuthContext'
import '../renderer/src/styles/global.css'
import './mobile.css'
import { mobileApi } from './api'

// 移动端不具备 Electron IPC，注入基于 localStorage 的实现
Object.defineProperty(window, 'api', { value: mobileApi, configurable: true, writable: true })
Object.defineProperty(window, 'windowEvents', {
  value: {
    onMinimized: () => () => {},
    onRestored: () => () => {},
    onBlurred: () => () => {},
    onFocused: () => () => {}
  },
  configurable: true,
  writable: true
})

document.documentElement.classList.add('mobile')

// Capacitor 在键盘弹出时会压缩 WebView 并给根视图加底部内边距，
// 导致底部导航被顶到输入法上方。这里记录屏幕完整高度并写入 --app-height，
// 让布局始终按完整屏幕高度排版，导航保持贴底（由输入法覆盖）。
let maxAppHeight = 0
let lastAppWidth = 0
function syncAppHeight(): void {
  if (window.innerWidth !== lastAppWidth) {
    lastAppWidth = window.innerWidth
    maxAppHeight = 0
  }
  maxAppHeight = Math.max(maxAppHeight, window.innerHeight)
  document.documentElement.style.setProperty('--app-height', `${maxAppHeight}px`)
}
syncAppHeight()
window.addEventListener('resize', syncAppHeight)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthProvider>
  </React.StrictMode>
)
