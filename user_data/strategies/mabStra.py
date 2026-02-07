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
import numpy as np


class mabStra(IStrategy):
    """
    Enhanced Moving Average Crossover Strategy with Trend Filter and Volume Confirmation
    
    This strategy uses:
    - Fast/Slow MA crossovers for entry signals
    - Trend filter (SMA 200) to trade with the trend
    - Volume surge confirmation for entries
    - ATR-based trailing stop for exits
    - Additional technical indicators for robustness
    """
    
    INTERFACE_VERSION: int = 3
    
    # Strategy settings
    timeframe = '5m'
    startup_candle_count: int = 200  # Need 200 candles for SMA 200
    
    # Disable short trading (long only strategy)
    can_short: bool = False
    
    # ROI table - Fixed: keys should be integers (minutes), not strings
    minimal_roi = {
        0: 0.10,    # 10% at any duration
        60: 0.05,   # 5% after 60 minutes
        240: 0.02,  # 2% after 4 hours
        1440: 0.01, # 1% after 24 hours
    }
    
    # Stoploss
    stoploss = -0.1 # 10% stoploss
    
    # Trailing stop settings
    trailing_stop = True
    trailing_stop_positive = 0.02  # Activate trailing stop at 2% profit
    trailing_stop_positive_offset = 0.04  # Offset from current price
    trailing_only_offset_is_reached = False
    # Add these parameters at the top of your class definition

    # Hyperoptable parameters - Buy side
    buy_fast_ma_timeframe = IntParameter(5, 20, default=10, space='buy')
    buy_slow_ma_timeframe = IntParameter(20, 50, default=30, space='buy')
    buy_div_min = DecimalParameter(0.95, 0.99, default=0.98, decimals=3, space='buy')
    buy_div_max = DecimalParameter(1.01, 1.05, default=1.02, decimals=3, space='buy')
    buy_volume_multiplier = DecimalParameter(1.1, 2.0, default=1.2, decimals=1, space='buy')
    
    # Hyperoptable parameters - Sell side
    sell_fast_ma_timeframe = IntParameter(5, 20, default=10, space='sell')
    sell_slow_ma_timeframe = IntParameter(20, 50, default=30, space='sell')
    sell_div_min = DecimalParameter(0.95, 0.99, default=0.98, decimals=3, space='sell')
    sell_div_max = DecimalParameter(1.01, 1.05, default=1.02, decimals=3, space='sell')
    
    # ATR multiplier for trailing stop
    atr_multiplier = DecimalParameter(1.5, 3.0, default=2.0, decimals=1, space='sell')
    
    # RSI parameters for additional filter
    rsi_period = IntParameter(10, 20, default=14, space='buy')
    rsi_min = IntParameter(20, 40, default=30, space='buy')
    rsi_max = IntParameter(60, 80, default=70, space='sell')
    
    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Calculate all technical indicators used by the strategy
        """
        # Calculate moving averages for buy signals
        dataframe['buy-fastMA'] = ta.SMA(dataframe['close'], timeperiod=self.buy_fast_ma_timeframe.value)
        dataframe['buy-slowMA'] = ta.SMA(dataframe['close'], timeperiod=self.buy_slow_ma_timeframe.value)
        
        # Calculate moving averages for sell signals
        dataframe['sell-fastMA'] = ta.SMA(dataframe['close'], timeperiod=self.sell_fast_ma_timeframe.value)
        dataframe['sell-slowMA'] = ta.SMA(dataframe['close'], timeperiod=self.sell_slow_ma_timeframe.value)
        
        # Add ATR for trailing stop and volatility measurement
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        
        # Add trend filter (SMA 200)
        dataframe['trend'] = ta.SMA(dataframe['close'], timeperiod=200)
        
        # Add RSI for additional confirmation
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=self.rsi_period.value)
        
        # Add EMA for additional trend confirmation
        dataframe['ema_50'] = ta.EMA(dataframe['close'], timeperiod=50)
        
        # Add MACD for momentum confirmation
        macd = ta.MACD(dataframe, fastperiod=12, slowperiod=26, signalperiod=9)
        dataframe['macd'] = macd['macd']
        dataframe['macd_signal'] = macd['macdsignal']
        dataframe['macd_hist'] = macd['macdhist']
        
        # Add Bollinger Bands for volatility-based entries
        bollinger = ta.BBANDS(dataframe, timeperiod=20, nbdevup=2.0, nbdevdn=2.0, matype=0)
        dataframe['bb_upper'] = bollinger['upperband']
        dataframe['bb_middle'] = bollinger['middleband']
        dataframe['bb_lower'] = bollinger['lowerband']
        
        # Calculate volume moving average
        dataframe['volume_ma'] = ta.SMA(dataframe['volume'], timeperiod=20)
        
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Define entry conditions for long positions
        """
        # Entry conditions with multiple confirmations
        dataframe.loc[
            (
                # Trend filter: Price above long-term trend
                (dataframe['close'] > dataframe['trend']) &
                
                # Volume confirmation: Volume surge above average
                (dataframe['volume'] > dataframe['volume_ma'] * self.buy_volume_multiplier.value) &
                
                # MA crossover condition: Fast MA close to Slow MA (crossover zone)
                (dataframe['buy-fastMA'].div(dataframe['buy-slowMA']) > self.buy_div_min.value) &
                (dataframe['buy-fastMA'].div(dataframe['buy-slowMA']) < self.buy_div_max.value) &
                
                # RSI filter: Not overbought
                (dataframe['rsi'] < self.rsi_max.value) &
                (dataframe['rsi'] > self.rsi_min.value) &
                
                # MACD confirmation: MACD above signal line (bullish momentum)
                (dataframe['macd'] > dataframe['macd_signal']) &
                
                # Price not too far from Bollinger middle (avoid buying at extremes)
                (dataframe['close'] < dataframe['bb_upper']) &
                (dataframe['close'] > dataframe['bb_lower'])
            ),
            'enter_long'] = 1
        
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Define exit conditions for long positions
        """
        # Calculate dynamic trailing stop based on ATR
        trailing_stop = dataframe['low'] - (self.atr_multiplier.value * dataframe['atr'])
        
        # Exit conditions
        dataframe.loc[
            (
                # Trailing stop hit
                (dataframe['close'] < trailing_stop) |
                
                # MA crossover exit: Fast MA diverges from Slow MA
                (
                    (dataframe['sell-fastMA'].div(dataframe['sell-slowMA']) > self.sell_div_max.value) |
                    (dataframe['sell-fastMA'].div(dataframe['sell-slowMA']) < self.sell_div_min.value)
                ) |
                
                # RSI overbought exit
                (dataframe['rsi'] > self.rsi_max.value) |
                
                # MACD bearish crossover
                (dataframe['macd'] < dataframe['macd_signal']) &
                (dataframe['macd_hist'] < 0) |
                
                # Price below trend (trend reversal)
                (dataframe['close'] < dataframe['trend'])
            ),
            'exit_long'] = 1
        
        return dataframe
    
    def custom_stoploss(self, pair: str, trade, current_time, current_rate, 
                        current_profit, **kwargs) -> float:
        """
        Custom dynamic stoploss based on ATR
        """
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        last_candle = dataframe.iloc[-1].squeeze()
        
        # Use ATR-based dynamic stoploss
        atr = last_candle['atr']
        atr_stop = -(self.atr_multiplier.value * atr / current_rate)
        
        # Return the more conservative stoploss
        return max(self.stoploss, atr_stop)
    
    def confirm_trade_entry(self, pair: str, order_type: str, amount: float, 
                           rate: float, time_in_force: str, current_time,
                           entry_tag: str, side: str, **kwargs) -> bool:
        """
        Additional confirmation before placing entry order
        """
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        last_candle = dataframe.iloc[-1].squeeze()
        
        # Additional safety checks
        # Ensure ATR is not too high (avoid entering during extreme volatility)
        if last_candle['atr'] > last_candle['close'] * 0.05:  # ATR > 5% of price
            return False
        
        # Ensure volume is sufficient
        if last_candle['volume'] < last_candle['volume_ma'] * 0.5:
            return False
        
        return True

