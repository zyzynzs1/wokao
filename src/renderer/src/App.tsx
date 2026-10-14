import { useEffect, useRef } from 'react'
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
  const migratedRef = useRef(false)

  // 历史记录自动升级：把仍是旧标准的作答记录按最新标准重评一遍（细分得分、失分点、答题骨架）
  useEffect(() => {
    if (loading || !user || migratedRef.current) return
    migratedRef.current = true
    void (async () => {
      try {
        const records = await window.api.getRecords(user.id)
        const pending = records.filter(
          (r) => !r.dimensions?.length || !r.losses?.length || !r.skeleton?.length
        )
        for (const r of pending) {
          await window.api.reevaluateRecord(r.id)
        }
      } catch {
        // 升级失败不打扰用户，下次启动会重试
      }
    })()
  }, [loading, user])

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>加载中…</div>
  }

  return (
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
  )
}
