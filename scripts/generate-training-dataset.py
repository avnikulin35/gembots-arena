#!/usr/bin/env python3
"""
Generate a fine-tuning dataset for Mistral 12B from Bybit 1-minute candles.
Outputs ChatML-format JSONL for trading direction prediction (15-min horizon).

Each example:
- Input: last 60 candles (1h of 1-min OHLCV) + computed indicators
- Output: BUY/SELL/HOLD with reasoning

Labels based on actual price movement 15 minutes later:
- BUY: price went up >0.3%
- SELL: price went down >0.3%  
- HOLD: price moved <0.3%
"""

import json
import os
import sys
import random
import numpy as np
from pathlib import Path
from datetime import datetime

DATA_DIR = Path(__file__).parent.parent / "data" / "candles"
OUT_DIR = Path(__file__).parent.parent / "data"
WINDOW = 60        # 60 candles lookback (1 hour)
HORIZON = 15       # 15 minutes forward
THRESHOLD = 0.003  # 0.3% threshold for BUY/SELL
STEP = 2           # sample every 2 minutes for more data
SEED = 42

random.seed(SEED)
np.random.seed(SEED)

SYSTEM_PROMPT = """You are an expert crypto trading AI for GemBots Arena Trading League. 
Analyze the provided 1-hour of 1-minute candle data and predict the price direction over the next 15 minutes.
Respond with your prediction: BUY (price will rise >0.3%), SELL (price will drop >0.3%), or HOLD (sideways <0.3%).
Include your confidence (low/medium/high) and brief reasoning based on the technical pattern."""


def load_candles(filepath):
    """Load candles from JSON file. Bybit format: [timestamp, open, high, low, close, volume, turnover]"""
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    candles = []
    for c in data:
        if isinstance(c, dict):
            candles.append({
                'ts': int(c['ts']),
                'open': float(c['open']),
                'high': float(c['high']),
                'low': float(c['low']),
                'close': float(c['close']),
                'volume': float(c.get('volume', 0)),
                'turnover': float(c.get('turnover', 0))
            })
        else:
            candles.append({
                'ts': int(c[0]),
                'open': float(c[1]),
                'high': float(c[2]),
                'low': float(c[3]),
                'close': float(c[4]),
                'volume': float(c[5]),
                'turnover': float(c[6]) if len(c) > 6 else 0
            })
    
    # Sort by timestamp ascending
    candles.sort(key=lambda x: x['ts'])
    return candles


def compute_rsi(closes, period=14):
    """Compute RSI from close prices."""
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def compute_ema(data, period):
    """Compute EMA."""
    if len(data) < period:
        return data[-1] if data else 0
    multiplier = 2.0 / (period + 1)
    ema = data[0]
    for price in data[1:]:
        ema = (price - ema) * multiplier + ema
    return ema


def compute_macd(closes):
    """Compute MACD line (EMA12 - EMA26)."""
    if len(closes) < 26:
        return 0.0
    ema12 = compute_ema(closes, 12)
    ema26 = compute_ema(closes, 26)
    return ema12 - ema26


def compute_bollinger_position(closes, period=20):
    """Where is price relative to Bollinger Bands? Returns -1 to 1."""
    if len(closes) < period:
        return 0.0
    recent = closes[-period:]
    mean = np.mean(recent)
    std = np.std(recent)
    if std == 0:
        return 0.0
    return (closes[-1] - mean) / (2 * std)


def compute_vwap(candles_window):
    """Compute VWAP."""
    total_pv = sum(c['close'] * c['volume'] for c in candles_window)
    total_vol = sum(c['volume'] for c in candles_window)
    if total_vol == 0:
        return candles_window[-1]['close']
    return total_pv / total_vol


def format_candle_data(candles_window, symbol):
    """Format candle data as compact text for the model."""
    closes = [c['close'] for c in candles_window]
    volumes = [c['volume'] for c in candles_window]
    
    # Current price info
    current = candles_window[-1]
    price_1h_ago = candles_window[0]['close']
    price_30m_ago = candles_window[30]['close'] if len(candles_window) > 30 else candles_window[0]['close']
    price_15m_ago = candles_window[45]['close'] if len(candles_window) > 45 else candles_window[-15]['close']
    price_5m_ago = candles_window[-5]['close']
    
    change_1h = ((current['close'] - price_1h_ago) / price_1h_ago) * 100
    change_30m = ((current['close'] - price_30m_ago) / price_30m_ago) * 100
    change_15m = ((current['close'] - price_15m_ago) / price_15m_ago) * 100
    change_5m = ((current['close'] - price_5m_ago) / price_5m_ago) * 100
    
    # Technical indicators
    rsi = compute_rsi(closes)
    macd = compute_macd(closes)
    bb_pos = compute_bollinger_position(closes)
    vwap = compute_vwap(candles_window)
    vwap_diff = ((current['close'] - vwap) / vwap) * 100
    
    # Volume analysis
    avg_vol = np.mean(volumes)
    recent_vol = np.mean(volumes[-5:])
    vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1.0
    
    # Price range
    high_1h = max(c['high'] for c in candles_window)
    low_1h = min(c['low'] for c in candles_window)
    range_pct = ((high_1h - low_1h) / low_1h) * 100
    
    # Recent candle patterns (last 5 candles as compact OHLCV)
    last5 = candles_window[-5:]
    candle_str = " | ".join([
        f"O:{c['open']:.2f} H:{c['high']:.2f} L:{c['low']:.2f} C:{c['close']:.2f} V:{c['volume']:.0f}"
        for c in last5
    ])
    
    dt = datetime.utcfromtimestamp(current['ts'] / 1000)
    
    text = f"""Token: {symbol.replace('USDT', '')}
Time: {dt.strftime('%Y-%m-%d %H:%M')} UTC
Price: ${current['close']:.2f}
Changes: 5m={change_5m:+.3f}%, 15m={change_15m:+.3f}%, 30m={change_30m:+.3f}%, 1h={change_1h:+.3f}%
RSI(14): {rsi:.1f}
MACD: {macd:.4f}
Bollinger: {bb_pos:.3f} (position -1 to 1)
VWAP diff: {vwap_diff:+.3f}%
Volume ratio (5m/1h avg): {vol_ratio:.2f}x
1h range: {range_pct:.3f}%
1h high: ${high_1h:.2f}, low: ${low_1h:.2f}
Last 5 candles (1min):
{candle_str}"""
    
    return text


