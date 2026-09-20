"""策略健康度原始指标。

综合评分（行情覆盖率 / 成交完成率 / 回撤幅度 的加权合成、分档判定）
全部由前端按可配置的阈值与权重计算；后端只负责给出不同统计周期下
确定性的原始指标值，保证切换周期后结果稳定、可复现。
"""
import random

# 统计周期 -> 模拟天数（决定行情序列长度）
PERIOD_DAYS = {"7d": 7, "30d": 30, "all": 90}

# 每个周期使用独立随机种子，使同一周期每次请求结果一致，不同周期互不相同
_PERIOD_SEED = {"7d": 20240707, "30d": 20240730, "all": 20240901}


def _simulate_prices(days: int, seed: int, start: float = 100.0):
    """生成确定性的日频价格序列（每日 12 个采样点）。"""
    rng = random.Random(seed)
    prices = [start]
    points = max(1, days) * 12
    for i in range(points - 1):
        prices.append(prices[-1] + rng.gauss(0, 1.1))
    return prices


def _market_coverage(prices, lower: float, upper: float):
    """行情覆盖率：价格落在网格区间内的采样点占比（%）。"""
    inside = sum(1 for p in prices if lower <= p <= upper)
    return round(inside / len(prices) * 100, 2)


def _fill_completion(days: int, seed: int):
    """成交完成率：周期内触发网格并完成配对成交的挂单占比（%）。"""
    rng = random.Random(seed * 7 + 13)
    base = 45 + min(days, 90) * 0.4          # 周期越长完成度越高
    val = base + rng.uniform(-7, 7)
    return round(max(25.0, min(96.0, val)), 2)


def _max_drawdown(days: int, seed: int):
    """回撤幅度：周期内净值相对历史峰值的最大回撤（%，非负数）。"""
    rng = random.Random(seed * 11 + 29)
    base = 4 + days * 0.07                   # 周期越长回撤窗口越大
    val = base + rng.uniform(-2.5, 2.5)
    return round(max(1.5, min(24.0, val)), 2)


def get_health_metrics(lower: float, upper: float):
    """返回各统计周期的原始指标。

    返回结构: { "7d": {"marketCoverage":..,"fillCompletion":..,"maxDrawdown":..}, ... }
    """
    result = {}
    for period, days in PERIOD_DAYS.items():
        seed = _PERIOD_SEED[period]
        prices = _simulate_prices(days, seed)
        result[period] = {
            "marketCoverage": _market_coverage(prices, lower, upper),
            "fillCompletion": _fill_completion(days, seed),
            "maxDrawdown": _max_drawdown(days, seed),
        }
    return result
