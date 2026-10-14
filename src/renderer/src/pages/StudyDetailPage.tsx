import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { StudyMaterial } from '../../../shared/types'
import './study-detail.css'

// 简易 Markdown 渲染：支持 ## 标题、- 列表、普通段落
function renderContent(text: string): ReactNode[] {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  let listItems: string[] = []
  let key = 0

  const flushList = (): void => {
    if (listItems.length) {
      nodes.push(
        <ul key={`ul-${key++}`} className="md-list">
          {listItems.map((li, i) => (
            <li key={i}>{li.replace(/^-\s*/, '')}</li>
          ))}
        </ul>
      )
      listItems = []
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('## ')) {
      flushList()
      nodes.push(
        <h2 key={`h-${key++}`} className="md-h2">
          {line.trim().slice(3)}
        </h2>
      )
    } else if (line.trim().startsWith('- ')) {
      listItems.push(line.trim())
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      nodes.push(
        <p key={`p-${key++}`} className="md-p">
          {line}
        </p>
      )
    }
  }
  flushList()
  return nodes
}

export default function StudyDetailPage(): JSX.Element {
  const { id } = useParams()
  const navigate = useNavigate()
  const [material, setMaterial] = useState<StudyMaterial | null>(null)

  useEffect(() => {
    if (!id) return
    void window.api.getStudyMaterial(id).then((m) => setMaterial(m ?? null))
  }, [id])

  if (!material) {
    return <div className="empty">加载中…</div>
  }

  return (
    <div className="study-detail">
      <button className="btn btn-outline btn-sm" onClick={() => navigate('/study')}>
        ← 返回学习
      </button>
      <div className="card study-detail-card">
        <div className="study-detail-head">
          <span className="tag tag-blue">{material.category}</span>
          <h1 className="study-detail-title">{material.title}</h1>
          {material.source && <div className="study-detail-source">来源：{material.source}</div>}
        </div>
        <div className="study-detail-body">{renderContent(material.content)}</div>
      </div>
    </div>
  )
}
