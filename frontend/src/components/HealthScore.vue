<template>
  <div class="panel">
    <div class="head">
      <h4>🩺 策略健康度</h4>
      <el-button size="small" text type="primary" @click="showEditor = true">配置阈值/权重</el-button>
    </div>

    <!-- 配置不允许启用：指出需要调整的项 -->
    <el-alert v-if="!validation.valid" type="error" :closable="false" show-icon
      title="当前健康度配置未通过校验，评分暂不可用，请调整以下配置项：">
      <ul class="issue-list">
        <li v-for="(it, i) in validation.issues" :key="i">
          <code>{{ it.field }}</code>：{{ it.message }}
        </li>
      </ul>
      <el-button size="small" type="primary" plain style="margin-top:6px" @click="showEditor = true">前往调整</el-button>
    </el-alert>

    <template v-else>
      <el-radio-group v-model="currentPeriod" size="small" class="periods">
        <el-radio-button value="7d">近7天</el-radio-button>
        <el-radio-button value="30d">近30天</el-radio-button>
        <el-radio-button value="all">全部</el-radio-button>
      </el-radio-group>

      <div v-loading="store.healthLoading">
        <div ref="gaugeEl" class="gauge"></div>

        <div v-if="result" class="drag-tip" :style="{ borderColor: result.grade.color }">
          <span class="drag-label">主要拖低项</span>
          <span class="drag-name" :style="{ color: result.grade.color }">{{ result.mainDrag.label }}</span>
          <span class="drag-val">原始值 {{ formatRaw(result.mainDrag) }}</span>
        </div>

        <div v-if="result" class="metric-list">
          <div v-for="m in result.metrics" :key="m.key" class="metric-row"
            :class="{ dragging: m.key === result.mainDrag.key }">
            <div class="mr-top">
              <span class="mr-label">{{ m.label }}</span>
              <span class="mr-score">{{ m.score.toFixed(0) }} 分</span>
            </div>
            <el-progress :percentage="clamp(m.score)" :stroke-width="6" :show-text="false"
              :color="m.key === result.mainDrag.key ? '#ef4444' : '#4fc3f7'" />
            <div class="mr-sub">
              <span>原始 {{ formatRaw(m) }}</span>
              <span>权重 {{ (normalizedWeight(m) * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </div>

        <div v-else-if="!store.healthPeriods" class="empty">点击下方按钮加载各周期指标</div>
      </div>

      <el-button size="small" style="width:100%;margin-top:6px" :loading="store.healthLoading"
        @click="store.fetchHealth()">刷新指标</el-button>
    </template>

    <HealthConfigEditor v-model="showEditor" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { useTradingStore } from '../store/trading'
import { validateHealthConfig, computeHealthScore } from '../lib/healthScore'
import HealthConfigEditor from './HealthConfigEditor.vue'
import type { HealthPeriod, MetricScore } from '@/types'

const store = useTradingStore()
const showEditor = ref(false)
const gaugeEl = ref<HTMLDivElement>()
let inst: echarts.ECharts | null = null

const currentPeriod = ref<HealthPeriod>(store.period)
watch(currentPeriod, (p) => store.setPeriod(p))

const validation = computed(() => validateHealthConfig(store.healthConfig))
const rawMetrics = computed(() => store.healthPeriods?.[currentPeriod.value] ?? null)
const result = computed(() =>
  validation.value.valid && rawMetrics.value
    ? computeHealthScore(rawMetrics.value, store.healthConfig)
    : null
)

function normalizedWeight(m: MetricScore): number {
  const total = store.healthConfig.metrics.reduce((s, x) => s + x.weight, 0) || 1
  return m.weight / total
}

function formatRaw(m: MetricScore): string {
  return m.key === 'maxDrawdown' ? `${m.rawValue.toFixed(2)}%` : `${m.rawValue.toFixed(2)}%`
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function renderGauge() {
  if (!inst) return
  const r = result.value
  if (!r) {
    inst.clear()
    return
  }
  inst.setOption({
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      radius: '95%',
      center: ['50%', '62%'],
      progress: { show: true, width: 12, itemStyle: { color: r.grade.color } },
      axisLine: { lineStyle: { width: 12, color: [[1, 'rgba(255,255,255,0.08)']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: false },
      anchor: { show: false },
      detail: {
        offsetCenter: ['0%', '-8%'],
        formatter: () => `{v|${r.composite.toFixed(1)}}\n{g|${r.grade.label}}`,
        rich: {
          v: { fontSize: 30, fontWeight: 700, color: r.grade.color, lineHeight: 38 },
          g: { fontSize: 14, color: '#cbd5e1', lineHeight: 22 },
        },
      },
      data: [{ value: r.composite }],
    }],
  })
}

watch([result, validation], async () => {
  await nextTick()
  if (validation.value.valid && gaugeEl.value) {
    if (!inst) inst = echarts.init(gaugeEl.value)
    renderGauge()
  }
}, { deep: true })

// 切换周期或修改配置后，图表由上面的 watcher 重算重绘；这里保证 resize
onMounted(async () => {
  await nextTick()
  if (validation.value.valid && gaugeEl.value) inst = echarts.init(gaugeEl.value)
  renderGauge()
  window.addEventListener('resize', resize)
  store.fetchHealth().catch(() => ElMessage.error('健康度指标加载失败，请确认后端已启动'))
})
function resize() { inst?.resize() }
onUnmounted(() => { window.removeEventListener('resize', resize); inst?.dispose(); inst = null })
</script>

<style scoped>
.panel{background:#0f1535;border-radius:8px;padding:12px;border:1px solid #1e2a5a}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.panel h4{color:#4fc3f7;font-size:13px}
.periods{width:100%;justify-content:center;margin:4px 0 2px}
.periods :deep(.el-radio-button__inner){padding:5px 12px}
.gauge{width:100%;height:180px}
.drag-tip{display:flex;align-items:center;gap:8px;background:#0a0e27;border:1px solid;border-radius:6px;padding:6px 10px;margin:2px 0 8px;font-size:12px}
.drag-label{color:#94a3b8}
.drag-name{font-weight:700}
.drag-val{margin-left:auto;color:#64748b;font-size:11px}
.metric-list{display:flex;flex-direction:column;gap:8px}
.metric-row{padding:6px 8px;background:#0a0e27;border-radius:6px;border:1px solid transparent}
.metric-row.dragging{border-color:#ef444466;background:#ef444410}
.mr-top{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}
.mr-label{color:#cbd5e1}
.mr-score{color:#e2e8f0;font-weight:600}
.mr-sub{display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:3px}
.empty{text-align:center;color:#64748b;font-size:11px;padding:12px 0}
.issue-list{margin:4px 0 0 16px;font-size:12px}
.issue-list code{color:#fca5a5;background:#0a0e27;padding:0 4px;border-radius:3px}
</style>
