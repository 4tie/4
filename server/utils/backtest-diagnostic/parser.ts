import fs from 'fs';
import path from 'path';

export class BacktestParser {
  parse(backtestId: string): any {
    const resultsDir = path.join(process.cwd(), 'user_data', 'backtest_results');
    try {
      const id = String(backtestId);

      const runDir = path.join(resultsDir, 'runs', id);
      const rawStatsPath = path.join(runDir, 'raw-stats.json');
      if (fs.existsSync(rawStatsPath)) {
        const content = fs.readFileSync(rawStatsPath, 'utf-8');
        const raw = JSON.parse(content);

        const equityCurvePath = path.join(runDir, 'equity-curve.json');
        const equityCurve = (() => {
          if (!fs.existsSync(equityCurvePath)) return null;
          try {
            const eqContent = fs.readFileSync(equityCurvePath, 'utf-8');
            const parsed = JSON.parse(eqContent);
            return Array.isArray(parsed) ? parsed : null;
          } catch {
            return null;
          }
        })();

        const hasRootTrades = Array.isArray((raw as any)?.trades);
        if (hasRootTrades) {
          const trades = (raw as any).trades;
          if (equityCurve && Array.isArray(trades)) {
            for (let i = 0; i < Math.min(trades.length, equityCurve.length); i++) {
              const p = equityCurve[i] as any;
              if (!p || typeof p !== 'object') continue;
              (trades[i] as any).equity_before = (trades[i] as any).equity_before ?? p.equity_before;
              (trades[i] as any).equity_after = (trades[i] as any).equity_after ?? p.equity_after;
              (trades[i] as any).profit_abs = (trades[i] as any).profit_abs ?? p.profit_abs;
            }
          }

          const start_balance = equityCurve?.[0]?.equity_before;
          const end_balance = equityCurve?.length ? equityCurve[equityCurve.length - 1]?.equity_after : undefined;
          const max_drawdown = equityCurve
            ? equityCurve.reduce((m: number, p: any) => {
                const dd = Number(p?.drawdown);
                return Number.isFinite(dd) ? Math.max(m, dd) : m;
              }, 0)
            : undefined;

          return {
            ...(raw as any),
            trades,
            equity_curve: equityCurve ?? undefined,
            start_balance: start_balance ?? (raw as any).start_balance,
            end_balance: end_balance ?? (raw as any).end_balance,
            max_drawdown: max_drawdown ?? (raw as any).max_drawdown,
          };
        }

        const strategyKeys = (raw as any)?.strategy ? Object.keys((raw as any).strategy) : [];
        const selectedKey = strategyKeys[0];
        const strat = selectedKey ? (raw as any).strategy[selectedKey] : undefined;
        const trades = Array.isArray(strat?.trades) ? strat.trades : [];

        if (equityCurve && Array.isArray(trades)) {
          for (let i = 0; i < Math.min(trades.length, equityCurve.length); i++) {
            const p = equityCurve[i] as any;
            if (!p || typeof p !== 'object') continue;
            (trades[i] as any).equity_before = (trades[i] as any).equity_before ?? p.equity_before;
            (trades[i] as any).equity_after = (trades[i] as any).equity_after ?? p.equity_after;
            (trades[i] as any).profit_abs = (trades[i] as any).profit_abs ?? p.profit_abs;
          }
        }

        const start_balance = equityCurve?.[0]?.equity_before;
        const end_balance = equityCurve?.length ? equityCurve[equityCurve.length - 1]?.equity_after : undefined;
        const max_drawdown = equityCurve
          ? equityCurve.reduce((m: number, p: any) => {
              const dd = Number(p?.drawdown);
              return Number.isFinite(dd) ? Math.max(m, dd) : m;
            }, 0)
          : undefined;

        return {
          ...(raw as any),
          trades,
          equity_curve: equityCurve ?? undefined,
          start_balance: start_balance ?? (raw as any).start_balance,
          end_balance: end_balance ?? (raw as any).end_balance,
          max_drawdown: max_drawdown ?? (raw as any).max_drawdown,
        };
      }

      const targetFile = `backtest-result-${id}.json`;
      const content = fs.readFileSync(path.join(resultsDir, targetFile), 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error('Error parsing backtest results:', e);
      return null;
    }
  }
}
