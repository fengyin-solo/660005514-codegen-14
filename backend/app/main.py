import asyncio, time, random, math, json, threading
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Grid Trading Engine")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ACTIVE_CLIENTS = []
SIM_RUNNING = True
current_price = 100.0
ticks_history = []

class GridConfig(BaseModel):
    lowerPrice: float = 95
    upperPrice: float = 115
    gridCount: int = 20
    capitalPerGrid: float = 1000
    initialCapital: float = 100000
    period: int = 0  # 统计周期（最近 N 根价格），0 表示全部


# 固定模拟路径，保证切换统计周期时同一份行情可复现
def _simulated_prices():
    rng = random.Random(42)
    prices = [100.0]
    for _ in range(199):
        prices.append(max(70, min(140, prices[-1] + rng.gauss(0, 1.2))))
    return prices


def simulate_market():
    global current_price, ticks_history
    price = 100.0
    while SIM_RUNNING:
        drift = 0.005 * math.sin(time.time() * 0.05)
        price += random.gauss(drift, 0.3)
        price = max(80, min(130, price))
        current_price = price
        tick = {
            "time": time.strftime("%H:%M:%S"),
            "price": round(price, 2),
            "bid": round(price - random.uniform(0.01, 0.05), 2),
            "ask": round(price + random.uniform(0.01, 0.05), 2),
            "volume": random.randint(100, 5000)
        }
        ticks_history.append(tick)
        if len(ticks_history) > 200:
            ticks_history = ticks_history[-200:]

        # Order book
        bids = [[round(price - 0.01 * i, 2), random.randint(100, 1000)] for i in range(1, 11)]
        asks = [[round(price + 0.01 * i, 2), random.randint(100, 1000)] for i in range(1, 11)]
        order_book = {"bids": bids, "asks": asks, "midPrice": price, "spread": round(asks[0][0] - bids[0][0], 2)}

        payload = json.dumps({"ticks": ticks_history[-60:], "orderBook": order_book})
        for ws in ACTIVE_CLIENTS:
            try: asyncio.run_coroutine_threadsafe(ws.send_text(payload), asyncio.get_event_loop())
            except: pass
        time.sleep(0.5)


@app.on_event("startup")
async def startup():
    threading.Thread(target=simulate_market, daemon=True).start()


@app.post("/api/backtest")
def run_backtest(config: GridConfig):
    step = (config.upperPrice - config.lowerPrice) / config.gridCount
    grid_prices = [config.lowerPrice + i * step for i in range(config.gridCount + 1)]

    # Simulate prices（固定路径，与周期无关）
    prices = _simulated_prices()

    buy_grids = {}  # price -> True (buy order placed)
    orders = []
    cash = config.initialCapital
    holdings = 0
    equity_curve = [cash]
    step_orders = [[]]  # 每个价格点新增的成交，与 equity_curve 对齐
    order_id = 0

    for p in prices:
        filled = []
        for gp in grid_prices:
            # Buy signal
            if p <= gp and gp not in buy_grids and cash >= config.capitalPerGrid:
                qty = config.capitalPerGrid / gp
                cash -= config.capitalPerGrid
                holdings += qty
                buy_grids[gp] = True
                order_id += 1
                o = {"id": order_id, "price": round(gp, 2), "side": "BUY", "quantity": round(qty, 2), "status": "FILLED", "profit": 0}
                orders.append(o); filled.append(o)

            # Sell signal
            upper_gp = gp + step * 0.5
            if p >= upper_gp and gp in buy_grids:
                qty = config.capitalPerGrid / gp
                buy_price = gp
                sell_price = gp + step * 0.5
                profit = qty * (sell_price - buy_price)
                cash += config.capitalPerGrid + profit
                holdings -= qty
                del buy_grids[gp]
                order_id += 1
                o = {"id": order_id, "price": round(sell_price, 2), "side": "SELL", "quantity": round(qty, 2), "status": "FILLED", "profit": round(profit, 2)}
                orders.append(o); filled.append(o)

        equity = cash + holdings * p
        equity_curve.append(round(equity, 2))
        step_orders.append(filled)

    total_profit = cash + holdings * prices[-1] - config.initialCapital
    return_rate = (total_profit / config.initialCapital) * 100

    # Sharpe ratio
    eq_returns = np.diff(equity_curve) / np.array(equity_curve[:-1] + 1e-5)
    sharpe = float(np.mean(eq_returns) / max(np.std(eq_returns), 1e-5) * np.sqrt(252)) if len(eq_returns) > 1 else 0

    # Max drawdown
    peak = equity_curve[0]
    max_dd = 0.0
    for e in equity_curve:
        if e > peak: peak = e
        dd = (peak - e) / peak * 100
        max_dd = max(max_dd, dd)

    # Win rate
    wins = sum(1 for o in orders if o["profit"] > 0)
    total = len([o for o in orders if o["side"] == "SELL"])
    win_rate = (wins / total * 100) if total > 0 else 0

    # ---- 统计周期内的健康度原始指标（评分阈值与权重在前端配置中）----
    n = config.period if config.period and config.period > 0 else len(prices)
    n = min(n, len(prices))
    start = len(prices) - n
    slice_prices = prices[start:]
    slice_eq = equity_curve[start:start + n + 1]
    slice_orders = [o for i in range(start + 1, start + n + 1) for o in step_orders[i]]

    # 行情覆盖率：周期内价格落在网格区间内的比例
    in_range = sum(1 for p in slice_prices if config.lowerPrice <= p <= config.upperPrice)
    coverage = in_range / len(slice_prices) * 100 if slice_prices else 0.0

    # 成交完成率：周期内卖出（完成一轮）占买入挂单的比例
    slice_buys = sum(1 for o in slice_orders if o["side"] == "BUY")
    slice_sells = sum(1 for o in slice_orders if o["side"] == "SELL")
    completion = min(slice_sells / slice_buys * 100, 100.0) if slice_buys > 0 else 0.0

    # 回撤幅度：周期内权益曲线相对峰值的最大回撤
    slice_peak = slice_eq[0] if slice_eq else cash
    period_dd = 0.0
    for e in slice_eq:
        if e > slice_peak: slice_peak = e
        period_dd = max(period_dd, (slice_peak - e) / slice_peak * 100 if slice_peak else 0.0)

    return {
        "orders": orders,
        "totalProfit": round(total_profit, 2),
        "returnRate": round(return_rate, 2),
        "sharpeRatio": round(sharpe, 2),
        "maxDrawdown": round(max_dd, 2),
        "winRate": round(win_rate, 1),
        "equityCurve": equity_curve,
        "period": n,
        "healthRaw": {
            "coverage": round(coverage, 2),
            "completion": round(completion, 2),
            "drawdown": round(period_dd, 2)
        }
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    ACTIVE_CLIENTS.append(ws)
    try:
        while True: await ws.receive_text()
    except: 
        if ws in ACTIVE_CLIENTS: ACTIVE_CLIENTS.remove(ws)