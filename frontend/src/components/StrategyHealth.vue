<template>
  <div class="panel">
    <div class="head">
      <h4>🩺 策略健康度</h4>
      <el-switch v-model="enabled" :before-change="beforeToggle" inline-prompt active-text="开" inactive-text="关" />
    </div>

    <!-- 未启用时：展示校验结果，不允许带问题启用 -->
    <template v-if="!enabled">
      <div class="hint">综合评分由行情覆盖率、成交完成率与回撤幅度按配置权重合成，并映射到等级档位。</div>
      <el-alert v-if="!validation.valid" type="error" :closable="false" show-icon>
        <template #title>当前配置不允许启用，需调整以下 {{ validation.issues.length }} 项：</template>
        <div v-for="(it, i) in validation.issues" :key="i" class="issue-item">· {{ it.metric }}：{{ it.reason }}</div>
      </el-alert>
      <el-button size="small" class="cfg-btn" @click="showEditor = !showEditor">{{ showEditor ? '收起配置' : '调整分档阈值与权重' }}</el-button>
      <ConfigEditor v-if="showEditor" />
    </template>

    <template v-else>
      <el-alert v-if="!validation.valid" type="error" :closable="false" show-icon>
        <template #title>配置存在 {{ validation.issues.length }} 项问题，评分已暂停：</template>
        <div v-for="(it, i) in validation.issues" :key="i" class="issue-item">· {{ it.metric }}：{{ it.reason }}</div>
      </el-alert>

      <template v-else>
        <el-radio-group v-model="period" size="small" class="periods" @change="onPeriodChange">
          <el-radio-button :value="50">近50根</el-radio-button>
          <el-radio-button :value="100">近100根</el-radio-button>
          <el-radio-button :value="0">全部</el-radio-button>
        </el-radio-group>

        <div v-if="!store.gridResult" class="empty">
          <span>暂无回测数据</span>
          <el-button size="small" type="primary" :loading="store.loading" @click="store.runBacktest">运行回测</el-button>
        </div>

        <template v-else-if="result">
          <div class="chart-wrap">
            <div ref="radarEl" class="radar"></div>
            <div class="grade-badge" :style="{ color: result.grade.color }">
              <div class="g-label">综合等级</div>
              <div class="g-grade">{{ result.grade.label }}</div>
              <div class="g-score">{{ result.total.toFixed(0) }}分</div>
            </div>
          </div>
          <div class="drag-line" v-if="result.mainDrag">
            🔻 最主要拖低项：<b :class="{drag:true}">{{ result.mainDrag.name }}</b>
            （当前 {{ fmt(result.mainDrag) }}，仅得 {{ result.mainDrag.score }} 分）
          </div>
          <div class="drag-line ok" v-else>✅ 各项均处于自身档位上限，无明显拖低项</div>

          <div class="metric-rows">
            <div v-for="m in result.metrics" :key="m.key" class="m-row" :class="{ drag: result.mainDrag?.key === m.key }">
              <span class="m-name">{{ m.name }}</span>
              <span class="m-tier" :class="{ miss: !m.matched }">{{ m.tierLabel }}</span>
              <span class="m-raw">{{ fmt(m) }}</span>
              <span class="m-score">{{ m.score }}分</span>
              <span class="m-w">权重{{ Math.round(m.weight * 100) }}%</span>
            </div>
          </div>
        </template>
      </template>

      <el-button size="small" class="cfg-btn" @click="showEditor = !showEditor">{{ showEditor ? '收起配置' : '调整分档阈值与权重' }}</el-button>
      <ConfigEditor v-if="showEditor" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { useTradingStore } from '../store/trading'
import ConfigEditor from './HealthConfigEditor.vue'
import { validateHealthConfig, scoreHealth, type MetricScore } from '@/health/scoring'

const store = useTradingStore()
const radarEl = ref<HTMLDivElement>()
const showEditor = ref(false)
const period = ref(store.config.period)
let inst: echarts.ECharts | null = null

const enabled = computed({
  get: () => store.healthEnabled,
  set: (v: boolean) => store.setHealthEnabled(v)
})

const validation = computed(() => validateHealthConfig(store.healthConfig))
const result = computed(() =>
  store.gridResult ? scoreHealth(store.gridResult.healthRaw, store.healthConfig) : null
)

function fmt(m: MetricScore) {
  const unit = store.healthConfig.metrics.find(x => x.key === m.key)?.unit ?? ''
  return `${m.raw.toFixed(1)}${unit}`
}

