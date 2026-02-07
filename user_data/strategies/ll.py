# MultiMa Strategy V2 - Enhanced
# Author: @Mablue (Masoud Azizi)
# github: https://github.com/mablue/

# --- Do not remove these libs ---
from freqtrade.strategy import IntParameter, IStrategy, CategoricalParameter
from pandas import DataFrame

# --------------------------------

# Add your lib to import here
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib
from functools import reduce
import pandas as pd
from numpy import nanmean


class ll(IStrategy):
    """
    MultiMa Strategy - Enhanced with RSI confirmation and trend filters.
    Uses multiple EMA crossovers for entry and exit signals.
    """

    INTERFACE_VERSION: int = 3

    # Buy hyperspace params:
    buy_params = {
        "buy_ma_count": 4,
        "buy_ma_gap": 15,
        "buy_rsi_threshold": 65,
        "buy_enable_rsi": True,
    }

    # Sell hyperspace params:
    sell_params = {
        "sell_ma_count": 12,
        "sell_ma_gap": 68,
        "sell_rsi_threshold": 35,
        "sell_enable_rsi": True,
    }

    # ROI table:
    minimal_roi = {
        "0": 0.523,
        "1553": 0.123,
        "2332": 0.076,
        "3169": 0
    }

    # Stoploss:
    stoploss = -0.25
    trailing_stop = True
    trailing_stop_positive = 0.05
    trailing_stop_positive_offset = 0.01
    trailing_only_offset_is_reached = True

    # Timeframe
    timeframe = "4h"

    # Strategy parameters
    count_max = 20
    gap_max = 100

    # Buy parameters
    buy_ma_count = IntParameter(1, count_max, default=7, space="buy")
    buy_ma_gap = IntParameter(5, gap_max, default=15, space="buy")
    buy_rsi_threshold = IntParameter(30, 70, default=65, space="buy")
    buy_enable_rsi = CategoricalParameter([True, False], default=True, space="buy")

    # Sell parameters
    sell_ma_count = IntParameter(1, count_max, default=12, space="sell")
    sell_ma_gap = IntParameter(20, gap_max, default=68, space="sell")
    sell_rsi_threshold = IntParameter(20, 50, default=35, space="sell")
    sell_enable_rsi = CategoricalParameter([True, False], default=True, space="sell")

    # Protection parameters
    cooldown_after_buy = CategoricalParameter([True, False], default=True)
    cooldown_period = IntParameter(1, 12, default=3, space="protection")

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """Calculate all indicators needed for the strategy."""
        # Calculate periods from buy/sell parameters
        periods = set()
        for ma_count in range(1, int(self.buy_ma_count.value) + 1):
            periods.add(ma_count * int(self.buy_ma_gap.value))
        for ma_count in range(1, int(self.sell_ma_count.value) + 1):
            periods.add(ma_count * int(self.sell_ma_gap.value))

        # Filter and sort periods
        periods = sorted([p for p in periods if p > 1])

        # Generate EMA columns
        new_cols = {}
        for p in periods:
            col_name = f"ema_{p}"
            if col_name not in dataframe.columns:
                new_cols[col_name] = ta.EMA(dataframe, timeperiod=int(p))

        # Add new columns
        if new_cols:
            dataframe = pd.concat([dataframe, pd.DataFrame(new_cols)], axis=1)

        # RSI indicator
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=14)

        # RSI-based indicators
        dataframe["rsi_ma"] = ta.SMA(dataframe["rsi"], timeperiod=7)

        # Bollinger Bands for volatility filter
        dataframe["bb_upper"], dataframe["bb_middle"], dataframe["bb_lower"] = ta.BBANDS(
            dataframe, timeperiod=20, nbdevup=2, nbdevdn=2
        )
        dataframe["bb_width"] = (dataframe["bb_upper"] - dataframe["bb_lower"]) / dataframe["bb_middle"]

        # ATR for volatility measurement
        dataframe["atr"] = ta.ATR(dataframe, timeperiod=14)

        # Volume indicators
        dataframe["volume_ma"] = ta.SMA(dataframe["volume"], timeperiod=20)
        dataframe["volume_ratio"] = dataframe["volume"] / dataframe["volume_ma"]

        # Trend strength using ADX
        dataframe["adx"] = ta.ADX(dataframe, timeperiod=14)
        dataframe["plus_di"] = ta.PLUS_DI(dataframe, timeperiod=14)
        dataframe["minus_di"] = ta.MINUS_DI(dataframe, timeperiod=14)

        # Cooldown indicator
        dataframe["cooldown"] = 0

        print(f"Processing: {metadata['pair']}")

        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Buy signal logic:
        1. EMA crossover: shorter EMA below longer EMA (bullish setup)
        2. RSI confirmation (optional)
        3. Price above middle Bollinger Band
        4. Strong trend (ADX > 20)
        """
        dataframe.loc[:, "enter_long"] = 0

        # EMA crossover conditions
        ema_conditions = []
        for ma_count in range(1, self.buy_ma_count.value + 1):
            key = ma_count * self.buy_ma_gap.value
            past_key = (ma_count - 1) * self.buy_ma_gap.value
            if past_key > 1 and f"ema_{key}" in dataframe.columns and f"ema_{past_key}" in dataframe.columns:
                ema_conditions.append(dataframe[f"ema_{key}"] < dataframe[f"ema_{past_key}"])

        # RSI condition (optional)
        rsi_condition = True
        if self.buy_enable_rsi.value:
            rsi_condition = dataframe["rsi"] < self.buy_rsi_threshold.value

        # Trend condition (ADX > 20 indicates trending market)
        trend_condition = dataframe["adx"] > 20

        # Volatility condition (not too wide BB)
        volatility_condition = dataframe["bb_width"] < 0.1

        # Volume condition (reasonable volume)
        volume_condition = dataframe["volume_ratio"] > 0.5

        # Combine all conditions
        if ema_conditions:
            all_conditions = ema_conditions + [
                rsi_condition,
                trend_condition,
                volatility_condition,
                volume_condition,
            ]
            dataframe.loc[
                reduce(lambda x, y: x & y, all_conditions),
                "enter_long"
            ] = 1

        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Sell signal logic:
        1. Reverse EMA crossover: shorter EMA above longer EMA
        2. RSI confirmation (optional)
        3. Price below middle Bollinger Band
        4. Weakening trend
        """
        dataframe.loc[:, "exit_long"] = 0

        # Reverse EMA crossover conditions
        ema_conditions = []
        for ma_count in range(1, self.sell_ma_count.value + 1):
            key = ma_count * self.sell_ma_gap.value
            past_key = (ma_count - 1) * self.sell_ma_gap.value
            if past_key > 1 and f"ema_{key}" in dataframe.columns and f"ema_{past_key}" in dataframe.columns:
                ema_conditions.append(dataframe[f"ema_{key}"] > dataframe[f"ema_{past_key}"])

        # RSI condition (optional)
        rsi_condition = True
        if self.sell_enable_rsi.value:
            rsi_condition = dataframe["rsi"] > self.sell_rsi_threshold.value

        # Trend weakening (plus_di crossing below minus_di)
        trend_condition = dataframe["plus_di"] < dataframe["minus_di"]

        # Price below middle Bollinger Band
        bb_condition = dataframe["close"] < dataframe["bb_middle"]

        # Combine all conditions
        if ema_conditions:
            all_conditions = ema_conditions + [
                rsi_condition,
                trend_condition,
                bb_condition,
            ]
            dataframe.loc[
                reduce(lambda x, y: x & y, all_conditions),
                "exit_long"
            ] = 1

        return dataframe
