import type { HealthRaw } from '@/types'

export type MetricKey = 'coverage' | 'completion' | 'drawdown'

export interface MetricTier {
  label: string
  /** 区间下界；null 表示 -∞（drawdown 类指标的最高档通常留空） */
  min: number | null
  /** 区间上界；null 表示 +∞（coverage/completion 类指标的最高档通常留空） */
  max: number | null
  score: number
}

export interface HealthMetricConfig {
  key: MetricKey
  name: string
  weight: number
  /** true：值越大越好（覆盖率、完成率）；false：值越小越好（回撤） */
  higherBetter: boolean
  unit: string
  tiers: MetricTier[]
}

export interface HealthConfig {
  metrics: HealthMetricConfig[]
}

export interface GradeTier { label: string; min: number; color: string }

/** 综合评分等级（内置分档，不参与用户配置校验） */
export const GRADE_TIERS: GradeTier[] = [
  { label: '优', min: 85, color: '#22c55e' },
  { label: '良', min: 70, color: '#4fc3f7' },
  { label: '中', min: 60, color: '#f59e0b' },
  { label: '差', min: 0, color: '#ef4444' }
]

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  metrics: [
    {
      key: 'coverage', name: '行情覆盖率', weight: 0.3, higherBetter: true, unit: '%',
      tiers: [
        { label: '优', min: 80, max: null, score: 100 },
        { label: '良', min: 60, max: 80, score: 80 },
        { label: '中', min: 40, max: 60, score: 60 },
        { label: '差', min: null, max: 40, score: 30 }
      ]
    },
    {
      key: 'completion', name: '成交完成率', weight: 0.3, higherBetter: true, unit: '%',
      tiers: [
        { label: '优', min: 80, max: null, score: 100 },
        { label: '良', min: 60, max: 80, score: 80 },
        { label: '中', min: 40, max: 60, score: 60 },
        { label: '差', min: null, max: 40, score: 30 }
      ]
    },
    {
      key: 'drawdown', name: '回撤幅度', weight: 0.4, higherBetter: false, unit: '%',
      tiers: [
        { label: '优', min: null, max: 5, score: 100 },
        { label: '良', min: 5, max: 10, score: 80 },
        { label: '中', min: 10, max: 20, score: 60 },
        { label: '差', min: 20, max: null, score: 30 }
      ]
    }
  ]
}

export interface MetricIssue { metric: string; reason: string }

export interface HealthValidation {
  valid: boolean
  /** 不允许启用时，需要调整的具体项（指标 + 原因） */
  issues: MetricIssue[]
}

function isBlank(n: number | null): boolean {
  return n === null || n === undefined || Number.isNaN(n)
}

/**
 * 校验配置：
 * 1) 阈值为空（边界全部缺失，或非数值）——无法判定，必须填；
 * 2) 同一指标的分档区间互相重叠——归属不唯一，必须改；
 * 3) 权重全为零——综合评分无法合成，必须至少给一项正权重。
 */
export function validateHealthConfig(config: HealthConfig): HealthValidation {
  const issues: MetricIssue[] = []
  let positiveWeight = false

  for (const raw of config.metrics) {
    // 输入框被清空时可能拿到 undefined / NaN，统一按 0 处理
    const m: HealthMetricConfig = { ...raw, weight: Number.isFinite(raw.weight) ? raw.weight : 0 }
    if (m.weight > 0) positiveWeight = true

    if (!m.tiers.length) {
      issues.push({ metric: m.name, reason: '分档阈值为空，请至少配置一个档位' })
      continue
    }

    const ranges: { min: number | null; max: number | null }[] = []
    for (const t of m.tiers) {
      const minBlank = isBlank(t.min)
      const maxBlank = isBlank(t.max)
      if (minBlank && maxBlank) {
        issues.push({ metric: m.name, reason: `档位「${t.label}」的上下限均为空，请填写阈值` })
        continue
      }
      if (!minBlank && !maxBlank && (t.min as number) > (t.max as number)) {
        issues.push({ metric: m.name, reason: `档位「${t.label}」的下限大于上限` })
      }
      ranges.push({ min: minBlank ? null : t.min, max: maxBlank ? null : t.max })
    }

    // 区间重叠判定：边界相等（如 [60,80] 与 [80,100]）按共享边界处理，不算重叠
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i], b = ranges[j]
        if (!a || !b) continue
        const aLo = a.min ?? -Infinity, aHi = a.max ?? Infinity
        const bLo = b.min ?? -Infinity, bHi = b.max ?? Infinity
        if (aLo < bHi && bLo < aHi) {
          issues.push({ metric: m.name, reason: `档位「${m.tiers[i].label}」与「${m.tiers[j].label}」的阈值区间互相重叠` })
        }
      }
    }
  }

  if (!positiveWeight) issues.push({ metric: '综合权重', reason: '权重全为 0，请至少为一项指标设置正权重' })

  // 同一指标只保留第一条问题，避免重复刷屏
  const dedup = issues.filter((v, idx, arr) => arr.findIndex(o => o.metric === v.metric && o.reason === v.reason) === idx)
  return { valid: dedup.length === 0, issues: dedup }
}

