# MultiMa Strategy V2
# Author: @Mablue (Masoud Azizi)
# github: https://github.com/mablue/

# --- Do not remove these libs ---
from freqtrade.strategy import IntParameter, IStrategy
from pandas import DataFrame

# --------------------------------

# Add your lib to import here
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib
from functools import reduce
import pandas as pd


class MultiMa(IStrategy):
    # 111/2000:     18 trades. 12/4/2 Wins/Draws/Losses. Avg profit   9.72%. Median profit   3.01%. Total profit  733.01234143 USDT (  73.30%). Avg duration 2 days, 18:40:00 min. Objective: 1.67048

    INTERFACE_VERSION: int = 3
    # Buy hyperspace params:
    buy_params = {
        "buy_ma_count": 4,
        "buy_ma_gap": 15,
    }

    # Sell hyperspace params:
    sell_params = {
        "sell_ma_count": 12,
        "sell_ma_gap": 68,
    }

    # ROI table:
    minimal_roi = {
        "0": 0.08,
        "30": 0.04,
        "60": 0.02,
        "120": 0,
    }

    # Stoploss:
    stoploss = -0.345

    # Trailing stop:
    trailing_stop = False  # value loaded from strategy
    trailing_stop_positive = None  # value loaded from strategy
    trailing_stop_positive_offset = 0.0  # value loaded from strategy
    trailing_only_offset_is_reached = False  # value loaded from strategy

    # Opimal Timeframe
    timeframe = "4h"

    count_max = 20
    gap_max = 100

    buy_ma_count = IntParameter(1, count_max, default= 7, space="buy")
    buy_ma_gap = IntParameter(1, gap_max, default= 7, space="buy")

    sell_ma_count = IntParameter(1, count_max, default= 7, space="sell")
    sell_ma_gap = IntParameter(1, gap_max, default= 94, space="sell")

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Pre-compute all possible MAs to avoid look-ahead bias
        max_periods = self.count_max * self.gap_max
        
        new_cols = {}
        for p in range(2, max_periods + 1):
            if p not in dataframe.columns:
                new_cols[p] = ta.TEMA(dataframe, timeperiod=p)
        
        if new_cols:
            dataframe = pd.concat([dataframe, pd.DataFrame(new_cols)], axis=1)
        
        # Add volatility filter
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        dataframe['volatility_regime'] = (dataframe['atr'] / dataframe['close']).rolling(50).mean()
        
        # Add trend filter
        dataframe['ema_200'] = ta.EMA(dataframe, timeperiod=200)
        dataframe['price_position'] = dataframe['close'] / dataframe['ema_200']
        
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        conditions = []
        
        # Only enter in favorable volatility regime
        volatility_condition = dataframe['volatility_regime'] < dataframe['volatility_regime'].rolling(100).quantile(0.8)
        
        # Only enter in uptrend
        trend_condition = dataframe['price_position'] > 1.0
        
        ma_conditions = []
        for ma_count in range(1, self.buy_ma_count.value + 1):  # Fixed range
            key = ma_count * self.buy_ma_gap.value
            past_key = (ma_count - 1) * self.buy_ma_gap.value
            if past_key > 1 and key in dataframe.columns and past_key in dataframe.columns:
                ma_conditions.append(dataframe[key] < dataframe[past_key])
        
        if ma_conditions:
            ma_condition = reduce(lambda x, y: x & y, ma_conditions)
            dataframe.loc[volatility_condition & trend_condition & ma_condition, "enter_long"] = 1
        
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        conditions = []
        
        # Exit conditions - more robust than simple OR
        for ma_count in range(1, self.sell_ma_count.value + 1):  # Fixed range
            key = ma_count * self.sell_ma_gap.value
            past_key = (ma_count - 1) * self.sell_ma_gap.value
            if past_key > 1 and key in dataframe.columns and past_key in dataframe.columns:
                conditions.append(dataframe[key] > dataframe[past_key])
        
        # Add stoploss exit
        stoploss_condition = (dataframe['close'] < dataframe['close'].shift(1) * (1 + self.stoploss))
        
        if conditions:
            ma_exit = reduce(lambda x, y: x | y, conditions)
            # Exit on either technical signal OR stoploss
            dataframe.loc[ma_exit | stoploss_condition, "exit_long"] = 1
        
        return dataframe
