import type { DrawdownRiskReport } from "./types";

export class Phase3Drawdown {
  analyze(backtestData: any): DrawdownRiskReport {
    const trades = Array.isArray(backtestData?.trades) ? backtestData.trades : [];

    const toMs = (v: any) => {
      const d = v ? new Date(v) : null;
      const ms = d ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : NaN;
    };

    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };

    const points = trades
      .map((t: any) => {
        const ms = toMs(t?.close_date ?? t?.closeDate ?? t?.close_time);
        const equityAfter = num(t?.equity_after ?? t?.equityAfter);
        return { ms, equityAfter, trade: t };
      })
      .filter((p: any) => Number.isFinite(p.ms) && Number.isFinite(p.equityAfter))
      .sort((a: any, b: any) => a.ms - b.ms);

    const startBalance = num(backtestData?.start_balance ?? backtestData?.startBalance);
    const endBalance = num(backtestData?.end_balance ?? backtestData?.endBalance);

    const firstMs = (() => {
      const openMs = trades
        .map((t: any) => toMs(t?.open_date ?? t?.openDate ?? t?.open_time))
        .filter(Number.isFinite);
      const closeMs = points.map((p: any) => p.ms);
      const all = [...openMs, ...closeMs].filter(Number.isFinite);
      return all.length ? Math.min(...all) : NaN;
    })();

    const lastMs = points.length ? points[points.length - 1].ms : NaN;

    const series = (() => {
      if (!points.length) {
        const eq = Number.isFinite(startBalance) ? startBalance : 0;
        const ms = Number.isFinite(firstMs) ? firstMs : Date.now();
        return [{ ms, equity: eq }];
      }

      const initialEquity = Number.isFinite(startBalance)
        ? startBalance
        : num(points[0]?.trade?.equity_before ?? points[0]?.trade?.equityBefore ?? points[0]?.equityAfter);

      const initialMs = Number.isFinite(firstMs) ? firstMs : points[0].ms;

      return [
        { ms: initialMs, equity: Number.isFinite(initialEquity) ? initialEquity : points[0].equityAfter },
        ...points.map((p: any) => ({ ms: p.ms, equity: p.equityAfter })),
      ];
    })();

    type Episode = {
      startMs: number;
      peakMs: number;
      peakEquity: number;
      troughMs: number;
      troughEquity: number;
      recoveredMs: number | null;
    };

    const episodes: Episode[] = [];

    let peakEquity = series[0].equity;
    let peakMs = series[0].ms;

    let current: Episode | null = null;

    for (let i = 1; i < series.length; i++) {
      const { ms, equity } = series[i];

      if (equity >= peakEquity) {
        if (current && equity >= current.peakEquity) {
          current.recoveredMs = ms;
          episodes.push(current);
          current = null;
        }

        peakEquity = equity;
        peakMs = ms;
        continue;
      }

      if (!current) {
        current = {
          startMs: peakMs,
          peakMs,
          peakEquity,
          troughMs: ms,
          troughEquity: equity,
          recoveredMs: null,
        };
      }

      if (equity < current.troughEquity) {
        current.troughEquity = equity;
        current.troughMs = ms;
      }
    }

    if (current) {
      episodes.push(current);
    }

    const hours = (msA: number, msB: number) => (msB - msA) / (1000 * 60 * 60);

    const drawdownCount = episodes.length;

    const episodeToTroughHours = (e: Episode) => {
      if (!Number.isFinite(e.startMs) || !Number.isFinite(e.troughMs)) return 0;
      return Math.max(0, hours(e.startMs, e.troughMs));
    };

    const recoveryHours = (e: Episode) => {
      if (!Number.isFinite(e.troughMs) || !Number.isFinite(e.recoveredMs ?? NaN)) return null;
      return Math.max(0, hours(e.troughMs, e.recoveredMs as number));
    };

    const avg = (arr: number[]) => {
      if (!arr.length) return 0;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };

    const durationsToTrough = episodes.map(episodeToTroughHours).filter((v) => v > 0);
    const avgDrawdownDuration = avg(durationsToTrough);
    const maxDrawdownDuration = durationsToTrough.length ? Math.max(...durationsToTrough) : 0;

    const maxEpisode = episodes.reduce(
      (best: Episode | null, e: Episode) => {
        const ddAbs = Math.max(0, e.peakEquity - e.troughEquity);
        const bestAbs = best ? Math.max(0, best.peakEquity - best.troughEquity) : -1;
        return ddAbs > bestAbs ? e : best;
      },
      null as Episode | null,
    );

    const computedMaxDrawdownAbs = maxEpisode ? Math.max(0, maxEpisode.peakEquity - maxEpisode.troughEquity) : 0;
    const computedMaxDrawdown = maxEpisode && maxEpisode.peakEquity > 0
      ? computedMaxDrawdownAbs / maxEpisode.peakEquity
      : 0;

    const reportedMaxDrawdown = num(backtestData?.max_drawdown ?? backtestData?.maxDrawdown);
    const maxDrawdown = Number.isFinite(reportedMaxDrawdown) ? reportedMaxDrawdown : computedMaxDrawdown;
    const maxDrawdownAbs = computedMaxDrawdownAbs;

