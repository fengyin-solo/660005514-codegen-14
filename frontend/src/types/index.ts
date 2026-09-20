export interface Tick { time: string; price: number; bid: number; ask: number; volume: number }
export interface OrderBook { bids: [number,number][]; asks: [number,number][]; midPrice: number; spread: number }
export interface GridConfig { lowerPrice: number; upperPrice: number; gridCount: number; capitalPerGrid: number; initialCapital: number }
export interface GridOrder { id: number; price: number; side: string; quantity: number; status: string; profit: number }
export interface GridResult { orders: GridOrder[]; totalProfit: number; returnRate: number; sharpeRatio: number; maxDrawdown: number; winRate: number; equityCurve: number[] }

/** 统计周期 */
export type HealthPeriod = '7d' | '30d' | 'all'

/** 策略健康度的三个原始指标（后端返回，均为百分数；回撤越小越好） */
export interface HealthRawMetrics {
  marketCoverage: number
  fillCompletion: number
  maxDrawdown: number
}

/** 单项指标配置：分档阈值为「原始值 -> 得分」断点 */
export interface MetricConfig {
  key: keyof HealthRawMetrics
  label: string
  /** 原始值越大越好（true）还是越小越好（false，如回撤） */
  higherBetter: boolean
  /** 权重，必须 > 0，三项权重之和不必为 1，内部会归一化 */
  weight: number
  /**
   * 分档阈值（断点），形如 [{value: 0, score: 0}, {value: 60, score: 60}, {value: 90, score: 100}]。
   * 断点须按 value 严格升序；为空时配置不允许启用。
   */
  bands: BandPoint[]
}

export interface BandPoint { value: number; score: number }

/** 综合评分分档：达到 minScore 即落入该等级 */
export interface GradeTier {
  /** 入档最低综合分 */
  minScore: number
  label: string
  color: string
}

/** 策略健康度整套配置 */
export interface HealthConfig {
  metrics: MetricConfig[]
  grades: GradeTier[]
}

/** 配置校验问题（指出需要调整的具体项） */
export interface ConfigIssue {
  /** 需要调整的配置项路径，如 metrics.marketCoverage.bands / weights / grades */
  field: string
  message: string
}

/** 单项评分结果 */
export interface MetricScore {
  key: keyof HealthRawMetrics
  label: string
  rawValue: number
  /** 归一化后的 0~100 分 */
  score: number
  weight: number
  /** 加权后对综合分的贡献 */
  contribution: number
}

/** 综合评分结果 */
export interface HealthScore {
  composite: number
  grade: GradeTier
  /** 最主要的拖低项：加权损失(weight*(100-score))最大的指标 */
  mainDrag: MetricScore
  metrics: MetricScore[]
}

export interface HealthResponse {
  periods: Record<HealthPeriod, HealthRawMetrics>
}
