import type { HealthConfig, HealthPeriod } from '@/types'
import { DEFAULT_HEALTH_CONFIG } from './healthScore'

const STORAGE_KEY = 'strategy-health-config-v1'
const PERIOD_KEY = 'strategy-health-period-v1'

/** 读取上次选择的统计周期 */
export function loadPeriod(): HealthPeriod {
  const p = localStorage.getItem(PERIOD_KEY)
  return p === '7d' || p === '30d' || p === 'all' ? p : '30d'
}

export function savePeriod(p: HealthPeriod): void {
  localStorage.setItem(PERIOD_KEY, p)
}

/** 读取上次保存的健康度配置；无记录或解析失败时回落到默认配置 */
export function loadHealthConfig(): HealthConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULT_HEALTH_CONFIG)
    const parsed = JSON.parse(raw)
    const config = normalizeConfig(parsed)
    return config ?? structuredClone(DEFAULT_HEALTH_CONFIG)
  } catch {
    return structuredClone(DEFAULT_HEALTH_CONFIG)
  }
}

/** 保存健康度配置（下次进入页面继续沿用） */
export function saveHealthConfig(config: HealthConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

/** 粗校验持久化数据的结构，避免脏数据进入评分引擎 */
function normalizeConfig(data: unknown): HealthConfig | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.metrics) || !Array.isArray(d.grades)) return null
  const metrics = d.metrics
    .map((m) => {
      if (!m || typeof m !== 'object') return null
      const mm = m as Record<string, unknown>
      if (typeof mm.key !== 'string' || !Array.isArray(mm.bands)) return null
      const bands = mm.bands
        .map((b) => {
          if (!b || typeof b !== 'object') return null
          const bb = b as Record<string, unknown>
          if (typeof bb.value !== 'number' || typeof bb.score !== 'number') return null
          return { value: bb.value, score: bb.score }
        })
        .filter((b): b is { value: number; score: number } => b !== null)
      return {
        key: mm.key as HealthConfig['metrics'][number]['key'],
        label: typeof mm.label === 'string' ? mm.label : mm.key,
        higherBetter: mm.higherBetter !== false,
        weight: typeof mm.weight === 'number' ? mm.weight : 0,
        bands,
      }
    })
    .filter((m): m is HealthConfig['metrics'][number] => m !== null)
  const grades = d.grades
    .map((g) => {
      if (!g || typeof g !== 'object') return null
      const gg = g as Record<string, unknown>
      if (typeof gg.minScore !== 'number' || typeof gg.label !== 'string') return null
      return {
        minScore: gg.minScore,
        label: gg.label,
        color: typeof gg.color === 'string' ? gg.color : '#94a3b8',
      }
    })
    .filter((g): g is HealthConfig['grades'][number] => g !== null)
  if (metrics.length === 0 || grades.length === 0) return null
  return { metrics, grades }
}
