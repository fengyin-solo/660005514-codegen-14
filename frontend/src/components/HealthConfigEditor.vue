<template>
  <div class="editor">
    <el-alert v-if="!validation.valid" type="error" :closable="false" show-icon>
      <template #title>以下 {{ validation.issues.length }} 项需要调整，否则不能启用：</template>
      <div v-for="(it, i) in validation.issues" :key="i" class="issue">· {{ it.metric }}：{{ it.reason }}</div>
    </el-alert>
    <el-alert v-else type="success" :closable="false" show-icon title="配置有效，可以启用健康度评分" />

    <div v-for="m in draft.metrics" :key="m.key" class="metric-block">
      <div class="metric-head">
        <span class="metric-name">{{ m.name }}</span>
        <span class="metric-dir">{{ m.higherBetter ? '值越大越好' : '值越小越好' }}</span>
        <el-input-number v-model="m.weight" :min="0" :max="1" :step="0.1" size="small" controls-position="right" class="w-input" />
        <span class="w-label">权重</span>
      </div>
      <div class="tier-head"><span>档位</span><span>下限{{ m.unit }}（空=不限）</span><span>上限{{ m.unit }}（空=不限）</span><span>得分</span></div>
      <div v-for="(t, ti) in m.tiers" :key="ti" class="tier-row">
        <el-input v-model="t.label" size="small" class="t-label" />
        <el-input v-model="proxy(t, 'min').value" size="small" placeholder="−∞" class="t-bound" />
        <el-input v-model="proxy(t, 'max').value" size="small" placeholder="+∞" class="t-bound" />
        <el-input-number v-model="t.score" :min="0" :max="100" :step="10" size="small" controls-position="right" class="t-score" />
      </div>
    </div>

    <div class="actions">
      <el-button size="small" @click="resetDraft">恢复默认</el-button>
      <el-button size="small" type="primary" :disabled="!validation.valid" @click="save">保存配置</el-button>
    </div>
    <div v-if="savedTip" class="saved-tip">✅ 已保存，下次进入页面仍沿用此配置</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTradingStore } from '../store/trading'
import { validateHealthConfig, DEFAULT_HEALTH_CONFIG, type HealthConfig, type MetricTier } from '@/health/scoring'

const store = useTradingStore()
const draft = ref<HealthConfig>(structuredClone(toRawConfig()))
const savedTip = ref(false)

function toRawConfig(): HealthConfig {
  return JSON.parse(JSON.stringify(store.healthConfig))
}

// 其他面板修改配置后（理论上暂无）保持同步
watch(() => store.healthConfig, () => { draft.value = toRawConfig() }, { deep: false })

/** el-input 直接编辑：输入框留空即视为阈值为空（null），非法数字同样按 null 处理 */
function bindNumeric(t: MetricTier, field: 'min' | 'max') {
  return computed({
    get: () => (t[field] === null ? '' : String(t[field])),
    set: (v: string) => {
      if (v.trim() === '') t[field] = null
      else {
        const n = Number(v)
        t[field] = Number.isFinite(n) ? n : null
      }
    }
  })
}

// 为每个档位创建双向绑定代理（输入框字符串 ⇔ 配置中的 number|null）
const proxies = new WeakMap<MetricTier, { min: ReturnType<typeof bindNumeric>; max: ReturnType<typeof bindNumeric> }>()
function proxy(t: MetricTier, field: 'min' | 'max') {
  let p = proxies.get(t)
  if (!p) { p = { min: bindNumeric(t, 'min'), max: bindNumeric(t, 'max') }; proxies.set(t, p) }
  return p[field]
}

const validation = computed(() => validateHealthConfig(draft.value))

function resetDraft() {
  draft.value = structuredClone(DEFAULT_HEALTH_CONFIG)
  savedTip.value = false
}

function save() {
  // 归一化：el-input-number 清空会产生 undefined，统一落回数值，保证持久化结构完整
  const clone = JSON.parse(JSON.stringify(draft.value)) as HealthConfig
  for (const m of clone.metrics) {
    m.weight = Number.isFinite(m.weight) ? m.weight : 0
    for (const t of m.tiers) t.score = Number.isFinite(t.score) ? t.score : 0
  }
  store.updateHealthConfig(clone)
  savedTip.value = true
  setTimeout(() => (savedTip.value = false), 2500)
}
</script>

<style scoped>
.editor{margin-top:8px;border-top:1px dashed #1e2a5a;padding-top:8px}
.issue{font-size:11px;line-height:1.7;color:#fecaca}
.metric-block{margin-top:10px;background:#0a0e27;border-radius:6px;padding:8px}
.metric-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.metric-name{font-size:12px;color:#e2e8f0;font-weight:600;flex:1}
.metric-dir{font-size:10px;color:#64748b}
.w-input{width:90px}
.w-label{font-size:10px;color:#64748b}
.tier-head,.tier-row{display:grid;grid-template-columns:56px 1fr 1fr 64px;gap:6px;align-items:center}
.tier-head{font-size:10px;color:#64748b;margin-bottom:4px}
.tier-row{margin-bottom:4px}
.tier-head span:nth-child(n+2){text-align:center}
.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
.saved-tip{font-size:11px;color:#22c55e;margin-top:6px;text-align:right}
</style>