    const timeToRecovery = maxEpisode ? recoveryHours(maxEpisode) : null;

    const totalDays = Number.isFinite(firstMs) && Number.isFinite(lastMs) && lastMs > firstMs
      ? Math.max(1 / 24, (lastMs - firstMs) / (1000 * 60 * 60 * 24))
      : 0;

    const seriesStartEquity = series[0]?.equity ?? (Number.isFinite(startBalance) ? startBalance : 0);
    const seriesEndEquity = Number.isFinite(endBalance)
      ? endBalance
      : (series.length ? series[series.length - 1].equity : seriesStartEquity);

    const equityCurveSlope = totalDays > 0 && seriesStartEquity > 0
      ? ((seriesEndEquity - seriesStartEquity) / seriesStartEquity) / totalDays
      : 0;

    const failurePatterns: string[] = [];

    if (maxEpisode && maxDrawdown > 0.2) {
      const ddToTroughHours = episodeToTroughHours(maxEpisode);
      if (ddToTroughHours > 0 && ddToTroughHours < 6) {
        failurePatterns.push("Steep vertical drops suggest stop-loss / position sizing failure");
      }

      if (timeToRecovery !== null && timeToRecovery > 24 * 7) {
        failurePatterns.push("Long recovery time suggests weak exits or lack of edge after losses");
      }

      if (maxEpisode.recoveredMs === null) {
        failurePatterns.push("No full recovery from the largest drawdown by end of backtest");
      }
    }

    if (drawdownCount >= 5) {
      failurePatterns.push("Multiple frequent drawdowns suggest regime mismatch or noisy signals");
    }

    const profitAbs = (t: any) => {
      const v = t?.profit_abs ?? t?.profitAbs;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const profitRatio = (t: any) => {
      const v = t?.profit_ratio ?? t?.profitRatio ?? t?.profit;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const worstTrade = trades.reduce((best: any | null, t: any) => {
      const p = profitAbs(t);
      if (!best) return t;
      return p < profitAbs(best) ? t : best;
    }, null);

    const worstLossAbsRaw = worstTrade ? profitAbs(worstTrade) : 0;
    const worstLossAbs = worstLossAbsRaw < 0 ? Math.abs(worstLossAbsRaw) : 0;

    const worstEquityBefore = worstTrade
      ? num(worstTrade?.equity_before ?? worstTrade?.equityBefore)
      : NaN;

    const actualRiskPct = Number.isFinite(worstEquityBefore) && worstEquityBefore > 0
      ? (worstLossAbs / worstEquityBefore) * 100
      : 0;

    const expectedStopLossRaw = num(
      backtestData?.stoploss ??
        backtestData?.config?.stoploss ??
        backtestData?.strategy?.[Object.keys(backtestData?.strategy ?? {})?.[0] as any]?.stoploss,
    );

    const expectedStopLoss = Number.isFinite(expectedStopLossRaw) ? expectedStopLossRaw : null;

    const losers = trades.filter((t: any) => profitAbs(t) < 0 || profitRatio(t) < 0);
    const stopLossRespectedPct = (() => {
      if (!Number.isFinite(Number(expectedStopLoss)) || expectedStopLoss === null || expectedStopLoss >= 0) {
        return null;
      }
      if (!losers.length) return 1;
      const ok = losers.filter((t: any) => profitRatio(t) >= (expectedStopLoss - 0.001)).length;
      return ok / losers.length;
    })();

    const capitalPctArr = trades
      .map((t: any) => {
        const stake = num(t?.stake_amount);
        const eqBefore = num(t?.equity_before ?? t?.equityBefore);
        if (!Number.isFinite(stake) || !Number.isFinite(eqBefore) || eqBefore <= 0) return 0;
        return (stake / eqBefore) * 100;
      })
      .filter((v: number) => v > 0);

    const avgCapitalPct = avg(capitalPctArr);
    const positionSizingIssue = avgCapitalPct > 70;

    const riskRedFlags: string[] = [];
    if (actualRiskPct > 5) riskRedFlags.push("Worst trade risk exceeds 5% of equity");
    if (positionSizingIssue) riskRedFlags.push("High position sizing (large capital per trade) increases drawdown risk");

    if (expectedStopLoss === null) {
      riskRedFlags.push("Stoploss value not found in results; cannot validate stop-loss execution");
    } else if (stopLossRespectedPct !== null && stopLossRespectedPct < 0.8) {
      riskRedFlags.push("Stoploss not consistently respected (large losses beyond configured stoploss)");
    }

    riskRedFlags.push("Slippage data not available in exported trades; cannot estimate avg slippage");

    return {
      drawdownStructure: {
        maxDrawdown,
        maxDrawdownAbs,
        avgDrawdownDurationHours: avgDrawdownDuration,
        maxDrawdownDurationHours: maxDrawdownDuration,
        timeToRecoveryHours: timeToRecovery,
        equityCurveSlope,
        drawdownCount,
        failurePatterns,
      },
      riskPerTrade: {
        actualRiskPct,
        worstLossAbs,
        expectedStopLoss,
        stopLossRespectedPct,
        avgSlippage: null,
        positionSizingIssue,
        redFlags: riskRedFlags,
      },
    };
  }
}
