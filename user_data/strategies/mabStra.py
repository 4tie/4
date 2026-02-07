# Author: @Mablue (Masoud Azizi)
# github: https://github.com/mablue/
# IMPORTANT: DO NOT USE IT WITHOUT HYPEROPT:
# freqtrade hyperopt --hyperopt-loss SharpeHyperOptLoss --spaces all --strategy mabStra --config config.json -e 100

# --- Do not remove these libs ---
from freqtrade.strategy import IntParameter, DecimalParameter, IStrategy
from pandas import DataFrame
# --------------------------------

# Add your lib to import here
import talib.abstract as ta


class mabStra(IStrategy):

    INTERFACE_VERSION: int = 3
    # #################### RESULTS PASTE PLACE ####################
    # ROI table:
    minimal_roi = {
        "0": 0.598,
        "644": 0.166,
        "3269": 0.115,
        "7289": 0
    }

    # Stoploss:
    stoploss = -0.05
    # Buy hypers
    timeframe = '4h'

    # #################### END OF RESULT PLACE ####################

    # buy params
    buy_mojo_ma_timeframe = IntParameter(2, 100, default=7, space='buy')
    buy_fast_ma_timeframe = IntParameter(2, 100, default=14, space='buy')
    buy_slow_ma_timeframe = IntParameter(2, 100, default=28, space='buy')
    buy_div_max = DecimalParameter(
        0, 2, decimals=4, default=2.25446, space='buy')
    buy_div_min = DecimalParameter(
        0, 2, decimals=4, default=0.29497, space='buy')
    # sell params
    sell_mojo_ma_timeframe = IntParameter(2, 100, default=7, space='sell')
    sell_fast_ma_timeframe = IntParameter(2, 100, default=14, space='sell')
    sell_slow_ma_timeframe = IntParameter(2, 100, default=28, space='sell')
    sell_div_max = DecimalParameter(
        0, 2, decimals=4, default=1.54593, space='sell')
    sell_div_min = DecimalParameter(
        0, 2, decimals=4, default=2.81436, space='sell')

    # Add this to populate_indicators
    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # ... existing code ...
    
        # Add ATR for dynamic stoploss
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
    
        # Add trend filter
        dataframe['trend'] = ta.SMA(dataframe, timeperiod=200)
    
        return dataframe

    # Modify stoploss parameter to be ATR-based


    # Modify populate_entry_trend
    # Add volume filter to entry logic
    # Add volume filter to entry logic
    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Calculate volume moving average
        volume_ma = ta.SMA(dataframe['volume'], timeperiod=20)
    
        dataframe.loc[
            (
                (dataframe['close'] > dataframe['trend']) &
                (dataframe['volume'] > volume_ma * 1.2) &  # 20% above average volume
                (dataframe['buy-mojoMA'].div(dataframe['buy-fastMA'])
                    > self.div_threshold_low.value) &
                (dataframe['buy-mojoMA'].div(dataframe['buy-fastMA'])
                    < self.div_threshold_high.value) &
                (dataframe['buy-fastMA'].div(dataframe['buy-slowMA'])
                    > self.div_threshold_low.value) &
                (dataframe['buy-fastMA'].div(dataframe['buy-slowMA'])
                    < self.div_threshold_high.value)
            ),
            'enter_long'] = 1
    
        return dataframe

    # Add trailing stop logic
    # Add trailing stop logic
    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Calculate trailing stop (2x ATR below low)
        trailing_stop = dataframe['low'] - (2 * dataframe['atr'])
    
        dataframe.loc[
            (
                (dataframe['close'] < trailing_stop) |  # Trailing stop hit
                # Keep existing exit logic
                (dataframe['sell-fastMA'].div(dataframe['sell-mojoMA'])
                    > self.div_threshold_low.value) &
                (dataframe['sell-fastMA'].div(dataframe['sell-mojoMA'])
                    < self.div_threshold_high.value) &
                (dataframe['sell-slowMA'].div(dataframe['sell-fastMA'])
                    > self.div_threshold_low.value) &
                (dataframe['sell-slowMA'].div(dataframe['sell-fastMA'])
                    < self.div_threshold_high.value)
            ),
            'exit_long'] = 1
    
        return dataframe
