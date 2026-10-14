import { createElement, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LocalStudyFile, LocalStudyFolder, StudyCategory, StudyMaterial } from '../../../shared/types'
import './study.css'

type TabKey = StudyCategory

const TABS: { key: TabKey; label: string }[] = [
  { key: '知识点', label: '知识点' },
  { key: '答题技巧', label: '答题技巧' },
  { key: '满分范文', label: '满分范文' },
  { key: '作答模板', label: '作答模板' }
]

// 去掉文件名末尾的（1）、(1) 等序号后缀
function cleanName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot >= 0 ? name.slice(0, dot) : name
  const ext = dot >= 0 ? name.slice(dot) : ''
  const cleaned = base.replace(/[（(]\s*\d+\s*[)）]\s*$/g, '').trim()
  return cleaned + ext
}

function baseKey(name: string): string {
  const c = cleanName(name)
  const dot = c.lastIndexOf('.')
  return dot >= 0 ? c.slice(0, dot) : c
}

function categorizeLocal(name: string): StudyCategory {
  if (/范文/.test(name)) return '满分范文'
  if (/模板/.test(name)) return '作答模板'
  if (/笔记|金句|解构|技巧|手写/.test(name)) return '答题技巧'
  return '知识点'
}

function toFileUrl(p: string): string {
  return 'file:///' + encodeURI(p.replace(/\\/g, '/'))
}

interface LocalFile extends LocalStudyFile {
  cat: StudyCategory
}

// 扁平化 → 去（1）→ 去重（同名保留 pdf）→ 过滤面试 → 归类
function buildLocalFiles(folders: LocalStudyFolder[]): LocalFile[] {
  const all = folders.flatMap((f) => f.files)
  const map = new Map<string, LocalStudyFile>()
  for (const file of all) {
    const name = cleanName(file.name)
    if (/面试/.test(name)) continue
    const key = baseKey(name)
    const existing = map.get(key)
    if (!existing || (file.ext === '.pdf' && existing.ext !== '.pdf')) {
      map.set(key, { ...file, name })
    }
  }
  return Array.from(map.values()).map((f) => ({ ...f, cat: categorizeLocal(f.name) }))
}

export default function StudyPage(): JSX.Element {
  const navigate = useNavigate()
  const [materials, setMaterials] = useState<StudyMaterial[]>([])
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([])
  const [tab, setTab] = useState<TabKey>('知识点')
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null)

  useEffect(() => {
    void window.api.getStudyMaterials().then(setMaterials)
    void window.api.listLocalStudy().then((f) => setLocalFiles(buildLocalFiles(f)))
  }, [])

  const filtered = useMemo(() => materials.filter((m) => m.category === tab), [materials, tab])
  const localFiltered = useMemo(() => localFiles.filter((f) => f.cat === tab), [localFiles, tab])

  const tabsBar = (
    <div className="study-tabs">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`study-tab${tab === t.key ? ' active' : ''}`}
          onClick={() => setTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  const previewModal = preview && (
    <div className="pdf-overlay" onClick={() => setPreview(null)}>
      <div className="pdf-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-head">
          <span className="pdf-title">{preview.name}</span>
          <button className="pdf-close" onClick={() => setPreview(null)}>
            ×
          </button>
        </div>
        {createElement('webview', { src: preview.url, className: 'pdf-viewer', plugins: true })}
      </div>
    </div>
  )

  return (
    <div>
      <h1 className="page-title">学习</h1>
      <p className="study-sub">申论常见知识点、答题技巧、满分范文与作答模板</p>
      {tabsBar}

      {localFiltered.length > 0 && (
        <div className="card local-block">
          <h3 className="local-block-title">📎 本地资料</h3>
          <div className="local-files">
            {localFiltered.map((f) => (
              <div
                key={f.path}
                className="local-file"
                onClick={() => setPreview({ name: f.name, url: toFileUrl(f.path) })}
              >
                <span className="local-file-icon">{f.ext === '.pdf' ? '📄' : '📝'}</span>
                <span className="local-file-name" title={f.name}>
                  {f.name}
                </span>
                <span className="local-file-open">预览 ↗</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="study-list">
        {filtered.map((m) => (
          <div key={m.id} className="card study-item" onClick={() => navigate(`/study/${m.id}`)}>
            <div className="study-item-head">
              <span className={`tag ${categoryTag(m.category)}`}>{m.category}</span>
              <h3 className="study-item-title">{m.title}</h3>
            </div>
            <p className="study-item-summary">{m.summary}</p>
          </div>
        ))}
        {filtered.length === 0 && localFiltered.length === 0 && <div className="empty">暂无内容</div>}
      </div>

      {previewModal}
    </div>
  )
}

function categoryTag(c: StudyCategory): string {
  switch (c) {
    case '知识点':
      return 'tag-blue'
    case '答题技巧':
      return 'tag-green'
    case '满分范文':
      return 'tag-orange'
    case '作答模板':
      return 'tag-gray'
    default:
      return 'tag-gray'
  }
}
