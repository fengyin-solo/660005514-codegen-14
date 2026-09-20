import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { Tick, OrderBook, GridConfig, GridResult } from '@/types'
import { loadHealthConfig, saveHealthConfig, type HealthConfig } from '@/health/scoring'
export const useTradingStore = defineStore('trading', () => {
  const loading = ref(false)
  const ticks = ref<Tick[]>([])
  const orderBook = ref<OrderBook | null>(null)
  const gridResult = ref<GridResult | null>(null)
  const wsConnected = ref(false)
  const config = ref<GridConfig>({ lowerPrice: 95, upperPrice: 115, gridCount: 20, capitalPerGrid: 1000, initialCapital: 100000, period: 0 })

  // 健康度配置：初始化即读取上一次页面使用的配置
  const healthConfig = ref<HealthConfig>(loadHealthConfig())
  const healthEnabled = ref(localStorage.getItem('grid-health-enabled') === '1')

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

  /** 切换统计周期：按同一份健康度配置重算 */
  async function setPeriod(period: number) {
    if (config.value.period === period) return
    config.value.period = period
    await runBacktest()
  }

  function updateHealthConfig(next: HealthConfig) {
    healthConfig.value = next
    saveHealthConfig(next)
  }

  function setHealthEnabled(on: boolean) {
    healthEnabled.value = on
    localStorage.setItem('grid-health-enabled', on ? '1' : '0')
  }

  function disconnectWS() { ws?.close(); ws = null; wsConnected.value = false }

  return { loading, ticks, orderBook, gridResult, wsConnected, config, healthConfig, healthEnabled, connectWS, runBacktest, setPeriod, updateHealthConfig, setHealthEnabled, disconnectWS }
})