async function beforeToggle(): Promise<boolean> {
  if (store.healthEnabled) return true // 关闭不拦截
  const v = validateHealthConfig(store.healthConfig)
  if (!v.valid) {
    showEditor.value = true
    return false
  }
  return true
}

async function onPeriodChange() {
  await store.setPeriod(period.value)
}

function renderRadar() {
  if (!inst || !result.value || !store.gridResult) return
  const r = result.value
  const dragKey = r.mainDrag?.key
  inst.setOption({
    backgroundColor: 'transparent',
    radar: {
      indicator: r.metrics.map(m => ({ name: m.name, max: 100 })),
      radius: '66%',
      center: ['50%', '52%'],
      splitNumber: 4,
      axisName: {
        color: '#94a3b8',
        fontSize: 10,
        formatter: (name: string) => {
          const m = r.metrics.find(x => x.name === name)
          const isDrag = m?.key === dragKey
          return `{${isDrag ? 'drag' : 'normal'}|${name}${isDrag ? ' ▼' : ''}}`
        },
        rich: { normal: { color: '#94a3b8', fontSize: 10 }, drag: { color: '#ef4444', fontSize: 10, fontWeight: 700 } }
      },
      splitLine: { lineStyle: { color: '#1e2a5a' } },
      splitArea: { areaStyle: { color: ['rgba(30,42,90,0.15)', 'rgba(30,42,90,0.05)'] } },
      axisLine: { lineStyle: { color: '#1e2a5a' } }
    },
    series: [{
      type: 'radar',
      data: [{
        value: r.metrics.map(m => m.score),
        name: '健康度',
        symbol: 'circle', symbolSize: 5,
        lineStyle: { color: r.grade.color, width: 2 },
        itemStyle: { color: r.grade.color },
        areaStyle: { color: r.grade.color, opacity: 0.22 }
      }]
    }],
    animation: false
  }, true)
}

watch([result, () => store.gridResult, validation], () => setTimeout(renderRadar, 30), { deep: true })
watch(showEditor, async (v) => {
  if (!v && enabled.value && !store.gridResult) await store.runBacktest()
})

// 开关刚打开且尚无回测数据时，自动拉一次
watch(enabled, async (on) => {
  if (on && !store.gridResult) await store.runBacktest()
})

function onResize() { inst?.resize() }
onMounted(async () => {
  window.addEventListener('resize', onResize)
  if (store.healthEnabled && !store.gridResult) await store.runBacktest()
})
onUnmounted(() => { window.removeEventListener('resize', onResize); inst?.dispose() })

// radar 容器随 v-if 出现，需要在 DOM 就绪后初始化
watch([enabled, validation, () => store.gridResult], () => {
  setTimeout(() => {
    if (enabled.value && validation.value.valid && store.gridResult && radarEl.value && !inst) {
      inst = echarts.init(radarEl.value)
      renderRadar()
    }
    if ((!enabled.value || !validation.value.valid || !store.gridResult) && inst) {
      inst.dispose(); inst = null
    }
  }, 30)
})
</script>

<style scoped>
.panel{background:#0f1535;border-radius:8px;padding:12px;border:1px solid #1e2a5a}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.panel h4{color:#4fc3f7;font-size:13px}
.hint{font-size:11px;color:#94a3b8;line-height:1.6;margin-bottom:8px}
.issue-item{font-size:11px;line-height:1.7;color:#fecaca}
.cfg-btn{margin-top:8px;width:100%}
.periods{margin-bottom:6px}
.empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 0;color:#64748b;font-size:12px}
.chart-wrap{position:relative}
.radar{width:100%;height:210px}
.grade-badge{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}
.g-label{font-size:9px;color:#64748b}
.g-grade{font-size:30px;font-weight:800;line-height:1.1}
.g-score{font-size:10px;color:#94a3b8}
.drag-line{font-size:11px;color:#cbd5e1;line-height:1.5;margin:4px 0}
.drag-line.ok{color:#22c55e}
b.drag{color:#ef4444}
.metric-rows{margin-top:6px}
.m-row{display:grid;grid-template-columns:1fr auto auto auto auto;gap:6px;align-items:center;font-size:11px;padding:4px 6px;border-radius:4px;color:#cbd5e1}
.m-row.drag{background:#ef444418}
.m-name{color:#e2e8f0}
.m-tier{background:#1e2a5a;color:#4fc3f7;border-radius:3px;padding:0 5px;font-size:10px}
.m-tier.miss{background:#7f1d1d;color:#fecaca}
.m-raw{color:#94a3b8;min-width:52px;text-align:right}
.m-score{font-weight:700;min-width:38px;text-align:right}
.m-w{color:#64748b;font-size:10px;text-align:right}
</style>
