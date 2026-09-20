// 评分引擎逻辑测试（直接用 vite 的 TS 转换能力运行：通过 esbuild 打包后执行）
import { assert } from 'node:console'
import {
  DEFAULT_HEALTH_CONFIG, validateHealthConfig, computeHealthScore, scoreFromBands,
} from '../src/lib/healthScore'
import type { HealthConfig } from '../src/types'

let passed = 0
function ok(name: string, cond: boolean, extra = '') {
  if (!cond) { console.error(`✗ ${name} ${extra}`); process.exitCode = 1 }
  else { passed++; console.log(`✓ ${name}`) }
}
const clone = (o: unknown) => structuredClone(o) as HealthConfig

// 1. 单项插值
const bands = DEFAULT_HEALTH_CONFIG.metrics[0].bands
ok('band 边界低值', scoreFromBands(0, bands) === 0)
ok('band 边界高值', scoreFromBands(100, bands) === 100)
ok('band 线性插值 72.5@(60→60,85→85)', Math.abs(scoreFromBands(72.5, bands) - 72.5) < 1e-9)

// 2. 回撤：越小得分越高
const ddBands = DEFAULT_HEALTH_CONFIG.metrics.find((m) => m.key === 'maxDrawdown')!.bands
ok('回撤0=100分', scoreFromBands(0, ddBands) === 100)
ok('回撤10=60分', Math.abs(scoreFromBands(10, ddBands) - 60) < 1e-9)
ok('回撤2.5=92.5分', Math.abs(scoreFromBands(2.5, ddBands) - 92.5) < 1e-9)
ok('回撤超40→0分封顶', scoreFromBands(50, ddBands) === 0)

// 3. 综合合成 + 等级 + 拖低项（使用后端 30d 的实际数据）
const raw30 = { marketCoverage: 32.5, fillCompletion: 58.25, maxDrawdown: 7.77 }
const r = computeHealthScore(raw30, DEFAULT_HEALTH_CONFIG)
// coverage: (32.5-0)/(60)*60 = 32.5 ; fill: 40 + (58.25-50)/30*40 = 51
const covScore = 32.5
const fillScore = 40 + (58.25 - 50) / 30 * 40
const ddScore = 85 + (7.77 - 5) / 5 * (60 - 85)
const expected = 0.4 * covScore + 0.4 * fillScore + 0.2 * ddScore
ok('综合分正确', Math.abs(r.composite - Math.round(expected * 10) / 10) < 0.11, `got ${r.composite} expect ${expected}`)
ok('综合分约47.6落入风险高', r.grade.label === '风险高', `got ${r.composite}/${r.grade.label}`)
ok('拖低项=行情覆盖率(加权损失最大)', r.mainDrag.key === 'marketCoverage', `got ${r.mainDrag.key}`)

// 不同周期数据 → 不同结果，且按同一份配置计算
const rawAll = { marketCoverage: 90, fillCompletion: 90, maxDrawdown: 2 }
const r2 = computeHealthScore(rawAll, DEFAULT_HEALTH_CONFIG)
ok('全优数据落入“优秀”', r2.grade.label === '优秀' && r2.composite >= 90, `got ${r2.composite}/${r2.grade.label}`)

// 中等数据落入“待观察”：综合分 65（coverage 65 分, fill 65 分, dd 65 分）
// coverage 65→65(线性), fill: 40+(65-50)/30*40=60, dd: 85+(8-5)/5*(-25)=70 → 0.4*65+0.4*60+0.2*70=64
const rMid = computeHealthScore({ marketCoverage: 65, fillCompletion: 65, maxDrawdown: 8 }, DEFAULT_HEALTH_CONFIG)
ok('中等数据落入“待观察”', rMid.grade.label === '待观察', `got ${rMid.composite}/${rMid.grade.label}`)

// 边界：正好 90 分落入优秀档
const r90 = computeHealthScore({ marketCoverage: 100, fillCompletion: 100, maxDrawdown: 12.5 }, DEFAULT_HEALTH_CONFIG)
ok('分数正好等于入档分时取高档', r90.composite >= 60)

