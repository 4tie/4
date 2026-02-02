# AI Strategy Refinement Logic Plan

## Overview
The AI Strategy Refinement feature will allow users to leverage LLMs to analyze backtest performance and suggest code modifications to optimize trading strategies.

## 1. Context Collection
To provide high-quality refinements, the AI needs:
- **Source Code**: Current strategy implementation (`.py` file).
- **Backtest Results**: Profit/Loss, win rate, drawdown, and trade duration.
- **Trade Log Analysis**: Entry/exit reasons, slippage, and market conditions during trades.
- **FreqTrade Configuration**: Timeframe, stake currency, and indicators used.

## 2. Refinement Categories
Users can choose from several refinement types:
- **Optimization**: Improving entry/exit timing for better ROI.
- **Risk Mitigation**: Adjusting stop-loss or adding protective indicators (e.g., ADX, RSI filters).
- **Hyperparameter Suggestion**: Recommending initial ranges for hyperopt.
- **Code Cleanup**: Refactoring for performance and readability.

## 3. Implementation Logic
### Backend (`server/ai.ts`)
- **Prompt Engineering**: Structured prompts that include the strategy code and results in a format the LLM can process.
- **Output Parsing**: Extracting the suggested Python code block from the LLM response.
- **Validation**: Basic syntax check using Python CLI if available.

### Frontend (`client/src/components/ChatPanel.tsx`)
- **Backtest Attachment**: Seamlessly attaching the "latest results" to the chat context.
- **Code Preview**: Showing a diff-like view of suggested changes.
- **Apply Mechanism**: A one-click button to overwrite the existing strategy file with AI improvements.

## 4. Iterative Loop
1. **Backtest**: User runs a backtest.
2. **Analyze**: AI analyzes results vs. code.
3. **Refine**: AI provides optimized code.
4. **Verify**: User saves and re-runs backtest to compare performance in the "Comparison" tab.
