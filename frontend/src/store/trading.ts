import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { Tick, OrderBook, GridConfig, GridResult, HealthConfig, HealthPeriod, HealthResponse, HealthRawMetrics } from '@/types'
import { loadHealthConfig, saveHealthConfig, loadPeriod, savePeriod } from '@/lib/healthConfig'
export const useTradingStore = defineStore('trading', () => {
  const loading = ref(false)
  const ticks = ref<Tick[]>([])
  const orderBook = ref<OrderBook | null>(null)
  const gridResult = ref<GridResult | null>(null)
  const wsConnected = ref(false)
  const config = ref<GridConfig>({ lowerPrice: 95, upperPrice: 115, gridCount: 20, capitalPerGrid: 1000, initialCapital: 100000 })

  // ---- 策略健康度 ----
  const period = ref<HealthPeriod>(loadPeriod())
  const healthLoading = ref(false)
  const healthPeriods = ref<Record<HealthPeriod, HealthRawMetrics> | null>(null)
  // 启动时沿用上次保存的配置
  const healthConfig = ref<HealthConfig>(loadHealthConfig())

  let ws: WebSocket | null = null
  function connectWS() {
    ws = new WebSocket(`ws://${location.hostname}:8000/ws`)
    ws.onopen = () => { wsConnected.value = true }
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.ticks) ticks.value = d.ticks.slice(-60)
        if (d.orderBook) orderBook.value = d.orderBook
      } catch {}
    }
    ws.onclose = () => { wsConnected.value = false }
  }

  async function runBacktest() {
    loading.value = true
    try { const { data } = await axios.post('/api/backtest', config.value) ; gridResult.value = data }
    finally { loading.value = false }
  }

  /** 拉取各统计周期的健康度原始指标（评分一律由前端按同一份配置重算） */
  async function fetchHealth() {
    healthLoading.value = true
    try {
      const { data } = await axios.post<HealthResponse>('/api/health', config.value)
      healthPeriods.value = data.periods
    } finally { healthLoading.value = false }
  }

  function setPeriod(p: HealthPeriod) { period.value = p; savePeriod(p) }

  /** 更新健康度配置并持久化，下次进入页面继续沿用 */
  function updateHealthConfig(next: HealthConfig) {
    healthConfig.value = next
    saveHealthConfig(next)
  }

  function disconnectWS() { ws?.close(); ws = null; wsConnected.value = false }

  return {
    loading, ticks, orderBook, gridResult, wsConnected, config,
    period, healthLoading, healthPeriods, healthConfig,
    connectWS, runBacktest, fetchHealth, setPeriod, updateHealthConfig, disconnectWS,
  }
})