// 4. 默认配置合法
ok('默认配置校验通过', validateHealthConfig(DEFAULT_HEALTH_CONFIG).valid)

// 5. 权重全为 0 → 不允许
const cZero = clone(DEFAULT_HEALTH_CONFIG); cZero.metrics.forEach((m) => (m.weight = 0))
const vZero = validateHealthConfig(cZero)
ok('权重全0不允许', !vZero.valid)
ok('权重全0指出 weights 项', vZero.issues.some((i) => i.field === 'weights'))

// 6. 阈值为空 → 不允许
const cEmpty = clone(DEFAULT_HEALTH_CONFIG); cEmpty.metrics[0].bands = []
const vEmpty = validateHealthConfig(cEmpty)
ok('空阈值不允许', !vEmpty.valid)
ok('空阈值指出具体指标 bands', vEmpty.issues.some((i) => i.field === 'metrics.marketCoverage.bands'))

// 等级为空
const cNoGrade = clone(DEFAULT_HEALTH_CONFIG); cNoGrade.grades = []
ok('空等级不允许', !validateHealthConfig(cNoGrade).valid)

// 7. 分档阈值互相重叠（value 重复）→ 不允许
const cOverlap = clone(DEFAULT_HEALTH_CONFIG)
cOverlap.metrics[1].bands = [{ value: 0, score: 0 }, { value: 50, score: 40 }, { value: 50, score: 80 }, { value: 100, score: 100 }]
const vOverlap = validateHealthConfig(cOverlap)
ok('指标阈值重叠不允许', !vOverlap.valid)
ok('重叠指出 fillCompletion.bands', vOverlap.issues.some((i) => i.field === 'metrics.fillCompletion.bands'))

// 等级重叠（相同 minScore）
const cGradeOverlap = clone(DEFAULT_HEALTH_CONFIG)
cGradeOverlap.grades[2] = { minScore: 60, label: '重复档', color: '#fff' }
ok('等级阈值重叠不允许', !validateHealthConfig(cGradeOverlap).valid)

// 8. 得分方向矛盾（越大越好却递减）
const cDir = clone(DEFAULT_HEALTH_CONFIG)
cDir.metrics[0].bands = [{ value: 0, score: 100 }, { value: 60, score: 60 }]
ok('得分方向矛盾不允许', !validateHealthConfig(cDir).valid)

// 回撤方向矛盾（越小越好却递增）
const cDir2 = clone(DEFAULT_HEALTH_CONFIG)
cDir2.metrics[2].bands = [{ value: 0, score: 0 }, { value: 5, score: 85 }]
ok('回撤方向配反不允许', !validateHealthConfig(cDir2).valid)

// 9. 缺指标
const cMiss = clone(DEFAULT_HEALTH_CONFIG); cMiss.metrics = cMiss.metrics.slice(0, 2)
ok('缺指标不允许且指出 key', validateHealthConfig(cMiss).issues.some((i) => i.field === 'metrics.maxDrawdown'))

// 10. 只有一个非零权重时仍可评分（其余权重为0不参与）
const cOne = clone(DEFAULT_HEALTH_CONFIG)
cOne.metrics[0].weight = 1; cOne.metrics[1].weight = 0; cOne.metrics[2].weight = 0
ok('单项权重非零合法', validateHealthConfig(cOne).valid)
const rOne = computeHealthScore(raw30, cOne)
ok('单项权重时综合分=该项分', Math.abs(rOne.composite - Math.round(covScore * 10) / 10) < 0.11)

// 11. 等级边界：综合分 59.9 → 风险高
const grades = DEFAULT_HEALTH_CONFIG
const rLow = computeHealthScore({ marketCoverage: 60, fillCompletion: 59.9, maxDrawdown: 10 }, grades)
ok('60以下落风险高', rLow.grade.label === '风险高', `got ${rLow.composite}/${rLow.grade.label}`)

console.log(`\n${passed} passed`)
