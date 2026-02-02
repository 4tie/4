import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  CheckCircle2, 
  FileSearch, 
  Activity, 
  ShieldCheck 
} from "lucide-react";
import { type DiagnosticReport } from "@shared/schema";
import { cn } from "@/lib/utils";

interface DiagnosticReportViewProps {
  report: any; // Using any for the nested report structure
}

type HelpItem = {
  title: string;
  meaningEn: string;
  meaningAr: string;
  fixEn: string[];
  fixAr?: string[];
};

function translateFixEnToAr(fixEn: string): string {
  const map: Record<string, string> = {
    "Confirm the timerange includes market conditions where your strategy should trade.": "تأكد أن الفترة الزمنية (timerange) تشمل ظروف سوق تتوقع أن الاستراتيجية تتداول فيها.",
    "Loosen entry filters or reduce confirmations to allow some trades.": "خفف فلاتر الدخول أو قلّل التأكيدات للسماح بحدوث صفقات.",
    "Ensure data for the configured pairs/timeframe is downloaded (missing data can also result in no trades).": "تأكد من تحميل بيانات الأزواج والفريم المحدد (timeframe)، لأن نقص البيانات قد يؤدي لعدم وجود صفقات.",
    "Re-run the backtest export to regenerate the JSON results file.": "أعد تشغيل الباكتيست مع التصدير لإعادة إنشاء ملف النتائج JSON.",
    "Ensure the backtest results JSON file is not manually edited or truncated.": "تأكد أن ملف نتائج الباكتيست JSON لم يتم تعديله يدويًا أو قصّه/تلفه.",
    "Verify your system time/timezone settings are stable and the export format is consistent.": "تحقق من ثبات إعدادات الوقت/المنطقة الزمنية وأن صيغة التصدير ثابتة.",
    "Confirm whether your strategy is expected to be inactive during that period (this can be normal).": "تحقق هل من الطبيعي أن تكون الاستراتيجية غير نشطة خلال تلك الفترة (قد يكون هذا طبيعيًا).",
    "Verify your timerange is continuous and matches available data.": "تحقق أن الـ timerange متصل بدون فجوات وأنه يطابق البيانات المتاحة.",
    "Re-download OHLCV data for the exact pairs and timeframe used in the backtest, then rerun.": "أعد تحميل بيانات OHLCV لنفس الأزواج ونفس الفريم المستخدم في الباكتيست ثم أعد التشغيل.",
    "Check for timeframe mismatch (e.g., data downloaded for 1h but backtest runs on 4h).": "افحص وجود عدم تطابق في الفريم (مثال: بيانات 1h محمّلة لكن الباكتيست يعمل على 4h).",
    "Re-download data and rerun the backtest.": "أعد تحميل البيانات ثم أعد تشغيل الباكتيست.",
    "Verify timerange and pair/timeframe configuration.": "تحقق من إعدادات الـ timerange والأزواج والفريم.",
    "Remove any usage of future candles (e.g., shift(-1), negative shifts, or indexing that peeks ahead).": "أزل أي استخدام لشموع مستقبلية (مثل shift(-1) أو الإزاحات السالبة أو أي فهرسة تنظر للأمام).",
    "Ensure signals are computed only from current/past rows.": "تأكد أن الإشارات تُحسب فقط من الصفوف الحالية/السابقة.",
    "Use adequate startup candles so indicators are stable before generating signals.": "استخدم عدد startup_candle_count مناسبًا حتى تستقر المؤشرات قبل توليد الإشارات.",
    "Ensure the strategyPath you selected exists in the Files table and can be read.": "تأكد أن المسار strategyPath الذي اخترته موجود ضمن الملفات ويمكن قراءته.",
    "Open the strategy file in the app and confirm it has the expected code.": "افتح ملف الاستراتيجية داخل التطبيق وتأكد أنه يحتوي على الكود المتوقع.",
    "Re-sync filesystem to DB if needed, then re-run analysis.": "إذا لزم الأمر، أعد مزامنة نظام الملفات مع قاعدة البيانات ثم أعد التحليل.",
    "Implement populate_entry_trend (or populate_buy_trend for older style).": "قم بتنفيذ populate_entry_trend (أو populate_buy_trend للإصدارات الأقدم).",
    "Set enter_long/buy (and enter_short if applicable) when conditions are met.": "قم بتعيين enter_long/buy (وأيضًا enter_short إن كنت تستخدم الشورت) عند تحقق الشروط.",
    "Inside populate_entry_trend, set dataframe.loc[conditions, 'enter_long'] = 1 (or 'buy' for older style).": "داخل populate_entry_trend قم بتعيين dataframe.loc[conditions, 'enter_long'] = 1 (أو 'buy' للطريقة القديمة).",
    "Verify your conditions actually become true for some candles.": "تأكد أن شروطك تتحقق فعليًا في بعض الشموع.",
    "Set stoploss to a negative number (example: -0.10 for -10%).": "اجعل stoploss رقمًا سالبًا (مثال: -0.10 يعني -10%).",
    "Confirm stoploss is defined consistently in both config.json and the strategy.": "تأكد أن stoploss معرف بشكل متسق في config.json وفي ملف الاستراتيجية.",
    "Implement populate_exit_trend (or populate_sell_trend).": "قم بتنفيذ populate_exit_trend (أو populate_sell_trend).",
    "Define minimal_roi and stoploss (and trailing if needed).": "عرّف minimal_roi و stoploss (وأضف trailing إذا احتجت).",
    "Verify exits trigger in backtests (check exit_reason distribution).": "تحقق أن الخروج يعمل في الباكتيست (افحص توزيع exit_reason).",
    "If you want shorts, set can_short = True and ensure exchange/market supports it.": "إذا كنت تريد الشورت، اجعل can_short = True وتأكد أن المنصة/السوق يدعم ذلك.",
    "If you do not want shorts, remove enter_short logic.": "إذا لا تريد الشورت، احذف منطق enter_short.",
    "Ensure the file defines a class that inherits IStrategy.": "تأكد أن الملف يعرّف class يرث من IStrategy.",
    "Verify the strategy file content matches Freqtrade conventions.": "تحقق أن ملف الاستراتيجية مطابق لقواعد/صيغة Freqtrade.",
    "Simplify entry/exit conditions and validate each piece triggers as expected.": "بسّط شروط الدخول/الخروج وتأكد أن كل جزء يعمل ويتحقق كما هو متوقع.",
    "Run a smaller backtest and inspect whether signals appear on the dataframe.": "شغّل باكتيست أصغر وافحص هل تظهر الإشارات على dataframe.",
    "Review the rule and remove contradictory thresholds.": "راجع القاعدة واحذف الحدود المتعارضة.",
    "Log indicator values around expected entry points to confirm realistic ranges.": "سجّل قيم المؤشرات حول نقاط الدخول المتوقعة لتتأكد أنها ضمن نطاق منطقي.",
    "Extend the timerange and/or add more pairs.": "قم بتوسيع الفترة الزمنية (timerange) و/أو أضف أزواجًا أكثر.",
    "Verify data is downloaded for the pairs/timeframe.": "تأكد أن البيانات محمّلة للأزواج والفريم.",
    "Tighten stoploss or add earlier invalidation exits.": "شدّد وقف الخسارة أو أضف خروجًا مبكرًا عند إبطال الفكرة.",
    "Add trailing stop or improve exit logic to protect winners.": "أضف trailing stop أو حسّن منطق الخروج لحماية الصفقات الرابحة.",
    "Reduce position size to control drawdown impact.": "قلّل حجم الصفقة لتقليل تأثير السحب (drawdown).",
    "Add trend/regime filters to avoid choppy markets.": "أضف فلاتر للاتجاه/نظام السوق لتجنب الأسواق المتذبذبة.",
    "Require stronger confirmations (but avoid over-filtering).": "اطلب تأكيدات أقوى (لكن تجنب المبالغة في الفلترة).",
    "Reduce trade frequency by adding cooldown or higher timeframe signals.": "قلّل تكرار الصفقات بإضافة cooldown أو إشارات من فريم أعلى.",
    "Rework entries: focus on fewer, higher-quality signals.": "أعد تصميم الدخول: ركز على إشارات أقل ولكن بجودة أعلى.",
    "Improve exits and risk controls (stoploss, trailing, ROI structure).": "حسّن الخروج وإدارة المخاطر (stoploss, trailing, هيكل ROI).",
    "Test on different regimes/timeframes to find where the strategy has an edge.": "اختبر على أنظمة سوق/فريمات مختلفة لتحديد أين توجد أفضلية حقيقية.",
    "Extend the timerange.": "وسّع الفترة الزمنية (timerange).",
    "Add more pairs (carefully).": "أضف أزواجًا أكثر (بحذر).",
    "Slightly loosen filters to get enough samples, then re-evaluate quality.": "خفف الفلاتر قليلًا للحصول على عينة كافية، ثم أعد تقييم الجودة.",
    "Add a trend filter (e.g., only trade with higher-timeframe trend).": "أضف فلتر اتجاه (مثال: التداول فقط مع اتجاه فريم أعلى).",
    "Add cooldown or minimum candle spacing between entries.": "أضف cooldown أو حدًا أدنى من الشموع بين عمليات الدخول.",
    "Increase timeframe or require stronger confirmations.": "ارفع الفريم أو اطلب تأكيدات أقوى.",
    "Reduce stake amount or use fractional position sizing.": "قلّل stake_amount أو استخدم حجم صفقة نسبي من رأس المال.",
    "Limit max_open_trades.": "حدّد max_open_trades.",
    "Diversify across pairs only if the strategy edge is robust.": "نوّع عبر الأزواج فقط إذا كانت أفضلية الاستراتيجية قوية ومثبتة.",
    "Review entry/exit logic and risk controls.": "راجع منطق الدخول/الخروج وإدارة المخاطر.",
    "Rerun backtest after adjusting one variable at a time.": "أعد تشغيل الباكتيست بعد تعديل متغير واحد في كل مرة.",
    "Reduce position size and/or lower max_open_trades.": "قلّل حجم الصفقة و/أو خفّض max_open_trades.",
    "Avoid illiquid pairs and consider volatility filters.": "تجنب الأزواج قليلة السيولة وفكّر بإضافة فلاتر للتذبذب.",
    "Improve exits (ROI/trailing/invalidations) to stop bleeding.": "حسّن الخروج (ROI/trailing/invalidations) لإيقاف النزيف.",
    "Add regime filters to avoid conditions where the strategy underperforms.": "أضف فلاتر لنظام السوق لتجنب الظروف التي يكون فيها أداء الاستراتيجية ضعيفًا.",
    "Reduce exposure until the edge is confirmed.": "قلّل التعرض حتى تتأكد من وجود أفضلية.",
    "Reduce position sizing and limit concurrent trades.": "قلّل حجم الصفقات وحدّد عدد الصفقات المتزامنة.",
    "Validate the strategy on different timeranges and regimes.": "تحقق من الاستراتيجية على فترات زمنية وأنظمة سوق مختلفة.",
    "Improve risk controls and exits.": "حسّن إدارة المخاطر والخروج.",
    "Add trend/range regime detection and trade only the profitable regime.": "أضف اكتشاف نظام السوق (اتجاه/تذبذب) وتداول فقط في النظام المربح.",
    "Reduce trade frequency (cooldown / stronger filters).": "قلّل تكرار الصفقات (cooldown / فلاتر أقوى).",
    "Re-check signal logic for noise sensitivity.": "أعد فحص منطق الإشارات للتأكد من عدم حساسيتها للضوضاء.",
    "Reduce stake size per trade.": "قلّل حجم الـ stake لكل صفقة.",
    "Tighten stoploss and ensure it is actually applied.": "شدّد وقف الخسارة وتأكد أنه يُطبق فعليًا.",
    "Avoid highly volatile pairs or add volatility filters.": "تجنب الأزواج شديدة التذبذب أو أضف فلاتر للتذبذب.",
    "Use smaller stake_amount or fractional sizing.": "استخدم stake_amount أصغر أو حجم نسبي.",
    "Lower max_open_trades.": "خفّض max_open_trades.",
    "Add exposure limits per pair.": "أضف حدودًا للتعرض لكل زوج.",
    "Define stoploss explicitly in the strategy or config.": "عرّف stoploss بشكل صريح في الاستراتيجية أو الإعدادات.",
    "Ensure the exported results include the relevant config fields.": "تأكد أن النتائج المصدّرة تحتوي على حقول الإعدادات المطلوبة.",
    "Re-check data continuity and avoid illiquid markets.": "أعد فحص استمرارية البيانات وتجنب الأسواق قليلة السيولة.",
    "Consider tighter stops or earlier exits.": "فكّر بوقف خسارة أضيق أو خروج مبكر.",
    "Reduce position size to limit tail-risk.": "قلّل حجم الصفقة لتقليل مخاطر الذيل (tail-risk).",
    "Run more conservative assumptions (fees/slippage stress testing).": "اختبر بافتراضات أكثر تحفظًا (اختبار ضغط الرسوم/الانزلاق).",
    "Prefer high-liquidity pairs.": "فضّل الأزواج عالية السيولة.",
    "Avoid overly tight targets that are sensitive to execution costs.": "تجنب أهدافًا ضيقة جدًا حساسة لتكاليف التنفيذ.",
    "Reduce exposure and improve exits.": "قلّل التعرض وحسّن الخروج.",
    "Validate across multiple timeranges and market regimes.": "تحقق عبر عدة فترات زمنية وأنظمة سوق.",
  };

  return map[fixEn] ?? fixEn;
}

