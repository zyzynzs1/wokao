// 解析与校验工具：模型输出不可信，所有结构性问题由代码兜住。
import type {
  CoverageStatus,
  EssayTier,
  ExpansionLevel,
  GradingPoint,
  PointCoverage,
  PointPool
} from '../../shared/types'

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = (raw || '').trim()
  if (!text) return null
  const candidates = [text]
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fence) candidates.push(fence[1].trim())
  candidates.push(text)
  for (const c of candidates) {
    try {
      const v = JSON.parse(c)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      /* continue */
    }
  }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      const v = JSON.parse(text.slice(first, last + 1))
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      /* ignore */
    }
  }
  return null
}

export function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function roundHalfUp(n: number, step = 0.5): number {
  if (!Number.isFinite(n)) return 0
  const s = step > 0 ? step : 0.5
  return Math.round((n + Number.EPSILON) / s) * s
}

export function normalizeStatus(v: unknown): CoverageStatus {
  const s = asString(v)
  if (s === 'full' || s === 'complete' || s === '完整覆盖' || s === '命中') return 'full'
  if (s === 'equivalent' || s === '等义表达' || s === '等义') return 'equivalent'
  if (s === 'partial' || s === '部分覆盖' || s === '部分') return 'partial'
  if (s === 'out_of_material' || s === '材料外' || s === '超出材料') return 'out_of_material'
  return 'none'
}

export function normalizeExpansion(v: unknown): ExpansionLevel {
  const s = asString(v)
  if (s === 'full' || s === '充分' || s === '充分展开') return 'full'
  if (s === 'basic' || s === '基本' || s === '基本展开') return 'basic'
  if (s === 'brief' || s === '简略' || s === '简略提及') return 'brief'
  if (s === 'title' || s === '仅列标题' || s === '仅标题') return 'title'
  return 'none'
}

export function normalizeEssayTier(v: unknown): EssayTier {
  const s = asString(v)
  if (s.includes('一类')) return '一类文'
  if (s.includes('二类')) return '二类文'
  if (s.includes('三类')) return '三类文'
  return '四类文'
}

function normalizePoint(raw: unknown, index: number, totalScore: number, count: number): GradingPoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const text = asString(o.text ?? o.point ?? o.要点)
  if (!text) return null
  const evidence = asString(o.evidence ?? o.materialEvidence ?? o.依据)
  const independent = o.independent === false ? false : true
  const group = asString(o.group ?? o.考点)
  const weight = totalScore > 0 && count > 0 ? totalScore / count : 0
  return {
    id: `p${index + 1}`,
    text,
    ...(group ? { group } : {}),
    weight,
    evidence,
    independent,
    source: 'material'
  }
}

// 把模型输出的 points 数组规范化；过滤空要点/无依据/非独立点
export function normalizePoints(raw: unknown, totalScore: number): GradingPoint[] {
  if (!Array.isArray(raw)) return []
  const list = raw
    .map((item, index) => normalizePoint(item, index, totalScore, raw.length))
    .filter((p): p is GradingPoint => !!p && p.independent)
  // 重新编号，保持连续
  return list.map((p, i) => ({ ...p, id: `p${i + 1}` }))
}

// 规范化考生覆盖判定；缺编号按未覆盖、命中无原文按未覆盖从严处理
export function normalizeCoverage(
  raw: unknown,
  pool: PointPool
): { coverage: PointCoverage[]; warnings: string[] } {
  const warnings: string[] = []
  const byId = new Map<string, Record<string, unknown>>()
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).judgments)
      ? ((raw as Record<string, unknown>).judgments as unknown[])
      : []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = asString(o.id ?? o.pointId ?? o.编号)
    if (id) byId.set(id, o)
  }

  const coverage: PointCoverage[] = []
  for (const point of pool.points) {
    const o = byId.get(point.id)
    if (!o) {
      coverage.push({ pointId: point.id, status: 'none', expansion: 'none' })
      continue
    }
    let status = normalizeStatus(o.status ?? o.命中)
    let expansion = normalizeExpansion(o.expansion ?? o.展开度)
    const userQuote = asString(o.userQuote ?? o.答卷原文 ?? o.证据)
    if ((status === 'full' || status === 'equivalent' || status === 'partial') && !userQuote) {
      warnings.push(`要点 ${point.id} 判为覆盖但未给出考生原句，已按未覆盖处理`)
      status = 'none'
    }
    if (status === 'none' || status === 'out_of_material') {
      expansion = 'none'
    } else if (expansion === 'none') {
      // 覆盖了但模型没给展开度：按最低可得分档兜底，避免整点归零
      expansion = status === 'partial' ? 'brief' : 'basic'
    }
    coverage.push({
      pointId: point.id,
      status,
      expansion,
      ...(userQuote ? { userQuote } : {}),
      ...(asString(o.note) ? { note: asString(o.note) } : {})
    })
  }
  return { coverage, warnings }
}

const STATUS_SEVERITY: Record<CoverageStatus, number> = {
  full: 0,
  equivalent: 1,
  partial: 2,
  out_of_material: 3,
  none: 4
}

export function moreSevereStatus(a: CoverageStatus, b: CoverageStatus): CoverageStatus {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b
}

export function validatePool(pool: PointPool): string[] {
  const warnings: string[] = []
  if (pool.type !== '文章论述') {
    if (pool.points.length < 3) warnings.push(`点池只有 ${pool.points.length} 个要点，偏少，分数可能虚高`)
    if (pool.points.length > 12) warnings.push(`点池有 ${pool.points.length} 个要点，偏多，分数可能偏低`)
    for (const p of pool.points) {
      if (!p.evidence) warnings.push(`要点 ${p.id} 缺少材料出处`)
    }
  }
  return warnings
}
