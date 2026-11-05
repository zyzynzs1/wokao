import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './layout.css'

const SIDEBAR_COLLAPSED_KEY = 'wokao:sidebarCollapsed'

const navItems = [
  { to: '/', label: '主页', icon: '🏠' },
  { to: '/practice', label: '练习', icon: '✍️' },
  { to: '/history', label: '历史', icon: '📚' },
  { to: '/study', label: '学习', icon: '📖' },
  { to: '/settings', label: '设置', icon: '⚙️' }
]

export default function Layout(): JSX.Element {
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
    } catch {
      // localStorage 不可用时保持展开
    }
  }, [])

  const toggleSidebar = (): void => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // 忽略持久化失败
      }
      return next
    })
  }

  return (
    <div className="layout">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-logo">w</div>
          <div className="brand-text">
            <div className="brand-name">wokao</div>
            <div className="brand-sub">国考 · 省考</div>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="avatar">{user?.nickname?.slice(0, 1) ?? '考'}</div>
            <div className="user-name">{user?.nickname}</div>
          </div>
        </div>

        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
