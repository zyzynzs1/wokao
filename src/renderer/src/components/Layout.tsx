import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './layout.css'

const navItems = [
  { to: '/', label: '主页', icon: '🏠' },
  { to: '/practice', label: '练习', icon: '✍️' },
  { to: '/history', label: '历史', icon: '📚' },
  { to: '/study', label: '学习', icon: '📖' },
  { to: '/settings', label: '设置', icon: '⚙️' }
]

export default function Layout(): JSX.Element {
  const { user } = useAuth()

  return (
    <div className="layout">
      <aside className="sidebar">
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
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="avatar">{user?.nickname?.slice(0, 1) ?? '考'}</div>
            <div className="user-name">{user?.nickname}</div>
          </div>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
