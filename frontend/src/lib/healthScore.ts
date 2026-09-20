import type {
  HealthConfig, HealthRawMetrics, HealthScore, MetricScore,
  MetricConfig, ConfigIssue, BandPoint, GradeTier,
} from '@/types'

/** 默认健康度配置：分档阈值与权重集中在此，供 UI 编辑与持久化 */
export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  metrics: [
    {
      key: 'marketCoverage',
      label: '行情覆盖率',
      higherBetter: true,
      weight: 0.4,
      bands: [
        { value: 0, score: 0 },
        { value: 60, score: 60 },
        { value: 85, score: 85 },
        { value: 100, score: 100 },
      ],
    },
    {
      key: 'fillCompletion',
      label: '成交完成率',
      higherBetter: true,
      weight: 0.4,
      bands: [
        { value: 0, score: 0 },
        { value: 50, score: 40 },
        { value: 80, score: 80 },
        { value: 100, score: 100 },
      ],
    },
    {
      key: 'maxDrawdown',
      label: '回撤幅度',
      higherBetter: false,
      weight: 0.2,
      // 回撤越小越好：value 升序、score 降序
      bands: [
        { value: 0, score: 100 },
        { value: 5, score: 85 },
        { value: 10, score: 60 },
        { value: 20, score: 20 },
        { value: 40, score: 0 },
      ],
    },
  ],
  grades: [
    { minScore: 0, label: '风险高', color: '#ef4444' },
    { minScore: 60, label: '待观察', color: '#f59e0b' },
    { minScore: 75, label: '良好', color: '#4fc3f7' },
    { minScore: 90, label: '优秀', color: '#22c55e' },
  ],
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * 校验配置是否允许启用。
 * - 分档阈值互相重叠（value 重复/非严格升序、score 与指标方向矛盾）→ 不允许
 * - 权重全部为 0（或出现负数/非数字）→ 不允许
 * - 阈值为空（指标 bands 或等级 minScore 缺失）→ 不允许
 * 返回的每一项 issue 都指出需要调整的配置位置与原因。
 */
export function validateHealthConfig(config: HealthConfig): { valid: boolean; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = []
  const metricByKey = new Map(config.metrics.map((m) => [m.key, m]))

  for (const key of ['marketCoverage', 'fillCompletion', 'maxDrawdown'] as const) {
    const m = metricByKey.get(key) as MetricConfig | undefined
    const field = `metrics.${key}`
    if (!m) {
      issues.push({ field, message: '缺少该项指标配置' })
      continue
    }
    if (!isFiniteNum(m.weight) || m.weight < 0) {
      issues.push({ field: `${field}.weight`, message: `「${m.label}」权重必须是不小于 0 的数字` })
    }
    validateBands(m, issues)
  }

  // 权重全部为 0
  const positiveWeights = config.metrics.filter((m) => isFiniteNum(m.weight) && m.weight > 0)
  if (config.metrics.length > 0 && positiveWeights.length === 0) {
    issues.push({ field: 'weights', message: '权重不能全部为 0，至少需要一项指标参与综合评分' })
  }

  // 等级分档校验
  if (!config.grades || config.grades.length === 0) {
    issues.push({ field: 'grades', message: '等级分档不能为空，至少需要一个等级' })
  } else {
    const sorted = [...config.grades].sort((a, b) => a.minScore - b.minScore)
    let prev: number | null = null
    for (const g of sorted as GradeTier[]) {
      if (!isFiniteNum(g.minScore) || g.minScore < 0 || g.minScore > 100) {
        issues.push({ field: `grades.${g.label || '?'}`, message: `等级「${g.label || ''}」的入档分数必须在 0~100 之间` })
      } else if (prev !== null && g.minScore <= prev) {
        // 入档分数相同即代表档位区间互相重叠
        issues.push({ field: `grades.${g.label || '?'}`, message: `等级「${g.label}」与其它等级的分档阈值重叠，入档分数需严格递增` })
      }
      prev = isFiniteNum(g.minScore) ? g.minScore : prev
    }
  }

  return { valid: issues.length === 0, issues }
}

function validateBands(m: MetricConfig, issues: ConfigIssue[]) {
  const field = `metrics.${m.key}.bands`
  const name = `「${m.label}」`
  if (!Array.isArray(m.bands) || m.bands.length === 0) {
    issues.push({ field, message: `${name}的分档阈值不能为空` })
    return
  }
  let prevValue = -Infinity
  let prevScore: number | null = null
  for (const b of m.bands as BandPoint[]) {
    if (!isFiniteNum(b.value) || !isFiniteNum(b.score)) {
      issues.push({ field, message: `${name}的分档阈值存在空值或非数字` })
      return
    }
    if (b.score < 0 || b.score > 100) {
      issues.push({ field, message: `${name}的分档得分必须在 0~100 之间` })
    }
    if (b.value <= prevValue) {
      // value 相等即两个档位区间互相重叠
      issues.push({ field, message: `${name}的分档阈值在 ${b.value} 处重叠，需按阈值严格升序排列` })
    }
    if (prevScore !== null) {
      if (m.higherBetter && b.score < prevScore) {
        issues.push({ field, message: `${name}为“越大越好”，分档得分应随阈值递增` })
      }
      if (!m.higherBetter && b.score > prevScore) {
        issues.push({ field, message: `${name}为“越小越好”，分档得分应随阈值递减` })
      }
    }
    prevValue = b.value
    prevScore = b.score
  }
}

/** 按断点对原始值做线性插值，得到 0~100 的单项得分 */
export function scoreFromBands(raw: number, bands: BandPoint[]): number {
  const sorted = [...bands].sort((a, b) => a.value - b.value)
  if (raw <= sorted[0].value) return sorted[0].score
  if (raw >= sorted[sorted.length - 1].value) return sorted[sorted.length - 1].score
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1]
    if (raw >= lo.value && raw <= hi.value) {
      const ratio = (raw - lo.value) / (hi.value - lo.value || 1)
      return lo.score + (hi.score - lo.score) * ratio
    }
  }
  return sorted[sorted.length - 1].score
}

/**
 * 按配置合成策略健康度综合评分。
 * 调用方需保证配置已通过 validateHealthConfig。
 */
export function computeHealthScore(raw: HealthRawMetrics, config: HealthConfig): HealthScore {
  const metrics: MetricScore[] = config.metrics.map((m) => {
    const rawValue = raw[m.key]
    return {
      key: m.key,
      label: m.label,
      rawValue,
      score: scoreFromBands(rawValue, m.bands),
      weight: m.weight,
      contribution: 0,
    }
  })

  const totalWeight = metrics.reduce((s, m) => s + m.weight, 0) || 1
  let composite = 0
  for (const m of metrics) {
    m.contribution = (m.weight / totalWeight) * m.score
    composite += m.contribution
  }
  composite = Math.round(composite * 10) / 10

  // 落入的等级：入档分数不高于综合分的最高一档
  const tier = [...config.grades]
    .sort((a, b) => a.minScore - b.minScore)
    .reduce((acc, g) => (composite >= g.minScore ? g : acc), config.grades[0])

  // 最主要的拖低项：加权损失最大（权重用原始值即可，归一化不影响取最大）
  const mainDrag = metrics.reduce((worst, m) => {
    const loss = m.weight * (100 - m.score)
    const worstLoss = worst.weight * (100 - worst.score)
    return loss > worstLoss || (loss === worstLoss && m.score < worst.score) ? m : worst
  }, metrics[0])

  return { composite, grade: tier, mainDrag, metrics }
}
