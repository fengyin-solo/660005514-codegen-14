export interface Tick { time: string; price: number; bid: number; ask: number; volume: number }
export interface OrderBook { bids: [number,number][]; asks: [number,number][]; midPrice: number; spread: number }
export interface GridConfig { lowerPrice: number; upperPrice: number; gridCount: number; capitalPerGrid: number; initialCapital: number; period: number }
export interface GridOrder { id: number; price: number; side: string; quantity: number; status: string; profit: number }

/** 健康度评分所需的周期内原始指标（后端返回，单位均为百分比） */
export interface HealthRaw {
  coverage: number   // 行情覆盖率
  completion: number // 成交完成率
  drawdown: number   // 回撤幅度
}
export interface GridResult {
  orders: GridOrder[]
  totalProfit: number
  returnRate: number
  sharpeRatio: number
  maxDrawdown: number
  winRate: number
  equityCurve: number[]
  period: number
  healthRaw: HealthRaw
}
