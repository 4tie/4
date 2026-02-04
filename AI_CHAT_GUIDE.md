# AI Chat Guide (Simple)

This chat is like a smart helper inside your app.
You can talk to it in simple words. You do **not** need to code.

If you don’t speak English well, that’s OK:
- Write in your own language.
- Use short sentences.
- You can also paste screenshots or results text if needed.

---

## 1) What the AI can do

### Understand your strategy (your trading rules)
- It can read the strategy file you have open.
- It can explain what the strategy is doing.
- It can tell you if something looks wrong or risky.

### Explain backtest results (a test using old market data)
- It can explain your profit, win rate, and drawdown.
- It can tell you what looks good and what looks dangerous.
- It can suggest “next experiments” to try.

### Suggest improvements (without you coding)
The AI can suggest changes like:
- Add indicators (RSI, EMA, MACD, etc.)
- Add safety filters (avoid bad trades)
- Improve exits (how to sell)
- Reduce drawdown (big losses)

### Apply changes for you (with safety)
When the AI gives a change, you can:
- **Preview** the change first (see before/after)
- **Apply** it to your editor
- **Apply & Save** (save directly)

You always stay in control.

### Run actions (optional)
Sometimes the AI can offer buttons to:
- Run a backtest
- Run batch backtests (many periods)
- Run diagnostics (deep analysis)

### AI Refinement Loop (automatic improvement runs)
This is a special mode that can run multiple “improve + test” iterations for you.

Inside the **AI Refinement Loop** page you may see buttons like:
- **Start**: begin a new improvement run
- **Stop**: ask the run to stop safely
- **Resume**: continue a run that was stopped/failed
- **Rerun baseline**: start a new run using the same settings, but reset the strategy + config back to the original baseline

You can also open each iteration to see:
- Strategy diff (what changed in the strategy)
- Config diff / config patch (what changed in config)

The loop only allows safe change types:
- **Strategy edit**: validated edits to the strategy file
- **Config patch**: small config updates limited to a safe allow-list of keys (for example ROI, stoploss, trailing stop, protections)

---

## 2) The most important things to know

### The AI uses your real context
It uses what you currently have loaded, for example:
- The file you opened
- The code you selected
- The backtest you last ran

### You should always preview before saving
Before saving changes:
- Use **Preview**
- Read the change
- If you are not sure, ask the AI: “Explain what this change does in simple words.”

### The AI is not magic
- It can be wrong sometimes.
- It cannot guarantee profit.
- Trading is risky.

---

## 3) How to use it (step-by-step)

### Step A — Ask a simple question
Examples:
- “What does this strategy do?”
- “Why is my profit low?”
- “How can I reduce drawdown?”
- “Make it safer.”

### Step B — Give it the right context (1 click)
Inside the chat, you may see buttons like:
- **Attach Backtest Results** (chart icon)
  - This puts your last results into the message so the AI can talk about them.
- **Explain Last Backtest**
  - This prepares a good question automatically.

### Step C — Use Preview / Apply
If the AI returns a change, you may see buttons like:
- **Preview**
  - Shows the current code and the AI’s proposed code.
- **Apply**
  - Inserts/replaces code in your editor.
- **Apply & Save**
  - Applies and saves the file (best when you are confident).

Tip: If you don’t understand the change, ask:
- “Explain this change like I’m new.”

---

## 4) Switching AI models (Free models only)

In the chat header, you will see a small model name badge.
- Click it to open a list of **free** models.
- Use the search box to find a model.
- Click a model to select it.

Notes:
- This only affects **future** messages.
- If one model is slow or not helpful, try another.

---

## 5) Good messages to send (copy & paste)

### Understand results
- “Explain my last backtest in simple words.”
- “What is the biggest risk in these results?”
- “Give me 3 next tests to try.”

### Make it safer
- “Make this strategy safer. Reduce big losses.”
- “Add filters to avoid bad trades.”

### Improve performance
- “Try to increase profit without increasing drawdown too much.”
- “Improve exits to keep winners longer and cut losers faster.”

### If you want indicators
- “Add RSI + EMA + MACD indicators, but do not change my entry/exit rules yet.”

### If you want it to edit a specific part
- Select some code in the editor, then ask:
  - “Improve only this part.”
  - “Fix this bug.”

---

## 6) When you should run Diagnostics
Run Diagnostics when:
- Backtest results look strange
- You want deeper analysis
- You want to see problems like costs, slippage, overfitting

If you don’t know, ask:
- “Should I run diagnostics? Yes or no. Explain simply.”

---

## 7) Quick troubleshooting

### “The AI answers but it doesn’t match my code”
- Make sure the correct file is open.
- Select the exact part you want to change.

### “I don’t see backtest info in the AI answer”
- Use **Attach Backtest Results**.
- Or say: “Use my last backtest results.”

### “The model list is empty”
- Click refresh in the model list.
- Check that the server is running.

### “Refinement buttons show errors like API endpoint not found (404)”
- Restart the dev server.
- After restart, try the action again.

---

## 8) Simple glossary
- **Strategy**: Your trading rules.
- **Backtest**: A test using past data.
- **Win rate**: How many trades ended in profit.
- **Drawdown**: How much the account went down from the top.
- **Preview**: See changes before applying.

---

If you want, tell me what language you prefer and I can create a second version of this file in that language.
