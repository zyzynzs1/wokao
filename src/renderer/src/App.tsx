import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import PracticePage from './pages/PracticePage'
import AnswerPage from './pages/AnswerPage'
import ResultPage from './pages/ResultPage'
import PaperResultPage from './pages/PaperResultPage'
import HistoryPage from './pages/HistoryPage'
import StudyPage from './pages/StudyPage'
import StudyDetailPage from './pages/StudyDetailPage'
import SettingsPage from './pages/SettingsPage'

export default function App(): JSX.Element {
  const { loading, user } = useAuth()
  const [migrating, setMigrating] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState('')

  // 评分体系 v2 历史迁移：旧分保留在 record.legacy，按新标准重评一次。
  // 不需要用户手动触发；失败条目会在下次启动再次尝试。
  useEffect(() => {
    if (loading || !user) return
    let cancelled = false
    void (async () => {
      try {
        const info = await window.api.getGradingMigrationInfo()
        if (cancelled || !info.needed) return
        setMigrating(true)
        setMigrationMessage(`正在按新标准重评历史记录（共 ${info.total - info.done} 条）…`)
        const res = await window.api.runGradingMigration()
        if (cancelled) return
        setMigrating(false)
        setMigrationMessage(
          res.ok
            ? `历史记录已按新标准重评（${res.done} 条）`
            : res.error
              ? `历史重评未完成：${res.error}`
              : `历史重评完成 ${res.done} 条，${res.failed} 条失败（下次启动会重试）`
        )
        window.setTimeout(() => setMigrationMessage(''), 8000)
      } catch (err) {
        if (cancelled) return
        setMigrating(false)
        setMigrationMessage(`历史重评失败：${(err as Error).message}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, user])

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>加载中…</div>
  }

  return (
    <>
      {migrationMessage && (
        <div
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 200,
            maxWidth: 420,
            padding: '10px 14px',
            borderRadius: 10,
            background: migrating ? 'rgba(31,41,55,0.95)' : 'rgba(22,101,52,0.95)',
            color: '#fff',
            fontSize: 13,
            lineHeight: 1.6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)'
          }}
        >
          {migrating ? '⏳ ' : '✅ '}
          {migrationMessage}
        </div>
      )}
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/practice/answer" element={<AnswerPage />} />
          <Route path="/practice/result/:recordId" element={<ResultPage />} />
          <Route path="/practice/paper-result" element={<PaperResultPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/study/:id" element={<StudyDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
