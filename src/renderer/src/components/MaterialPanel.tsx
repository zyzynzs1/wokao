import { useEffect, useState } from 'react'
import type { HighlightMark, Question } from '../../../shared/types'
import MarkableText from './MarkableText'
import { splitMaterialSections, type MaterialSection } from './materialSections'
import './material-panel.css'

interface Props {
  question: Question
  allQuestions: Question[]
  marks: HighlightMark[]
  editable?: boolean
  color?: string
  onMark: (field: HighlightMark['field'], start: number, end: number, color: string) => void
  onUnmark: (field: HighlightMark['field'], start: number, end: number) => void
  onNote: (field: HighlightMark['field'], start: number, end: number, note: string) => void
  onRemove: (field: HighlightMark['field'], start: number, end: number) => void
}

export default function MaterialPanel({
  question,
  allQuestions,
  marks,
  editable,
  color,
  onMark,
  onUnmark,
  onNote,
  onRemove
}: Props): JSX.Element {
  const sections = splitMaterialSections(question, allQuestions)
  const [active, setActive] = useState<'all' | number>('all')

  useEffect(() => {
    setActive('all')
  }, [question.id])

  const visible: MaterialSection[] =
    active === 'all' ? sections : sections[active] ? [sections[active]] : []

  const sectionMarks = (section: MaterialSection): HighlightMark[] =>
    marks
      .filter(
        (m) =>
          m.field === 'material' &&
          m.start >= section.offset &&
          m.end <= section.offset + section.text.length
      )
      .map((m) => ({ ...m, start: m.start - section.offset, end: m.end - section.offset }))

  const renderSection = (section: MaterialSection): JSX.Element => (
    <div className="answer-material-section" key={section.offset}>
      {sections.length > 1 && active === 'all' && (
        <div className="answer-material-section-title">{section.title}</div>
      )}
      <MarkableText
        text={section.text}
        field="material"
        marks={sectionMarks(section)}
        editable={editable}
        color={color}
        onMark={(s, e, c) => onMark('material', section.offset + s, section.offset + e, c)}
        onUnmark={(s, e) => onUnmark('material', section.offset + s, section.offset + e)}
        onNote={(s, e, n) => onNote('material', section.offset + s, section.offset + e, n)}
        onRemove={(s, e) => onRemove('material', section.offset + s, section.offset + e)}
      />
    </div>
  )

  return (
    <div className="answer-material">
      <div className="answer-material-head">
        <div className="answer-material-label">给定资料</div>
        {sections.length > 1 && (
          <div className="answer-material-tabs" role="tablist" aria-label="给定资料分则">
            <button
              type="button"
              className={`answer-material-tab${active === 'all' ? ' active' : ''}`}
              onClick={() => setActive('all')}
            >
              全部材料
            </button>
            {sections.map((s, i) => (
              <button
                type="button"
                key={s.offset}
                className={`answer-material-tab${active === i ? ' active' : ''}`}
                onClick={() => setActive(i)}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="answer-material-body">
        {visible.map((section) => renderSection(section))}
      </div>
    </div>
  )
}