def determine_label(current_price, future_price):
    """Determine BUY/SELL/HOLD based on price change."""
    change = (future_price - current_price) / current_price
    if change > THRESHOLD:
        return "BUY", change
    elif change < -THRESHOLD:
        return "SELL", change
    else:
        return "HOLD", change


def generate_response(label, change, symbol):
    """Generate a natural language response for the prediction."""
    pct = change * 100
    abs_pct = abs(pct)
    token = symbol.replace('USDT', '')
    
    if abs_pct > 1.0:
        confidence = "high"
    elif abs_pct > 0.5:
        confidence = "medium"
    else:
        confidence = "low"
    
    if label == "BUY":
        reasons = [
            f"Bullish momentum detected. {token} showing upward pressure.",
            f"Technical indicators suggest upside potential for {token}.",
            f"Buy signal: price action and volume support upward move.",
            f"Momentum shifting bullish. Entry opportunity for {token}.",
            f"Price structure suggests continuation to the upside.",
        ]
    elif label == "SELL":
        reasons = [
            f"Bearish pressure building. {token} likely to drop.",
            f"Sell signal: weakening momentum and negative divergence.",
            f"Technical breakdown forming. Expect downside for {token}.",
            f"Distribution pattern detected. Short-term bearish outlook.",
            f"Price failing to hold support levels. Downside probable.",
        ]
    else:
        reasons = [
            f"Sideways consolidation expected. No clear directional bias.",
            f"Range-bound conditions. Wait for breakout confirmation.",
            f"Indecisive price action. Hold and monitor for setup.",
            f"Low volatility period. No strong signal in either direction.",
            f"Choppy market conditions. Best to stay flat.",
        ]
    
    reason = random.choice(reasons)
    multiplier = 1.0 + change
    
    return f"{label}. Prediction: {multiplier:.4f}x ({pct:+.2f}%). {reason} Confidence: {confidence}."


def main():
    symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    all_examples = []
    stats = {'BUY': 0, 'SELL': 0, 'HOLD': 0}
    
    for symbol in symbols:
        filepath = DATA_DIR / f"{symbol}_1m.json"
        if not filepath.exists():
            print(f"⚠️ {filepath} not found, skipping")
            continue
        
        print(f"📊 Processing {symbol}...")
        candles = load_candles(filepath)
        print(f"   Loaded {len(candles)} candles")
        
        count = 0
        for i in range(WINDOW, len(candles) - HORIZON, STEP):
            window = candles[i - WINDOW:i]
            current_price = candles[i]['close']
            future_price = candles[i + HORIZON]['close']
            
            label, change = determine_label(current_price, future_price)
            
            input_text = format_candle_data(window, symbol)
            output_text = generate_response(label, change, symbol)
            
            example = {
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": input_text},
                    {"role": "assistant", "content": output_text}
                ]
            }
            
            all_examples.append(example)
            stats[label] += 1
            count += 1
        
        print(f"   Generated {count} examples")
    
    # Shuffle
    random.shuffle(all_examples)
    
    # Split 90/10
    split = int(len(all_examples) * 0.9)
    train = all_examples[:split]
    val = all_examples[split:]
    
    # Undersample HOLD to balance classes better
    # Count each class in train
    train_by_label = {'BUY': [], 'SELL': [], 'HOLD': []}
    for ex in train:
        label = ex['messages'][2]['content'].split('.')[0]
        train_by_label[label].append(ex)
    
    max_buy_sell = max(len(train_by_label['BUY']), len(train_by_label['SELL']))
    hold_target = int(max_buy_sell * 1.2)  # Allow slightly more HOLD but not overwhelming
    
    if len(train_by_label['HOLD']) > hold_target:
        train_by_label['HOLD'] = random.sample(train_by_label['HOLD'], hold_target)
    
    balanced_train = train_by_label['BUY'] + train_by_label['SELL'] + train_by_label['HOLD']
    random.shuffle(balanced_train)
    
    # Write files
    train_path = OUT_DIR / "finetune-train.jsonl"
    val_path = OUT_DIR / "finetune-val.jsonl"
    
    with open(train_path, 'w') as f:
        for ex in balanced_train:
            f.write(json.dumps(ex) + '\n')
    
    with open(val_path, 'w') as f:
        for ex in val:
            f.write(json.dumps(ex) + '\n')
    
    print(f"\n✅ Dataset generated!")
    print(f"   Train: {len(balanced_train)} examples → {train_path}")
    print(f"   Val: {len(val)} examples → {val_path}")
    print(f"\n📊 Label distribution (before balancing):")
    for label, count in stats.items():
        print(f"   {label}: {count} ({count/sum(stats.values())*100:.1f}%)")
    print(f"\n📊 Balanced train distribution:")
    for label in ['BUY', 'SELL', 'HOLD']:
        print(f"   {label}: {len(train_by_label[label])}")


if __name__ == '__main__':
    main()