export interface MetricScore {
  key: MetricKey
  name: string
  raw: number
  score: number
  weight: number
  /** 该指标对综合分的实际贡献 */
  weighted: number
  /** 权重为正时，满分情况下的应有贡献，用于定位拖低项 */
  drag: number
  matched: boolean
  tierLabel: string
}

export interface HealthScoreResult {
  total: number
  grade: GradeTier
  metrics: MetricScore[]
  /** 最主要的拖低项 */
  mainDrag: MetricScore | null
}

function gradeOf(total: number): GradeTier {
  return GRADE_TIERS.find(g => total >= g.min) ?? GRADE_TIERS[GRADE_TIERS.length - 1]
}

/** 依据同一份配置，把周期内原始指标映射为分数与等级 */
export function scoreHealth(raw: HealthRaw, config: HealthConfig): HealthScoreResult {
  const metrics: MetricScore[] = config.metrics.map(rawM => {
    const m = { ...rawM, weight: Number.isFinite(rawM.weight) ? rawM.weight : 0 }
    const value = raw[m.key]
    const tier = m.tiers.find(t => (t.min === null || value >= t.min) && (t.max === null || value < t.max))
    const score = tier ? (Number.isFinite(tier.score) ? tier.score : 0) : 0
    const weight = m.weight > 0 ? m.weight : 0
    return {
      key: m.key, name: m.name, raw: value, score, weight,
      weighted: score * weight,
      drag: (100 - score) * weight,
      matched: !!tier,
      tierLabel: tier ? tier.label : '未命中档位'
    }
  })

  const weightSum = metrics.reduce((s, m) => s + m.weight, 0)
  const total = weightSum > 0
    ? metrics.reduce((s, m) => s + m.weighted, 0) / weightSum
    : metrics.reduce((s, m) => s + m.score, 0) / metrics.length

  const weightedMetrics = metrics.filter(m => m.weight > 0 && m.matched)
  let mainDrag: MetricScore | null = null
  if (weightedMetrics.length) {
    mainDrag = weightedMetrics.reduce((a, b) => (b.drag > a.drag ? b : a))
    if (mainDrag.drag <= 0) mainDrag = null
  } else if (metrics.some(m => !m.matched)) {
    mainDrag = metrics.find(m => !m.matched) ?? null
  }

  return { total, grade: gradeOf(total), metrics, mainDrag }
}

const STORAGE_KEY = 'grid-health-config-v1'

/** 重新进入页面时沿用上一次的配置 */
export function loadHealthConfig(): HealthConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return structuredClone(DEFAULT_HEALTH_CONFIG)
    const parsed = JSON.parse(saved) as HealthConfig
    // 与默认配置按 key 对齐，缺项用默认值补齐
    const metrics = DEFAULT_HEALTH_CONFIG.metrics.map(dm => {
      const sm = parsed.metrics?.find(m => m.key === dm.key)
      return sm ? { ...dm, ...sm, tiers: sm.tiers?.length ? sm.tiers : dm.tiers } : dm
    })
    return { metrics }
  } catch {
    return structuredClone(DEFAULT_HEALTH_CONFIG)
  }
}

export function saveHealthConfig(config: HealthConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}
