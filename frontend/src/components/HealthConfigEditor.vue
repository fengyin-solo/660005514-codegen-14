<template>
  <el-dialog v-model="open" title="健康度评分配置" width="560px" append-to-body
    @open="onOpen">
    <el-tabs v-model="tab">
      <!-- 指标权重与分档阈值 -->
      <el-tab-pane v-for="m in draft.metrics" :key="m.key" :label="m.label" :name="m.key">
        <el-form label-width="110px" size="small">
          <el-form-item label="指标权重">
            <el-input-number v-model="m.weight" :min="0" :max="1" :step="0.05" :precision="2" />
            <span class="hint">综合分按三项权重归一化后加权合成；三项不可同时为 0</span>
          </el-form-item>
          <el-form-item label="评分方向">
            <el-tag size="small" :type="m.higherBetter ? 'success' : 'warning'">
              {{ m.higherBetter ? '原始值越大得分越高' : '原始值越小得分越高（回撤）' }}
            </el-tag>
          </el-form-item>
          <el-form-item label="分档阈值">
            <div class="band-table">
              <div class="band-head"><span>原始阈值</span><span>对应得分(0~100)</span><span></span></div>
              <div v-for="(b, i) in m.bands" :key="i" class="band-row">
                <el-input-number v-model="b.value" :step="1" controls-position="right" class="band-input" />
                <el-input-number v-model="b.score" :min="0" :max="100" :step="10" controls-position="right" class="band-input" />
                <el-button size="small" type="danger" text @click="m.bands.splice(i, 1)">删除</el-button>
              </div>
              <el-button size="small" @click="m.bands.push({ value: 0, score: 0 })">+ 增加断点</el-button>
              <div class="hint">断点按阈值升序线性插值打分；阈值不能为空，也不能互相重叠</div>
            </div>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 综合分等级 -->
      <el-tab-pane label="综合分等级" name="grades">
        <div class="band-table">
          <div class="band-head"><span>入档最低分</span><span>等级名称</span><span>颜色</span><span></span></div>
          <div v-for="(g, i) in draft.grades" :key="i" class="band-row">
            <el-input-number v-model="g.minScore" :min="0" :max="100" :step="5" controls-position="right" class="band-input" />
            <el-input v-model="g.label" class="band-input" />
            <el-color-picker v-model="g.color" />
            <el-button size="small" type="danger" text @click="draft.grades.splice(i, 1)">删除</el-button>
          </div>
          <el-button size="small" @click="draft.grades.push({ minScore: 50, label: '新等级', color: '#94a3b8' })">
            + 增加等级
          </el-button>
          <div class="hint">综合分达到「入档最低分」即落入该等级；各档入档分必须严格递增，不得重叠</div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 校验未通过：列出需要调整的项 -->
    <el-alert v-if="!check.valid" type="error" :closable="false" show-icon class="check-box"
      title="以下配置项需调整后才能启用：">
      <ul class="issue-list">
        <li v-for="(it, i) in check.issues" :key="i"><code>{{ it.field }}</code>：{{ it.message }}</li>
      </ul>
    </el-alert>

    <template #footer>
      <el-button @click="resetDefault">恢复默认配置</el-button>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :disabled="!check.valid" @click="save">保存并启用</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useTradingStore } from '../store/trading'
import { validateHealthConfig, DEFAULT_HEALTH_CONFIG } from '../lib/healthScore'
import type { HealthConfig } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
const store = useTradingStore()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})
const tab = ref('marketCoverage')
const draft = ref<HealthConfig>(structuredClone(store.healthConfig))

const check = computed(() => validateHealthConfig(draft.value))

function onOpen() {
  draft.value = structuredClone(store.healthConfig)
  tab.value = draft.value.metrics[0]?.key ?? 'grades'
}

function save() {
  const { valid, issues } = validateHealthConfig(draft.value)
  if (!valid) {
    ElMessage.error(`配置未通过校验，请先调整 ${issues.length} 个配置项`)
    return
  }
  store.updateHealthConfig(structuredClone(draft.value))
  ElMessage.success('健康度配置已保存，各项评分已按新配置重算')
  open.value = false
}

function resetDefault() {
  draft.value = structuredClone(DEFAULT_HEALTH_CONFIG)
}
</script>

<style scoped>
.hint{font-size:11px;color:#64748b;margin-left:8px}
.band-table{width:100%}
.band-head{display:grid;grid-template-columns:120px 150px 60px 50px;gap:8px;font-size:11px;color:#64748b;padding:0 0 4px}
.band-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.band-input{width:130px}
.check-box{margin-top:8px}
.issue-list{margin:4px 0 0 16px;font-size:12px}
.issue-list code{color:#fca5a5;background:#0a0e27;padding:0 4px;border-radius:3px}
</style>
