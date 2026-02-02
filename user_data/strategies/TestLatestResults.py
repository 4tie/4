# Test strategy for latest results feature
from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta

class TestLatestResults(IStrategy):
    INTERFACE_VERSION = 3
    
    # Minimal ROI
    minimal_roi = {
        "0": 0.01
    }
    
    # Stoploss
    stoploss = -0.05
    
    # Timeframe
    timeframe = '5m'
    
    # Trailing stop
    trailing_stop = False
    
    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['sma'] = ta.SMA(dataframe, timeperiod=20)
        return dataframe
    
    def populate_buy_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe['close'] > dataframe['sma']),
            'buy'
        ] = 1
        return dataframe
    
    def populate_sell_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe['close'] < dataframe['sma']),
            'sell'
        ] = 1
        return dataframe