function HelpItemsBlock({ items }: { items: HelpItem[] }) {
  if (!items.length) return null;

  return (
    <div className="mt-4 p-3 bg-muted/20 rounded-md border border-border/50 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        Meaning & How To Fix
      </h4>
      <div className="space-y-3">
        {items.map((it, idx) => (
          <div key={`${it.title}-${idx}`} className="space-y-2">
            <div className="text-xs font-semibold">{it.title}</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Meaning (EN):</span> {it.meaningEn}
            </div>
            <div dir="rtl" className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">المعنى (AR):</span> {it.meaningAr}
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">How to fix (EN):</span>
              <ul className="mt-1 text-xs list-disc list-inside space-y-1">
                {it.fixEn.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div dir="rtl" className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">طريقة الإصلاح (AR):</span>
              <ul className="mt-1 text-xs list-disc list-inside space-y-1">
                {(it.fixAr ?? it.fixEn.map(translateFixEnToAr)).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DiagnosticReportView({ report }: DiagnosticReportViewProps) {
  if (!report) return null;

  const { metadata, phase1, phase2, phase3, phase4, phase5, phase6, phase7, phase8, phase9, summary } = report;
  const { structuralIntegrity } = phase1;
  const performance = phase2?.performance;
  const drawdownRisk = phase3?.drawdownRisk;
  const entryQuality = phase4?.entryQuality;
  const exitLogic = phase5?.exitLogic;
  const regimeAnalysis = phase6?.regimeAnalysis;
  const costAnalysis = phase7?.costAnalysis;
  const logicIntegrity = phase8?.logicIntegrity;
  const statistics = phase9?.statistics;

  const pct = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return `${(n * 100).toFixed(2)}%`;
  };

  const num = (v: any, digits = 2) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return n.toFixed(digits);
  };

  const numNullable = (v: any, digits = 2) => {
    if (v === null || v === undefined) return "-";
    return num(v, digits);
  };

  const pctNullable = (v: any) => {
    if (v === null || v === undefined) return "-";
    return pct(v);
  };

  const phase1HelpItems = (() => {
    const items: HelpItem[] = [];
    const dc = structuralIntegrity?.dataContinuity;
    const lb = structuralIntegrity?.lookAheadBias;
    const lf = structuralIntegrity?.logicFeasibility;

    if (dc?.verdict === "FAIL") {
      const details = String(dc?.details || "");

      if (details.toLowerCase().includes("no trades found")) {
        items.push({
          title: "Phase 1.1: Data Continuity (No trades)",
          meaningEn: "No trades exist in the exported results, so the app cannot validate time continuity. This usually means the strategy never entered trades in this timerange.",
          meaningAr: "لا توجد صفقات في نتائج الباكتيست، لذلك لا يمكن للتطبيق التحقق من استمرارية الزمن. غالبًا يعني هذا أن الاستراتيجية لم تُنفذ أي دخول ضمن الفترة.",
          fixEn: [
            "Confirm the timerange includes market conditions where your strategy should trade.",
            "Loosen entry filters or reduce confirmations to allow some trades.",
            "Ensure data for the configured pairs/timeframe is downloaded (missing data can also result in no trades).",
          ],
        });
      } else if (details.toLowerCase().includes("not monotonic") || details.toLowerCase().includes("missing/invalid")) {
        items.push({
          title: "Phase 1.1: Data Continuity (Invalid timestamps)",
          meaningEn: "Some trade timestamps are missing/invalid or out of order. This can invalidate analysis and suggests corrupt export or parsing issues.",
          meaningAr: "بعض طوابع وقت الصفقات مفقودة/غير صالحة أو غير مرتبة زمنيًا. هذا قد يُبطل التحليل ويشير لخلل في التصدير أو القراءة.",
          fixEn: [
            "Re-run the backtest export to regenerate the JSON results file.",
            "Ensure the backtest results JSON file is not manually edited or truncated.",
            "Verify your system time/timezone settings are stable and the export format is consistent.",
          ],
        });
      } else if (Number(dc?.gapCount) > 0) {
        items.push({
          title: "Phase 1.1: Data Continuity (Large gaps)",
          meaningEn: `The app detected unusually large time gaps between trades (count: ${Number(dc?.gapCount)}, largest: ${Number(dc?.largestGapMinutes).toFixed(0)} min). This can indicate missing market data, timerange gaps, or simply a strategy that does not trade for long periods.`,
          meaningAr: `تم اكتشاف فجوات زمنية كبيرة وغير معتادة بين الصفقات (العدد: ${Number(dc?.gapCount)}، أكبر فجوة: ${Number(dc?.largestGapMinutes).toFixed(0)} دقيقة). قد يدل ذلك على نقص بيانات السوق، أو فجوات في الفترة الزمنية، أو أن الاستراتيجية لا تتداول لفترات طويلة.`,
          fixEn: [
            "Confirm whether your strategy is expected to be inactive during that period (this can be normal).",
            "Verify your timerange is continuous and matches available data.",
            "Re-download OHLCV data for the exact pairs and timeframe used in the backtest, then rerun.",
            "Check for timeframe mismatch (e.g., data downloaded for 1h but backtest runs on 4h).",
          ],
        });
      } else {
        items.push({
          title: "Phase 1.1: Data Continuity (Issue)",
          meaningEn: details || "Data continuity checks failed.",
          meaningAr: "فشل فحص استمرارية البيانات.",
          fixEn: [
            "Re-download data and rerun the backtest.",
            "Verify timerange and pair/timeframe configuration.",
          ],
        });
      }
    }

    if (lb?.verdict === "FAIL") {
      const suspicious = Array.isArray(lb?.suspiciousConditions) ? lb.suspiciousConditions.join(", ") : "";
      items.push({
        title: "Phase 1.2: Look-ahead Bias",
        meaningEn: `The strategy code shows patterns that may use future data (look-ahead bias). This can make backtests unrealistically good and invalid for live trading. ${suspicious ? `Suspicious: ${suspicious}` : ""}`,
        meaningAr: `تم العثور على أنماط في كود الاستراتيجية قد تستخدم بيانات مستقبلية (انحياز النظر للأمام). هذا قد يجعل الباكتيست يبدو أفضل من الواقع ويكون غير صالح للتداول الحقيقي. ${suspicious ? `الأنماط: ${suspicious}` : ""}`,
        fixEn: [
          "Remove any usage of future candles (e.g., shift(-1), negative shifts, or indexing that peeks ahead).",
          "Ensure signals are computed only from current/past rows.",
          "Use adequate startup candles so indicators are stable before generating signals.",
        ],
      });
    }

    if (lf?.verdict === "FAIL") {
      const conflicts: string[] = Array.isArray(lf?.conflictingRules) ? lf.conflictingRules : [];
      const mutuallyExclusive: string[] = Array.isArray(lf?.mutuallyExclusiveConditions) ? lf.mutuallyExclusiveConditions : [];

      const addLogicItem = (title: string, meaningEn: string, meaningAr: string, fixEn: string[]) => {
        items.push({ title, meaningEn, meaningAr, fixEn });
      };

      for (const rule of conflicts) {
        const r = String(rule || "");
        if (r.toLowerCase().includes("strategy source is empty")) {
          addLogicItem(
            "Phase 1.3: Logic Feasibility (Missing strategy source)",
            "The strategy file could not be loaded or is empty, so feasibility analysis cannot be trusted.",
            "ملف الاستراتيجية لم يتم تحميله أو أنه فارغ، لذلك لا يمكن الاعتماد على تحليل المنطق.",
            [
              "Ensure the strategyPath you selected exists in the Files table and can be read.",
              "Open the strategy file in the app and confirm it has the expected code.",
              "Re-sync filesystem to DB if needed, then re-run analysis.",
            ],
          );
          continue;
        }
        if (r.toLowerCase().includes("missing entry function")) {
          addLogicItem(
            "Phase 1.3: Logic Feasibility (Missing entry function)",
            "The strategy does not define an entry function, so it cannot generate buy/enter signals.",
            "الاستراتيجية لا تحتوي على دالة الدخول (Entry)، لذلك لا يمكنها توليد إشارات شراء/دخول.",
            [
              "Implement populate_entry_trend (or populate_buy_trend for older style).",
              "Set enter_long/buy (and enter_short if applicable) when conditions are met.",
            ],
          );
          continue;
        }
        if (r.toLowerCase().includes("entry function exists") && r.toLowerCase().includes("no entry signal")) {
          addLogicItem(
            "Phase 1.3: Logic Feasibility (No entry signals set)",
            "The entry function exists but it does not set any entry signal columns, so no trades can open.",
            "دالة الدخول موجودة لكن لا يتم تعيين أعمدة إشارات الدخول، لذلك لن تفتح أي صفقات.",
            [
              "Inside populate_entry_trend, set dataframe.loc[conditions, 'enter_long'] = 1 (or 'buy' for older style).",
              "Verify your conditions actually become true for some candles.",
            ],
          );
          continue;
        }
        if (r.toLowerCase().startsWith("stoploss is set to")) {
          addLogicItem(
            "Phase 1.3: Logic Feasibility (Stoploss sign)",
            "Stoploss in Freqtrade is typically negative (e.g., -0.10). A non-negative stoploss can break risk logic.",
            "قيمة وقف الخسارة في Freqtrade تكون عادة سالبة (مثل -0.10). إذا كانت غير سالبة قد يسبب ذلك خللاً في إدارة المخاطر.",
            [
              "Set stoploss to a negative number (example: -0.10 for -10%).",
              "Confirm stoploss is defined consistently in both config.json and the strategy.",
            ],
          );
          continue;
        }
        if (r.toLowerCase().includes("no exit mechanism")) {
          addLogicItem(
            "Phase 1.3: Logic Feasibility (Missing exits)",
            "No clear exit mechanism detected. Trades may stay open too long or behave unpredictably.",
            "لم يتم اكتشاف آلية خروج واضحة. قد تبقى الصفقات مفتوحة لفترة طويلة أو تتصرف بشكل غير متوقع.",
            [
              "Implement populate_exit_trend (or populate_sell_trend).",
              "Define minimal_roi and stoploss (and trailing if needed).",
              "Verify exits trigger in backtests (check exit_reason distribution).",
            ],
          );
          continue;
        }
        if (r.toLowerCase().includes("can_short") && r.toLowerCase().includes("enter_short")) {
          addLogicItem(
            "Phase 1.3: Logic Feasibility (Short settings mismatch)",
            "Short entries are present, but can_short is disabled. This mismatch can cause unexpected behavior.",
            "تم العثور على إشارات بيع/شورت لكن can_short معطل. هذا التعارض قد يسبب سلوكًا غير متوقع.",
            [
              "If you want shorts, set can_short = True and ensure exchange/market supports it.",
              "If you do not want shorts, remove enter_short logic.",
            ],
          );
          continue;
        }
        if (r.toLowerCase().includes("no obvious strategy class")) {
          addLogicItem(
            "Phase 1.3: Logic Feasibility (Strategy class not detected)",
            "The analyzer could not detect a valid strategy class. This can happen if the file is not a standard Freqtrade strategy.",
            "لم يتمكن المحلل من اكتشاف كلاس استراتيجية صالح. قد يحدث ذلك إذا كان الملف ليس بصيغة استراتيجية Freqtrade المعتادة.",
            [
              "Ensure the file defines a class that inherits IStrategy.",
              "Verify the strategy file content matches Freqtrade conventions.",
            ],
          );
          continue;
        }

        addLogicItem(
          "Phase 1.3: Logic Feasibility (Conflict)",
          r,
          "تم اكتشاف تعارض منطقي في الاستراتيجية.",
          [
            "Simplify entry/exit conditions and validate each piece triggers as expected.",
            "Run a smaller backtest and inspect whether signals appear on the dataframe.",
          ],
        );
      }

      for (const cond of mutuallyExclusive) {
        items.push({
          title: "Phase 1.3: Logic Feasibility (Mutually exclusive condition)",
          meaningEn: String(cond || "A potentially impossible condition was detected."),
          meaningAr: "تم اكتشاف شرطين متعارضين (يصعب تحققهما معًا) داخل قاعدة واحدة.",
          fixEn: [
            "Review the rule and remove contradictory thresholds.",
            "Log indicator values around expected entry points to confirm realistic ranges.",
          ],
        });
      }
    }

    return items;
  })();

  const phase9HelpItems = (() => {
    const items: HelpItem[] = [];
    const flags: string[] = Array.isArray(statistics?.redFlags) ? statistics.redFlags : [];
    const verdict = String(statistics?.sampleAdequacy?.verdict || "");
    const justification = String(statistics?.sampleAdequacy?.justification || "");

    if (verdict === "FAIL") {
      if (justification.toLowerCase().includes("sample size") || flags.some((f) => String(f).toLowerCase().includes("low sample"))) {
        items.push({
          title: "Phase 9: Sample size too small",
          meaningEn: justification || "Trade count is too low to make reliable statistical conclusions.",
          meaningAr: "عدد الصفقات قليل جدًا لاتخاذ استنتاجات إحصائية موثوقة.",
          fixEn: [
            "Extend the timerange.",
            "Add more pairs (carefully).",
            "Slightly loosen filters to get enough samples, then re-evaluate quality.",
          ],
        });
      }

      if (justification.toLowerCase().includes("crosses 0") || flags.some((f) => String(f).toLowerCase().includes("crosses"))) {
        items.push({
          title: "Phase 9: Edge not statistically significant",
          meaningEn: justification || "The 95% confidence interval crosses 0. The apparent edge may be noise.",
          meaningAr: "فاصل الثقة 95% يمر عبر الصفر، لذا قد تكون الأفضلية مجرد ضوضاء وليست ميزة حقيقية.",
          fixEn: [
            "Validate the strategy on different timeranges and regimes.",
            "Rerun backtest after adjusting one variable at a time.",
            "Reduce trade frequency (cooldown / stronger filters).",
          ],
        });
      }
    }

    if (flags.some((f) => String(f).toLowerCase().includes("expectancy ci below zero")) || justification.toLowerCase().includes("below 0")) {
      items.push({
        title: "Phase 9: Edge is statistically negative",
        meaningEn: justification || "The 95% confidence interval is below 0. The strategy is likely unprofitable.",
        meaningAr: "فاصل الثقة 95% يقع بالكامل تحت الصفر، وهذا يعني أن الاستراتيجية غالبًا غير مربحة.",
        fixEn: [
          "Improve expectancy: increase win rate (signal quality) or improve payoff ratio (cut losses / let winners run).",
          "Add regime filters to avoid conditions where the strategy underperforms.",
          "Run more conservative assumptions (fees/slippage stress testing).",
        ],
      });
    }

    if (flags.some((f) => String(f).toLowerCase().includes("variance"))) {
      items.push({
        title: "Phase 9: High variance / unstable edge",
        meaningEn: "Per-trade returns vary widely. Even if the average looks OK, high variance makes results unreliable and increases drawdown risk.",
        meaningAr: "تذبذب عوائد الصفقات كبير. حتى لو كان المتوسط جيدًا، فإن التباين العالي يجعل النتائج غير مستقرة ويزيد مخاطر السحب.",
        fixEn: [
          "Improve risk controls and exits.",
          "Reduce position sizing and limit concurrent trades.",
          "Validate the strategy on different timeranges and regimes.",
        ],
      });
    }

    for (const f of flags) {
      const txt = String(f || "").trim();
      if (!txt) continue;

      const low = txt.toLowerCase();
      if (low.includes("low sample")) continue;
      if (low.includes("crosses")) continue;
      if (low.includes("expectancy ci below zero")) continue;
      if (low.includes("variance")) continue;

      items.push({
        title: "Phase 9: Statistics note",
        meaningEn: txt,
        meaningAr: "ملاحظة من التحليل الإحصائي.",
        fixEn: [
          "Validate the strategy on different timeranges and regimes.",
          "Extend the timerange.",
        ],
      });
    }

    return items;
  })();

  const phase8HelpItems = (() => {
    const items: HelpItem[] = [];
    const flags: string[] = Array.isArray(logicIntegrity?.redFlags) ? logicIntegrity.redFlags : [];
    const overfitRisk = String(logicIntegrity?.overfitting?.overfittingRisk || "");
    const complexityScore = Number(logicIntegrity?.overfitting?.complexityScore);
    const indicatorCount = Number(logicIntegrity?.overfitting?.indicatorCount);
    
    const hasOverfit = overfitRisk.toLowerCase() === "high" || overfitRisk.toLowerCase() === "medium";
    if (hasOverfit) {
      items.push({
        title: "Phase 8: Overfitting / complexity risk",
        meaningEn: `The strategy appears complex (risk: ${overfitRisk || "-"}, complexity: ${Number.isFinite(complexityScore) ? complexityScore : "-"}/100, indicators: ${Number.isFinite(indicatorCount) ? indicatorCount : "-"}). Complex rules and many parameters can overfit backtests and fail live.`,
        meaningAr: `تبدو الاستراتيجية معقدة (الخطر: ${overfitRisk || "-"}، التعقيد: ${Number.isFinite(complexityScore) ? complexityScore : "-"}/100، عدد المؤشرات: ${Number.isFinite(indicatorCount) ? indicatorCount : "-"}). التعقيد الزائد قد يؤدي إلى overfitting وفشل في التداول الحقيقي.`,
        fixEn: [
          "Simplify entry/exit conditions and validate each piece triggers as expected.",
          "Rerun backtest after adjusting one variable at a time.",
          "Validate the strategy on different timeranges and regimes.",
        ],
      });
    }
    const hasLookahead =
      flags.some((f) => String(f).toLowerCase().includes("look-ahead")) ||
      flags.some((f) => String(f).toLowerCase().includes("shift(-)"));
    if (hasLookahead) {
      items.push({
        title: "Phase 8: Potential look-ahead bias",
        meaningEn: "Strategy logic may reference future data (e.g., negative shift). This invalidates backtests and can create unrealistically good results.",
        meaningAr: "قد يستخدم منطق الاستراتيجية بيانات مستقبلية (مثل shift(-)). هذا يبطل نتائج الباكتيست وقد يعطي نتائج غير واقعية.",
        fixEn: [
          "Remove any usage of future candles (e.g., shift(-1), negative shifts, or indexing that peeks ahead).",
          "Ensure signals are computed only from current/past rows.",
          "Use adequate startup candles so indicators are stable before generating signals.",
        ],
      });
    }

    const errs: string[] = Array.isArray(logicIntegrity?.signalConflicts?.logicErrors)
      ? logicIntegrity.signalConflicts.logicErrors
      : [];
    for (const e of errs) {
      const txt = String(e || "").trim();
      if (!txt) continue;
      if (txt.toLowerCase().includes("missing populate_entry")) {
        items.push({
          title: "Phase 8: Entry function missing",
          meaningEn: txt,
          meaningAr: "دالة الدخول مفقودة أو غير صحيحة.",
          fixEn: [
            "Implement populate_entry_trend (or populate_buy_trend for older style).",
            "Inside populate_entry_trend, set dataframe.loc[conditions, 'enter_long'] = 1 (or 'buy' for older style).",
          ],
        });
        continue;
      }
      if (txt.toLowerCase().includes("no clear exit")) {
        items.push({
          title: "Phase 8: Exit mechanism missing",
          meaningEn: txt,
          meaningAr: "لا يوجد نظام خروج واضح (ROI/Stoploss/Exit signal).",
          fixEn: [
            "Implement populate_exit_trend (or populate_sell_trend).",
            "Define minimal_roi and stoploss (and trailing if needed).",
            "Verify exits trigger in backtests (check exit_reason distribution).",
          ],
        });
        continue;
      }

      items.push({
        title: "Phase 8: Logic integrity note",
        meaningEn: txt,
        meaningAr: "ملاحظة من تحليل سلامة المنطق.",
        fixEn: [
          "Simplify entry/exit conditions and validate each piece triggers as expected.",
          "Run a smaller backtest and inspect whether signals appear on the dataframe.",
        ],
      });
    }

    return items;
  })();

  const phase7HelpItems = (() => {
    const items: HelpItem[] = [];
    const flags: string[] = Array.isArray(costAnalysis?.redFlags) ? costAnalysis.redFlags : [];
    const verdict = String(costAnalysis?.costSensitivity?.verdict || "");
    const liquidityRisk = String(costAnalysis?.liquidity?.liquidityRisk || "");

    const hasEdgeThin = flags.some((f) => String(f).toLowerCase().includes("edge too thin")) || verdict.toLowerCase().includes("edge disappears");
    if (hasEdgeThin) {
      items.push({
        title: "Phase 7: Edge too thin after costs",
        meaningEn: "When you increase fees/slippage to more realistic levels, the strategy loses profitability. This usually means the edge is too small for live trading.",
        meaningAr: "عند زيادة الرسوم/الانزلاق لافتراضات أكثر واقعية، تفقد الاستراتيجية الربحية. هذا يعني غالبًا أن الأفضلية صغيرة جدًا للتداول الحقيقي.",
        fixEn: [
          "Run more conservative assumptions (fees/slippage stress testing).",
          "Avoid overly tight targets that are sensitive to execution costs.",
          "Reduce trade frequency (cooldown / stronger filters).",
        ],
      });
    }

    const hasLiquidityIssue =
      flags.some((f) => String(f).toLowerCase().includes("unrealistic fills")) ||
      liquidityRisk.toLowerCase() === "high" ||
      liquidityRisk.toLowerCase() === "medium";
    if (hasLiquidityIssue) {
      items.push({
        title: "Phase 7: Liquidity / fill realism risk",
        meaningEn: "Order sizes may be large relative to market volume, making backtest fills unrealistic and slippage underestimated.",
        meaningAr: "قد تكون أحجام الأوامر كبيرة مقارنة بحجم السوق، مما يجعل تنفيذ الباكتيست غير واقعي ويقلل تقدير الانزلاق.",
        fixEn: [
          "Prefer high-liquidity pairs.",
          "Reduce stake size per trade.",
          "Lower max_open_trades.",
        ],
      });
    }

    for (const f of flags) {
      const txt = String(f || "").trim();
      if (!txt) continue;
      if (txt.toLowerCase().includes("edge too thin") || txt.toLowerCase().includes("unrealistic fills")) continue;
      items.push({
        title: "Phase 7: Cost analysis note",
        meaningEn: txt,
        meaningAr: "ملاحظة من تحليل التكاليف/السيولة.",
        fixEn: [
          "Run more conservative assumptions (fees/slippage stress testing).",
          "Prefer high-liquidity pairs.",
        ],
      });
    }

    return items;
  })();

  const phase6HelpItems = (() => {
    const items: HelpItem[] = [];
    const regimeFlags: string[] = Array.isArray(regimeAnalysis?.regimeSegmentation?.redFlags)
      ? regimeAnalysis.regimeSegmentation.redFlags
      : [];
    const assetFlags: string[] = Array.isArray(regimeAnalysis?.assetAnalysis?.concentration?.redFlags)
      ? regimeAnalysis.assetAnalysis.concentration.redFlags
      : [];

    for (const f of regimeFlags) {
      const txt = String(f || "");
      if (txt.toLowerCase().includes("varies strongly by regime")) {
        items.push({
          title: "Phase 6: Strong regime dependence",
          meaningEn: "Results change significantly across regimes (trend/volatility). This usually means the strategy has edge only in specific conditions.",
          meaningAr: "النتائج تختلف بشكل كبير حسب النظام (اتجاه/تذبذب). غالبًا يعني أن الاستراتيجية تعمل فقط في ظروف معينة.",
          fixEn: [
            "Add regime filters (trend/volatility) so the strategy trades only where it has edge.",
            "Validate performance per regime with out-of-sample periods.",
          ],
        });
        continue;
      }

      items.push({
        title: "Phase 6: Regime analysis note",
        meaningEn: txt,
        meaningAr: "ملاحظة من تحليل النظام (Regime).",
        fixEn: [
          "Validate across multiple timeranges and market regimes.",
          "Extend the timerange and/or add more pairs.",
        ],
      });
    }

    for (const f of assetFlags) {
      const txt = String(f || "");
      if (txt.toLowerCase().includes("highly concentrated") || txt.toLowerCase().includes("top 3")) {
        items.push({
          title: "Phase 6: PnL concentration risk",
          meaningEn: "Most of your strategy’s results come from a small number of pairs. This increases overfitting and diversification risk.",
          meaningAr: "معظم نتائج الاستراتيجية تأتي من عدد قليل من الأزواج. هذا يزيد خطر الـ overfitting ويقلل التنويع.",
          fixEn: [
            "Test on a broader universe of pairs.",
            "Limit per-pair exposure and enforce diversification.",
          ],
        });
        continue;
      }

      items.push({
        title: "Phase 6: Asset analysis note",
        meaningEn: txt,
        meaningAr: "ملاحظة من تحليل الأصول.",
        fixEn: [
          "Extend the timerange and/or add more pairs.",
          "Verify data is downloaded for the pairs/timeframe.",
        ],
      });
    }

    return items;
  })();

  const phase4HelpItems = (() => {
    const items: HelpItem[] = [];
    const flags: string[] = Array.isArray(entryQuality?.redFlags) ? entryQuality.redFlags : [];
    const timingFlags: string[] = Array.isArray(entryQuality?.timing?.redFlags) ? entryQuality.timing.redFlags : [];

    for (const f of flags) {
      const txt = String(f || "");
      if (txt.toLowerCase().includes("empty enter_tag")) {
        items.push({
          title: "Phase 4: Missing enter_tag attribution",
          meaningEn: "Most trades do not have an entry tag, so you cannot tell which entry rule is causing profits/losses. This makes tuning difficult.",
          meaningAr: "معظم الصفقات لا تحتوي على enter_tag، لذلك لا يمكنك معرفة أي شرط دخول يسبب الربح/الخسارة. هذا يصعّب التحسين.",
          fixEn: [
            "Set enter_tag in populate_entry_trend to label each entry rule.",
            "Run backtest again and compare PnL by tag.",
            "Disable or improve the worst-performing tag first.",
          ],
        });
        continue;
      }
      if (txt.toLowerCase().includes("entry tag") && txt.toLowerCase().includes("losing overall")) {
        items.push({
          title: "Phase 4: One entry setup is losing",
          meaningEn: "A specific entry tag is consistently losing. This usually means that entry condition triggers in bad regimes or too late.",
          meaningAr: "أحد شروط/أنماط الدخول (enter_tag) يسبب خسائر بشكل متكرر. غالبًا يعني أنه يعمل في أنظمة سوق سيئة أو يدخل متأخرًا.",
          fixEn: [
            "Simplify entry/exit conditions and validate each piece triggers as expected.",
            "Loosen entry filters or reduce confirmations to allow some trades.",
            "Tighten stoploss or add earlier invalidation exits.",
          ],
        });
        continue;
      }

      items.push({
        title: "Phase 4: Entry quality red flag",
        meaningEn: txt,
        meaningAr: "تم اكتشاف مؤشر خطر يتعلق بجودة الدخول.",
        fixEn: [
          "Simplify entry/exit conditions and validate each piece triggers as expected.",
          "Run a smaller backtest and inspect whether signals appear on the dataframe.",
        ],
      });
    }

    for (const f of timingFlags) {
      const txt = String(f || "");
      if (txt.toLowerCase().includes("losing trades close quickly")) {
        items.push({
          title: "Phase 4: Many quick losers (late/noisy entries)",
          meaningEn: "Many losing trades become losers quickly after entry. This often indicates late entries, overtrading noise, or missing regime filters.",
          meaningAr: "عدد كبير من الصفقات الخاسرة يصبح خاسرًا بسرعة بعد الدخول. غالبًا بسبب دخول متأخر أو تداول ضوضاء أو غياب فلاتر النظام السوقي.",
          fixEn: [
            "Simplify entry conditions and test one confirmation at a time.",
            "Avoid buying after large pumps; add trend/volatility regime filters.",
            "Tighten stoploss or add earlier invalidation exits.",
          ],
        });
        continue;
      }

      items.push({
        title: "Phase 4: Entry timing red flag",
        meaningEn: txt,
        meaningAr: "تم اكتشاف مؤشر خطر يتعلق بتوقيت الدخول.",
        fixEn: [
          "Simplify entry/exit conditions and validate each piece triggers as expected.",
          "Log indicator values around expected entry points to confirm realistic ranges.",
        ],
      });
    }

    return items;
  })();

  const phase5HelpItems = (() => {
    const items: HelpItem[] = [];
    const conclusions: string[] = Array.isArray(exitLogic?.exitReasons?.conclusions)
      ? exitLogic.exitReasons.conclusions
      : [];
    const antiPatterns: string[] = Array.isArray(exitLogic?.duration?.antiPatterns)
      ? exitLogic.duration.antiPatterns
      : [];

    for (const c of conclusions) {
      const txt = String(c || "");
      if (txt.toLowerCase().includes("stop losses are catastrophic")) {
        items.push({
          title: "Phase 5: Stoploss exits are catastrophic",
          meaningEn: "A large share of your total losses comes from stoploss exits. This usually means stops are too wide, entries are too late, or the strategy holds losers until they become large.",
          meaningAr: "جزء كبير من الخسائر يأتي من صفقات خرجت عبر وقف الخسارة. غالبًا يعني أن وقف الخسارة واسع جدًا أو الدخول متأخر أو يتم ترك الخاسرين يكبرون.",
          fixEn: [
            "Tighten stoploss or add earlier invalidation exits.",
            "Add trailing stop or improve exit logic to protect winners.",
            "Verify exits trigger in backtests (check exit_reason distribution).",
          ],
        });
        continue;
      }
      if (txt.toLowerCase().includes("timeout exits are net negative")) {
        items.push({
          title: "Phase 5: Timeout exits are negative",
          meaningEn: "Trades that are held too long tend to end negative. This suggests the edge decays with time or the exit rules do not invalidate losing ideas early.",
          meaningAr: "الصفقات التي تُمسك لفترة طويلة غالبًا تنتهي بخسارة. هذا يدل أن الأفضلية تتلاشى بمرور الوقت أو أن الخروج لا يُبطل الفكرة الخاسرة مبكرًا.",
          fixEn: [
            "Implement populate_exit_trend (or populate_sell_trend).",
            "Verify exits trigger in backtests (check exit_reason distribution).",
            "Tighten stoploss or add earlier invalidation exits.",
          ],
        });
        continue;
      }
      if (txt.toLowerCase().includes("trailing stops may be cutting winners")) {
        items.push({
          title: "Phase 5: Trailing stop may be too tight",
          meaningEn: "Trailing stops are taking profits too early and may be cutting winning trades before they can develop.",
          meaningAr: "الـ trailing stop قد يكون ضيقًا جدًا مما يؤدي لإغلاق الصفقات الرابحة مبكرًا قبل أن تحقق كامل الحركة.",
          fixEn: [
            "Add trailing stop or improve exit logic to protect winners.",
            "Define minimal_roi and stoploss (and trailing if needed).",
          ],
        });
        continue;
      }
      if (txt.toLowerCase().includes("exit signals") && txt.toLowerCase().includes("closing trades at a loss")) {
        items.push({
          title: "Phase 5: Exit signal is losing",
          meaningEn: "Your exit signal tends to close trades while they are still negative. This can happen when exit triggers too late (after drawdown) or too early (noise), depending on the strategy.",
          meaningAr: "إشارة الخروج تقوم غالبًا بإغلاق الصفقات وهي خاسرة. قد يحدث هذا إذا كانت الإشارة متأخرة بعد السحب أو مبكرة بسبب الضوضاء حسب الاستراتيجية.",
          fixEn: [
            "Implement populate_exit_trend (or populate_sell_trend).",
            "Simplify entry/exit conditions and validate each piece triggers as expected.",
            "Verify exits trigger in backtests (check exit_reason distribution).",
          ],
        });
        continue;
      }

      items.push({
        title: "Phase 5: Exit logic issue",
        meaningEn: txt,
        meaningAr: "تم اكتشاف مشكلة في منطق الخروج.",
        fixEn: [
          "Implement populate_exit_trend (or populate_sell_trend).",
          "Verify exits trigger in backtests (check exit_reason distribution).",
        ],
      });
    }

    for (const a of antiPatterns) {
      const txt = String(a || "");
      if (txt.toLowerCase().includes("losers") && txt.toLowerCase().includes("held longer")) {
        items.push({
          title: "Phase 5: Losers held longer than winners",
          meaningEn: "Holding losers longer than winners is a classic risk/reward anti-pattern that destroys expectancy.",
          meaningAr: "إمساك الصفقات الخاسرة لمدة أطول من الرابحة هو نمط سلبي مشهور يدمّر الأفضلية (expectancy).",
          fixEn: [
            "Tighten stoploss or add earlier invalidation exits.",
            "Add trailing stop or improve exit logic to protect winners.",
          ],
        });
        continue;
      }

      items.push({
        title: "Phase 5: Duration anti-pattern",
        meaningEn: txt,
        meaningAr: "تم اكتشاف نمط سلبي يتعلق بمدة الاحتفاظ بالصفقات.",
        fixEn: [
          "Tighten stoploss or add earlier invalidation exits.",
          "Verify exits trigger in backtests (check exit_reason distribution).",
        ],
      });
    }

    return items;
  })();

  const phase2HelpItems = (() => {
    const items: HelpItem[] = [];
    const flags: string[] = Array.isArray(performance?.expectancy?.redFlags)
      ? performance.expectancy.redFlags
      : [];

    const mapFlag = (flag: string): HelpItem => {
      switch (flag) {
        case "No trades executed":
          return {
            title: "Phase 2: No trades executed",
            meaningEn: "The strategy produced zero trades in the backtest. This often means the rules are too strict or never trigger.",
            meaningAr: "الاستراتيجية لم تُنفذ أي صفقات في الباكتيست. غالبًا يعني أن الشروط صارمة جدًا أو لا تتحقق.",
            fixEn: [
              "Loosen entry filters or reduce confirmations.",
              "Extend the timerange and/or add more pairs.",
              "Verify data is downloaded for the pairs/timeframe.",
            ],
          };
        case "Loss magnitude dominates wins":
          return {
            title: "Phase 2: Loss magnitude dominates wins",
            meaningEn: "You may have a decent win rate, but the average losing trade is larger than the average winner, making expectancy negative.",
            meaningAr: "قد تكون نسبة الفوز جيدة، لكن متوسط الخسارة أكبر من متوسط الربح، فيصبح العائد المتوقع سلبيًا.",
            fixEn: [
              "Tighten stoploss or add earlier invalidation exits.",
              "Add trailing stop or improve exit logic to protect winners.",
              "Reduce position size to control drawdown impact.",
            ],
          };
        case "Low win rate / entry timing issue":
          return {
            title: "Phase 2: Low win rate / entry timing issue",
            meaningEn: "Average winners can be larger than losers, but too many trades lose. This often points to poor entries or trading in noise.",
            meaningAr: "قد يكون متوسط الربح أكبر من الخسارة، لكن عدد الخاسرين كبير. غالبًا المشكلة في توقيت الدخول أو التداول وسط الضوضاء.",
            fixEn: [
              "Add trend/regime filters to avoid choppy markets.",
              "Require stronger confirmations (but avoid over-filtering).",
              "Reduce trade frequency by adding cooldown or higher timeframe signals.",
            ],
          };
        case "Signal quality failure":
          return {
            title: "Phase 2: Signal quality failure",
            meaningEn: "Both win rate and payoff ratio are unfavorable. The strategy likely has little edge or exits are ineffective.",
            meaningAr: "نسبة الفوز ونسبة العائد/المخاطرة كلاهما سيئ. غالبًا لا توجد أفضلية حقيقية أو أن الخروج غير فعّال.",
            fixEn: [
              "Rework entries: focus on fewer, higher-quality signals.",
              "Improve exits and risk controls (stoploss, trailing, ROI structure).",
              "Test on different regimes/timeframes to find where the strategy has an edge.",
            ],
          };
        case "Low sample size (< 30 trades)":
          return {
            title: "Phase 2: Low sample size",
            meaningEn: "The backtest has too few trades to be statistically meaningful. Results can be misleading.",
            meaningAr: "عدد الصفقات قليل جدًا ليكون التحليل إحصائيًا موثوقًا. النتائج قد تكون مضللة.",
            fixEn: [
              "Extend the timerange.",
              "Add more pairs (carefully).",
              "Slightly loosen filters to get enough samples, then re-evaluate quality.",
            ],
          };
        case "Very high trade frequency (> 50 trades/day) suggests noise trading":
          return {
            title: "Phase 2: Very high trade frequency",
            meaningEn: "Trading too frequently often means the strategy is reacting to noise, increasing fees and reducing edge.",
            meaningAr: "التداول بكثرة غالبًا يعني أن الاستراتيجية تتفاعل مع الضوضاء، مما يزيد الرسوم ويقلل الأفضلية.",
            fixEn: [
              "Add a trend filter (e.g., only trade with higher-timeframe trend).",
              "Add cooldown or minimum candle spacing between entries.",
              "Increase timeframe or require stronger confirmations.",
            ],
          };
        case "Very high capital deployment per trade (> 90%) increases exposure risk":
          return {
            title: "Phase 2: Very high capital deployment",
            meaningEn: "Using most of the wallet per trade increases exposure and can amplify drawdowns.",
            meaningAr: "استخدام معظم رأس المال في صفقة واحدة يزيد المخاطرة وقد يضخم السحب (Drawdown).",
            fixEn: [
              "Reduce stake amount or use fractional position sizing.",
              "Limit max_open_trades.",
              "Diversify across pairs only if the strategy edge is robust.",
            ],
          };
        default:
          return {
            title: "Phase 2: Red flag",
            meaningEn: flag,
            meaningAr: "تم اكتشاف مؤشر خطر في الأداء.",
            fixEn: [
              "Review entry/exit logic and risk controls.",
              "Rerun backtest after adjusting one variable at a time.",
            ],
          };
      }
    };

    for (const f of flags) {
      items.push(mapFlag(String(f)));
    }
    return items;
  })();

  const phase3HelpItems = (() => {
    const items: HelpItem[] = [];
    const fps: string[] = Array.isArray(drawdownRisk?.drawdownStructure?.failurePatterns)
      ? drawdownRisk.drawdownStructure.failurePatterns
      : [];
    const rfs: string[] = Array.isArray(drawdownRisk?.riskPerTrade?.redFlags)
      ? drawdownRisk.riskPerTrade.redFlags
      : [];

    const mapP3 = (txt: string): HelpItem => {
      if (txt.includes("Steep vertical drops")) {
        return {
          title: "Phase 3: Steep drawdown drops",
          meaningEn: "Drawdowns happen quickly. This often indicates stops are ineffective, position sizing is too aggressive, or the strategy is exposed to sudden moves.",
          meaningAr: "يحدث السحب بسرعة وبشكل حاد. غالبًا بسبب وقف خسارة غير فعّال، أو حجم صفقة كبير، أو التعرض لحركات مفاجئة.",
          fixEn: [
            "Reduce position size and/or lower max_open_trades.",
            "Tighten stoploss or add earlier invalidation exits.",
            "Avoid illiquid pairs and consider volatility filters.",
          ],
        };
      }
      if (txt.includes("Long recovery time")) {
        return {
          title: "Phase 3: Long recovery",
          meaningEn: "After losses, equity takes a long time to recover. This can point to weak exits, low edge, or trading through bad regimes.",
          meaningAr: "بعد الخسائر يستغرق رأس المال وقتًا طويلًا للتعافي. قد يدل على خروج ضعيف أو أفضلية ضعيفة أو التداول في أنظمة سوق سيئة.",
          fixEn: [
            "Improve exits (ROI/trailing/invalidations) to stop bleeding.",
            "Add regime filters to avoid conditions where the strategy underperforms.",
            "Reduce exposure until the edge is confirmed.",
          ],
        };
      }
      if (txt.includes("No full recovery")) {
        return {
          title: "Phase 3: No full recovery",
          meaningEn: "The largest drawdown was not recovered by the end of the backtest, suggesting persistent underperformance or too much exposure.",
          meaningAr: "أكبر سحب لم يتم التعافي منه حتى نهاية الباكتيست، مما يشير لأداء ضعيف مستمر أو تعرض عالي.",
          fixEn: [
            "Reduce position sizing and limit concurrent trades.",
            "Validate the strategy on different timeranges and regimes.",
            "Improve risk controls and exits.",
          ],
        };
      }
      if (txt.includes("Multiple frequent drawdowns")) {
        return {
          title: "Phase 3: Frequent drawdowns",
          meaningEn: "Many drawdowns often indicate the strategy trades in unsuitable regimes or the signals are noisy.",
          meaningAr: "تكرار السحوبات غالبًا يعني أن الاستراتيجية تتداول في أنظمة غير مناسبة أو أن الإشارات مليئة بالضوضاء.",
          fixEn: [
            "Add trend/range regime detection and trade only the profitable regime.",
            "Reduce trade frequency (cooldown / stronger filters).",
            "Re-check signal logic for noise sensitivity.",
          ],
        };
      }
      if (txt.includes("Worst trade risk exceeds")) {
        return {
          title: "Phase 3: Worst trade risk too high",
          meaningEn: "A single trade can damage the equity too much, increasing the chance of ruin.",
          meaningAr: "هناك صفقة واحدة يمكن أن تُلحق ضررًا كبيرًا برأس المال، مما يزيد خطر الانهيار.",
          fixEn: [
            "Reduce stake size per trade.",
            "Tighten stoploss and ensure it is actually applied.",
            "Avoid highly volatile pairs or add volatility filters.",
          ],
        };
      }
      if (txt.includes("High position sizing")) {
        return {
          title: "Phase 3: Position sizing too large",
          meaningEn: "Average capital per trade is high, which amplifies drawdowns.",
          meaningAr: "متوسط رأس المال المستخدم في الصفقة كبير، مما يضخم السحب.",
          fixEn: [
            "Use smaller stake_amount or fractional sizing.",
            "Lower max_open_trades.",
            "Add exposure limits per pair.",
          ],
        };
      }
      if (txt.includes("Stoploss value not found")) {
        return {
          title: "Phase 3: Stoploss not found",
          meaningEn: "The diagnostic could not find a configured stoploss in the exported results/config, so it cannot validate stoploss behavior.",
          meaningAr: "لم يتم العثور على قيمة وقف خسارة في النتائج/الإعدادات، لذلك لا يمكن التحقق من سلوك وقف الخسارة.",
          fixEn: [
            "Define stoploss explicitly in the strategy or config.",
            "Ensure the exported results include the relevant config fields.",
          ],
        };
      }
      if (txt.includes("Stoploss not consistently respected")) {
        return {
          title: "Phase 3: Stoploss not respected",
          meaningEn: "Some losing trades exceed the expected stoploss threshold. This can happen due to gaps, slippage assumptions, or exit logic issues.",
          meaningAr: "بعض الصفقات الخاسرة تجاوزت حد وقف الخسارة المتوقع. قد يحدث ذلك بسبب فجوات، أو افتراضات الانزلاق السعري، أو خلل في الخروج.",
          fixEn: [
            "Re-check data continuity and avoid illiquid markets.",
            "Consider tighter stops or earlier exits.",
            "Reduce position size to limit tail-risk.",
          ],
        };
      }
      if (txt.includes("Slippage data not available")) {
        return {
          title: "Phase 3: Slippage unknown",
          meaningEn: "The export does not provide slippage, so real-world performance could be worse than backtest.",
          meaningAr: "لا توجد بيانات للانزلاق السعري في التصدير، لذا الأداء الحقيقي قد يكون أسوأ من الباكتيست.",
          fixEn: [
            "Run more conservative assumptions (fees/slippage stress testing).",
            "Prefer high-liquidity pairs.",
            "Avoid overly tight targets that are sensitive to execution costs.",
          ],
        };
      }

      return {
        title: "Phase 3: Risk/Drawdown issue",
        meaningEn: txt,
        meaningAr: "تم اكتشاف مشكلة تتعلق بالمخاطر أو السحب.",
        fixEn: [
          "Reduce exposure and improve exits.",
          "Validate across multiple timeranges and market regimes.",
        ],
      };
    };

    for (const fp of fps) items.push(mapP3(String(fp)));
    for (const rf of rfs) items.push(mapP3(String(rf)));

    return items;
  })();

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Diagnostic Report</h2>
        <Badge variant={summary.statisticalVerdict === "PASS" ? "default" : "destructive"}>
          Verdict: {summary.statisticalVerdict}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSearch className="w-4 h-4" />
              Strategy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs truncate">{metadata.strategy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Timeframe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs">{metadata.timeframe}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Report ID
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs truncate">{metadata.reportId}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Phase 1: Structural Integrity
            <Badge variant={structuralIntegrity.verdict === "PASS" ? "outline" : "destructive"} className="ml-auto">
              {structuralIntegrity.verdict}
            </Badge>
          </CardTitle>
          <CardDescription>
            Validating backtest data continuity and detecting look-ahead bias.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {structuralIntegrity.dataContinuity.verdict === "PASS" ? 
                  <CheckCircle2 className="w-4 h-4 text-green-500" /> : 
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                }
                Data Continuity
              </span>
              <span className="text-muted-foreground">{structuralIntegrity.dataContinuity.details}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {structuralIntegrity.lookAheadBias.verdict === "PASS" ? 
                  <CheckCircle2 className="w-4 h-4 text-green-500" /> : 
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                }
                Look-ahead Bias
              </span>
              <span className="text-muted-foreground">{structuralIntegrity.lookAheadBias.details}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {structuralIntegrity.logicFeasibility.verdict === "PASS" ? 
                  <CheckCircle2 className="w-4 h-4 text-green-500" /> : 
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                }
                Logic Feasibility
              </span>
              <span className="text-muted-foreground">{structuralIntegrity.logicFeasibility.details}</span>
            </div>
          </div>

          <HelpItemsBlock items={phase1HelpItems} />
        </CardContent>
      </Card>

      {performance && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 2: Performance Metrics
              <Badge variant="outline" className="ml-auto">
                Expectancy: {pct(performance.expectancy.expectancy)}
              </Badge>
            </CardTitle>
            <CardDescription>
              Expectancy breakdown and trade distribution red flags.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Expectancy</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Win Rate</div>
                    <div className="font-semibold">{pct(performance.expectancy.winRate)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Loss Rate</div>
                    <div className="font-semibold">{pct(performance.expectancy.lossRate)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg Win</div>
                    <div className="font-semibold">{pct(performance.expectancy.avgWin)}</div>
                    <div className="text-muted-foreground">${num(performance.expectancy.totals?.avgWinAbs)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg Loss</div>
                    <div className="font-semibold">
                      {pct(performance.expectancy.avgLoss) === "-" ? "-" : `-${pct(performance.expectancy.avgLoss)}`}
                    </div>
                    <div className="text-muted-foreground">
                      {num(performance.expectancy.totals?.avgLossAbs) === "-" ? "-" : `-$${num(performance.expectancy.totals?.avgLossAbs)}`}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {String(performance.expectancy.diagnosis || "")}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Distribution</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Trades</div>
                    <div className="font-semibold">{num(performance.distribution.totalTrades, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Trades / Day</div>
                    <div className="font-semibold">{num(performance.distribution.tradesPerDay)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg Hold (hrs)</div>
                    <div className="font-semibold">{num(performance.distribution.avgTimeInMarketHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Capital / Trade</div>
                    <div className="font-semibold">{num(performance.distribution.capitalDeployedPct)}%</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Long</div>
                    <div className="font-semibold">{num(performance.distribution.longCount, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Short</div>
                    <div className="font-semibold">{num(performance.distribution.shortCount, 0)}</div>
                  </div>
                </div>
              </div>
            </div>

            {Array.isArray(performance.expectancy.redFlags) && performance.expectancy.redFlags.length > 0 && (
              <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Red Flags
                </h4>
                <ul className="text-xs list-disc list-inside space-y-1">
                  {performance.expectancy.redFlags.slice(0, 10).map((rf: string, i: number) => (
                    <li key={i}>{rf}</li>
                  ))}
                </ul>
              </div>
            )}

            <HelpItemsBlock items={phase2HelpItems} />
          </CardContent>
        </Card>
      )}

      {drawdownRisk && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 3: Drawdown & Risk
              <Badge variant="outline" className="ml-auto">
                Max DD: {pctNullable(drawdownRisk.drawdownStructure?.maxDrawdown)}
              </Badge>
            </CardTitle>
            <CardDescription>
              Drawdown structure and risk-per-trade signals.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Drawdown Structure</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Max Drawdown</div>
                    <div className="font-semibold">{pctNullable(drawdownRisk.drawdownStructure?.maxDrawdown)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Max DD (Abs)</div>
                    <div className="font-semibold">-${numNullable(drawdownRisk.drawdownStructure?.maxDrawdownAbs)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg DD (hrs)</div>
                    <div className="font-semibold">{numNullable(drawdownRisk.drawdownStructure?.avgDrawdownDurationHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Max DD (hrs)</div>
                    <div className="font-semibold">{numNullable(drawdownRisk.drawdownStructure?.maxDrawdownDurationHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Recovery (hrs)</div>
                    <div className="font-semibold">{numNullable(drawdownRisk.drawdownStructure?.timeToRecoveryHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Drawdowns</div>
                    <div className="font-semibold">{numNullable(drawdownRisk.drawdownStructure?.drawdownCount, 0)}</div>
                  </div>
                </div>
                {Array.isArray(drawdownRisk.drawdownStructure?.failurePatterns) && drawdownRisk.drawdownStructure.failurePatterns.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Failure Patterns
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {drawdownRisk.drawdownStructure.failurePatterns.slice(0, 10).map((fp: string, i: number) => (
                        <li key={i}>{fp}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Risk Per Trade</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Worst Loss (Abs)</div>
                    <div className="font-semibold">-${numNullable(drawdownRisk.riskPerTrade?.worstLossAbs)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Worst Risk</div>
                    <div className="font-semibold">{numNullable(drawdownRisk.riskPerTrade?.actualRiskPct)}%</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Configured Stoploss</div>
                    <div className="font-semibold">{pctNullable(drawdownRisk.riskPerTrade?.expectedStopLoss)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Stoploss Respected</div>
                    <div className="font-semibold">{pctNullable(drawdownRisk.riskPerTrade?.stopLossRespectedPct)}</div>
                  </div>
                </div>

                {Array.isArray(drawdownRisk.riskPerTrade?.redFlags) && drawdownRisk.riskPerTrade.redFlags.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Risk Red Flags
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {drawdownRisk.riskPerTrade.redFlags.slice(0, 10).map((rf: string, i: number) => (
                        <li key={i}>{rf}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <HelpItemsBlock items={phase3HelpItems} />
          </CardContent>
        </Card>
      )}

      {entryQuality && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 4: Entry Quality
              <Badge variant="outline" className="ml-auto">
                Quick losers: {pctNullable(entryQuality.timing?.quickLoserPct)}
              </Badge>
            </CardTitle>
            <CardDescription>
              Entry tagging breakdown and entry timing signals.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">By enter_tag</div>
                <div className="space-y-1">
                  {(Array.isArray(entryQuality.byTag) ? entryQuality.byTag : []).slice(0, 10).map((t: any, i: number) => (
                    <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/50 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold truncate">{String(t?.tag || "-")}</div>
                        <div className={cn(
                          "font-semibold",
                          Number(t?.totalPnLAbs) < 0 ? "text-destructive" : "text-green-500"
                        )}>
                          {num(t?.totalPnLAbs)}
                        </div>
                      </div>
                      <div className="text-muted-foreground">
                        Trades: {num(t?.trades, 0)} | WinRate: {pct(t?.winRate)} | Avg PnL: {num(t?.avgPnLAbs)}
                      </div>
                    </div>
                  ))}
                </div>

                {Array.isArray(entryQuality.redFlags) && entryQuality.redFlags.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Red Flags
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {entryQuality.redFlags.slice(0, 10).map((rf: string, idx: number) => (
                        <li key={idx}>{rf}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Timing</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Median winner (hrs)</div>
                    <div className="font-semibold">{numNullable(entryQuality.timing?.medianWinnerDurationHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Median loser (hrs)</div>
                    <div className="font-semibold">{numNullable(entryQuality.timing?.medianLoserDurationHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Quick losers</div>
                    <div className="font-semibold">{pctNullable(entryQuality.timing?.quickLoserPct)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Note</div>
                    <div className="font-semibold">{String(entryQuality.timing?.diagnosis || "-")}</div>
                  </div>
                </div>

                {Array.isArray(entryQuality.timing?.redFlags) && entryQuality.timing.redFlags.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Timing Red Flags
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {entryQuality.timing.redFlags.slice(0, 10).map((rf: string, idx: number) => (
                        <li key={idx}>{rf}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <HelpItemsBlock items={phase4HelpItems} />
          </CardContent>
        </Card>
      )}

      {exitLogic && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 5: Exit Logic
              <Badge variant="outline" className="ml-auto">
                Avg loser/winner: {numNullable(exitLogic.duration?.durationRatio)}
              </Badge>
            </CardTitle>
            <CardDescription>
              Exit reason attribution and winner vs loser holding time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Exit Reasons</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Stoploss</div>
                    <div className="font-semibold">{numNullable(exitLogic.exitReasons?.exitTypes?.stopLoss?.count, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">ROI</div>
                    <div className="font-semibold">{numNullable(exitLogic.exitReasons?.exitTypes?.roiTarget?.count, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Trailing</div>
                    <div className="font-semibold">{numNullable(exitLogic.exitReasons?.exitTypes?.trailingStop?.count, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Timeout</div>
                    <div className="font-semibold">{numNullable(exitLogic.exitReasons?.exitTypes?.timeout?.count, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Exit signal</div>
                    <div className="font-semibold">{numNullable(exitLogic.exitReasons?.exitTypes?.exitSignal?.count, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Other</div>
                    <div className="font-semibold">{numNullable(exitLogic.exitReasons?.exitTypes?.other?.count, 0)}</div>
                  </div>
                </div>

                {Array.isArray(exitLogic.exitReasons?.conclusions) && exitLogic.exitReasons.conclusions.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Conclusions
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {exitLogic.exitReasons.conclusions.slice(0, 10).map((c: string, i: number) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Hold Duration</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg winner (hrs)</div>
                    <div className="font-semibold">{numNullable(exitLogic.duration?.avgWinnerDurationHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg loser (hrs)</div>
                    <div className="font-semibold">{numNullable(exitLogic.duration?.avgLoserDurationHours)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Loser/Winner</div>
                    <div className="font-semibold">{numNullable(exitLogic.duration?.durationRatio)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Winner trades</div>
                    <div className="font-semibold">{num(performance?.expectancy?.totals?.winners, 0)}</div>
                  </div>
                </div>

                {Array.isArray(exitLogic.duration?.antiPatterns) && exitLogic.duration.antiPatterns.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Anti-patterns
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {exitLogic.duration.antiPatterns.slice(0, 10).map((c: string, i: number) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <HelpItemsBlock items={phase5HelpItems} />
          </CardContent>
        </Card>
      )}

      {regimeAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 6: Regime & Asset Analysis
              <Badge variant="outline" className="ml-auto">
                Source: {String(regimeAnalysis.regimeSegmentation?.source || "-")}
              </Badge>
            </CardTitle>
            <CardDescription>
              Regime dependence and pair concentration.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Regime Segmentation</div>
                <div className="text-xs text-muted-foreground">
                  Exchange: {String(regimeAnalysis.regimeSegmentation?.usedExchange || "-")} | Timeframe: {String(regimeAnalysis.regimeSegmentation?.usedTimeframe || "-")} | Benchmark: {String(regimeAnalysis.regimeSegmentation?.benchmarkPair || "-")}
                </div>
                <div className="space-y-1">
                  {(Array.isArray(regimeAnalysis.regimeSegmentation?.performanceByRegime)
                    ? regimeAnalysis.regimeSegmentation.performanceByRegime
                    : [])
                    .slice(0, 12)
                    .map((r: any, i: number) => (
                      <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/50 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold truncate">{String(r?.key || "-")}</div>
                          <div className={cn(
                            "font-semibold",
                            Number(r?.totalPnLAbs) < 0 ? "text-destructive" : "text-green-500"
                          )}>
                            {num(r?.totalPnLAbs)}
                          </div>
                        </div>
                        <div className="text-muted-foreground">
                          Trades: {num(r?.trades, 0)} | WinRate: {pct(r?.winRate)} | Avg: {num(r?.avgPnLAbs)}
                        </div>
                      </div>
                    ))}
                </div>

                {Array.isArray(regimeAnalysis.regimeSegmentation?.redFlags) && regimeAnalysis.regimeSegmentation.redFlags.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Regime Red Flags
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {regimeAnalysis.regimeSegmentation.redFlags.slice(0, 10).map((rf: string, idx: number) => (
                        <li key={idx}>{rf}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Asset / Pair Analysis</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Top pair share</div>
                    <div className="font-semibold">{pctNullable(regimeAnalysis.assetAnalysis?.concentration?.topPairPnlShareAbs)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Top 3 share</div>
                    <div className="font-semibold">{pctNullable(regimeAnalysis.assetAnalysis?.concentration?.top3PnlShareAbs)}</div>
                  </div>
                </div>

                <div className="space-y-1">
                  {(Array.isArray(regimeAnalysis.assetAnalysis?.topPairs)
                    ? regimeAnalysis.assetAnalysis.topPairs
                    : [])
                    .slice(0, 10)
                    .map((p: any, i: number) => (
                      <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/50 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold truncate">{String(p?.pair || "-")}</div>
                          <div className={cn(
                            "font-semibold",
                            Number(p?.totalPnLAbs) < 0 ? "text-destructive" : "text-green-500"
                          )}>
                            {num(p?.totalPnLAbs)}
                          </div>
                        </div>
                        <div className="text-muted-foreground">
                          Trades: {num(p?.trades, 0)} | WinRate: {pct(p?.winRate)} | Share: {pct(p?.pnlShareAbs)}
                        </div>
                      </div>
                    ))}
                </div>

                {Array.isArray(regimeAnalysis.assetAnalysis?.concentration?.redFlags) && regimeAnalysis.assetAnalysis.concentration.redFlags.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Concentration Red Flags
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {regimeAnalysis.assetAnalysis.concentration.redFlags.slice(0, 10).map((rf: string, idx: number) => (
                        <li key={idx}>{rf}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <HelpItemsBlock items={phase6HelpItems} />
          </CardContent>
        </Card>
      )}

      {costAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 7: Costs & Liquidity
              <Badge variant="outline" className="ml-auto">
                Edge viable: {String(Boolean(costAnalysis.costSensitivity?.edgeViable))}
              </Badge>
            </CardTitle>
            <CardDescription>
              Fee/slippage stress testing and basic liquidity realism checks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Cost Sensitivity</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Original profit</div>
                    <div
                      className={cn(
                        "font-semibold",
                        Number(costAnalysis.costSensitivity?.originalProfit) < 0 ? "text-destructive" : "text-green-500",
                      )}
                    >
                      {num(costAnalysis.costSensitivity?.originalProfit)}
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">+25% fees</div>
                    <div
                      className={cn(
                        "font-semibold",
                        Number(costAnalysis.costSensitivity?.with25pctMoreFees) < 0 ? "text-destructive" : "text-green-500",
                      )}
                    >
                      {num(costAnalysis.costSensitivity?.with25pctMoreFees)}
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">+50% slippage</div>
                    <div
                      className={cn(
                        "font-semibold",
                        Number(costAnalysis.costSensitivity?.with50pctMoreSlippage) < 0 ? "text-destructive" : "text-green-500",
                      )}
                    >
                      {num(costAnalysis.costSensitivity?.with50pctMoreSlippage)}
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Combined stress</div>
                    <div
                      className={cn(
                        "font-semibold",
                        Number(costAnalysis.costSensitivity?.combinedStress) < 0 ? "text-destructive" : "text-green-500",
                      )}
                    >
                      {num(costAnalysis.costSensitivity?.combinedStress)}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Verdict: {String(costAnalysis.costSensitivity?.verdict || "-")}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Liquidity</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg order size</div>
                    <div className="font-semibold">{numNullable(costAnalysis.liquidity?.avgOrderSize)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Avg market volume</div>
                    <div className="font-semibold">{numNullable(costAnalysis.liquidity?.avgMarketVolume)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Order / volume</div>
                    <div className="font-semibold">{pctNullable(costAnalysis.liquidity?.orderToVolumeRatio)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Risk</div>
                    <div className="font-semibold">{String(costAnalysis.liquidity?.liquidityRisk || "-")}</div>
                  </div>
                </div>
              </div>
            </div>

            {Array.isArray(costAnalysis.redFlags) && costAnalysis.redFlags.length > 0 && (
              <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Red Flags
                </h4>
                <ul className="text-xs list-disc list-inside space-y-1">
                  {costAnalysis.redFlags.slice(0, 10).map((rf: string, idx: number) => (
                    <li key={idx}>{rf}</li>
                  ))}
                </ul>
              </div>
            )}

            <HelpItemsBlock items={phase7HelpItems} />
          </CardContent>
        </Card>
      )}

      {logicIntegrity && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 8: Logic Integrity
              <Badge variant="outline" className="ml-auto">
                Risk: {String(logicIntegrity.overfitting?.overfittingRisk || "-")}
              </Badge>
            </CardTitle>
            <CardDescription>
              Strategy code integrity checks: conflicts, instability, and overfitting risk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Overfitting & Complexity</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Indicators</div>
                    <div className="font-semibold">{numNullable(logicIntegrity.overfitting?.indicatorCount, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Complexity</div>
                    <div className="font-semibold">{numNullable(logicIntegrity.overfitting?.complexityScore, 0)}/100</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Magic params</div>
                    <div className="font-semibold">{num(Array.isArray(logicIntegrity.overfitting?.magicParameters) ? logicIntegrity.overfitting.magicParameters.length : 0, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Correlated</div>
                    <div className="font-semibold">{num(Array.isArray(logicIntegrity.overfitting?.highlyCorrelatedIndicators) ? logicIntegrity.overfitting.highlyCorrelatedIndicators.length : 0, 0)}</div>
                  </div>
                </div>

                {Array.isArray(logicIntegrity.overfitting?.highlyCorrelatedIndicators) && logicIntegrity.overfitting.highlyCorrelatedIndicators.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Redundant indicators
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {logicIntegrity.overfitting.highlyCorrelatedIndicators.slice(0, 10).map((x: string, idx: number) => (
                        <li key={idx}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Signal Conflicts</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Instability</div>
                    <div className="font-semibold">{String(Boolean(logicIntegrity.signalConflicts?.briefSignalInstability))}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Logic errors</div>
                    <div className="font-semibold">{num(Array.isArray(logicIntegrity.signalConflicts?.logicErrors) ? logicIntegrity.signalConflicts.logicErrors.length : 0, 0)}</div>
                  </div>
                </div>

                {Array.isArray(logicIntegrity.signalConflicts?.conflictingIndicators) && logicIntegrity.signalConflicts.conflictingIndicators.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Conflicts
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {logicIntegrity.signalConflicts.conflictingIndicators.slice(0, 10).map((x: string, idx: number) => (
                        <li key={idx}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(logicIntegrity.signalConflicts?.impossibleCycles) && logicIntegrity.signalConflicts.impossibleCycles.length > 0 && (
                  <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Impossible / churn cycles
                    </h4>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {logicIntegrity.signalConflicts.impossibleCycles.slice(0, 10).map((x: string, idx: number) => (
                        <li key={idx}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {Array.isArray(logicIntegrity.redFlags) && logicIntegrity.redFlags.length > 0 && (
              <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Red Flags
                </h4>
                <ul className="text-xs list-disc list-inside space-y-1">
                  {logicIntegrity.redFlags.slice(0, 10).map((rf: string, idx: number) => (
                    <li key={idx}>{rf}</li>
                  ))}
                </ul>
              </div>
            )}

            <HelpItemsBlock items={phase8HelpItems} />
          </CardContent>
        </Card>
      )}

      {statistics && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 9: Statistical Robustness
              <Badge
                variant="outline"
                className={cn(
                  "ml-auto",
                  String(statistics.sampleAdequacy?.verdict) === "FAIL" ? "text-destructive" : "",
                )}
              >
                Verdict: {String(statistics.sampleAdequacy?.verdict || "-")}
              </Badge>
            </CardTitle>
            <CardDescription>
              Sample adequacy and confidence interval on expectancy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Sample Adequacy</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Trades (N)</div>
                    <div className="font-semibold">{numNullable(statistics.sampleAdequacy?.tradeCount, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Min required</div>
                    <div className="font-semibold">{numNullable(statistics.sampleAdequacy?.minRequiredTrades, 0)}</div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Expectancy</div>
                    <div
                      className={cn(
                        "font-semibold",
                        Number(statistics.sampleAdequacy?.expectancy) < 0 ? "text-destructive" : "text-green-500",
                      )}
                    >
                      {num(statistics.sampleAdequacy?.expectancy, 6)}
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                    <div className="text-muted-foreground">Std dev</div>
                    <div className="font-semibold">{numNullable(statistics.sampleAdequacy?.expectancyStdDev, 6)}</div>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-muted/20 border border-border/50 text-xs">
                  <div className="text-muted-foreground">CI 95%</div>
                  <div className="font-semibold">
                    {Array.isArray(statistics.sampleAdequacy?.confidenceInterval95)
                      ? `${num(statistics.sampleAdequacy.confidenceInterval95[0], 6)} .. ${num(statistics.sampleAdequacy.confidenceInterval95[1], 6)}`
                      : "-"}
                  </div>
                  <div className="text-muted-foreground mt-1">
                    {String(statistics.sampleAdequacy?.justification || "-")}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Red Flags</div>
                {Array.isArray(statistics.redFlags) && statistics.redFlags.length > 0 ? (
                  <div className="p-3 rounded-md bg-muted/20 border border-border/50">
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {statistics.redFlags.slice(0, 12).map((rf: string, idx: number) => (
                        <li key={idx}>{rf}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No statistical red flags.</div>
                )}
              </div>
            </div>

            <HelpItemsBlock items={phase9HelpItems} />
          </CardContent>
        </Card>
      )}

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Phase 10: Final Summary
              <Badge variant={summary.statisticalVerdict === "PASS" ? "outline" : "destructive"} className="ml-auto">
                {String(summary.statisticalVerdict || "-")}
              </Badge>
            </CardTitle>
            <CardDescription>
              Consolidated diagnosis and prioritized fixes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">Primary loss driver</div>
                <div className="text-xs text-muted-foreground">{String(summary.primaryLossDriver || "-")}</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">Secondary issue</div>
                <div className="text-xs text-muted-foreground">{String(summary.secondaryIssue || "-")}</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">Regime failure</div>
                <div className="text-xs text-muted-foreground">{String(summary.regimeFailure || "-")}</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">Asset / concentration risk</div>
                <div className="text-xs text-muted-foreground">{String(summary.assetRisk || "-")}</div>
              </div>
            </div>

            {Array.isArray(summary.suggestedFixes) && summary.suggestedFixes.length > 0 && (
              <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/50">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Suggested Fixes
                </h4>
                <ul className="text-xs list-disc list-inside space-y-1">
                  {summary.suggestedFixes.slice(0, 12).map((fix: string, i: number) => (
                    <li key={i}>{fix}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
