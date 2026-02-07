import { useEffect, useState } from "react";
import { Search, FileCode, Check, ChevronDown, Download, Loader2, AlertCircle, Pin, PinOff, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Timeframes, type Timeframe } from "@shared/schema";

interface StrategySidebarProps {
  filesLoading: boolean;
  strategies: any[];
  activeFileId: number | null;
  search: string;
  setSearch: (v: string) => void;
  onSelectFile: (id: number) => void;
  // Quick backtest props
  quickTimeframe: Timeframe;
  setQuickTimeframe: (v: Timeframe) => void;
  quickTimerangePreset: string;
  setQuickTimerangePreset: (v: string) => void;
  quickTimerange: string;
  setQuickTimerange: (v: string) => void;
  quickSelectedPairs: string[];
  setQuickSelectedPairs: (v: string[]) => void;
  pairsOpen: boolean;
  setPairsOpen: (v: boolean) => void;
  pairsQuery: string;
  setPairsQuery: (v: string) => void;
  quickStake: number;
  setQuickStake: (v: number) => void;
  quickMaxOpenTrades: number;
  setQuickMaxOpenTrades: (v: number) => void;
  maxTradesMode: "preset" | "custom";
  setMaxTradesMode: (v: "preset" | "custom") => void;
  maxTradesUserSet: boolean;
  setMaxTradesUserSet: (v: boolean) => void;
  availablePairs: string[];
  filteredPairs: string[];
  downloadStatus: { status: 'idle' | 'downloading' | 'success' | 'error'; message?: string };
  downloadLog?: string[];
  onClearDownloadLog?: () => void;
  lastBacktestId: number | null;
  isDownloading: boolean;
  toggleQuickPair: (pair: string) => void;
  selectAllQuickPairs: () => void;
  clearQuickPairs: () => void;
  handleTimerangePresetChange: (preset: string) => void;
  handleDownloadData: () => void;
  setQuickConfigTouched: (v: boolean) => void;
}

export function StrategySidebar({
  filesLoading,
  strategies,
  activeFileId,
  search,
  setSearch,
  onSelectFile,
  quickTimeframe,
  setQuickTimeframe,
  quickTimerangePreset,
  setQuickTimerangePreset,
  quickTimerange,
  setQuickTimerange,
  quickSelectedPairs,
  setQuickSelectedPairs,
  pairsOpen,
  setPairsOpen,
  pairsQuery,
  setPairsQuery,
  quickStake,
  setQuickStake,
  quickMaxOpenTrades,
  setQuickMaxOpenTrades,
  maxTradesMode,
  setMaxTradesMode,
  maxTradesUserSet,
  setMaxTradesUserSet,
  availablePairs,
  filteredPairs,
  downloadStatus,
  downloadLog,
  onClearDownloadLog,
  lastBacktestId,
  isDownloading,
  toggleQuickPair,
  selectAllQuickPairs,
  clearQuickPairs,
  handleTimerangePresetChange,
  handleDownloadData,
  setQuickConfigTouched,
}: StrategySidebarProps) {
  const [downloadLogDocked, setDownloadLogDocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem("workspace:downloadLogDocked") === "1";
    } catch {
      return false;
    }
  });

  const [downloadLogOpen, setDownloadLogOpen] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem("workspace:downloadLogDocked", downloadLogDocked ? "1" : "0");
    } catch {
      // ignore
    }
  }, [downloadLogDocked]);

  return (
    <div className="h-full flex flex-col relative">
      <div className="p-3 border-b border-white/10">
        <div className="text-[10px] font-bold uppercase tracking-widest text-purple-200">Strategies</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 pl-8 text-xs bg-black/30 border-white/10 text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <Badge variant="outline" className="h-8 px-2 text-[10px] border-white/10 bg-black/30 text-slate-300">
            {strategies.length}
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filesLoading ? (
            <div className="p-3 text-xs text-slate-400">Loading...</div>
          ) : strategies.length === 0 ? (
            <div className="p-3 text-xs text-slate-400">No strategies found.</div>
          ) : (
            strategies.map((f: any) => {
              const isActive = activeFileId != null && Number(f.id) === activeFileId;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onSelectFile(Number(f.id))}
                  className={cn(
                    "w-full text-left px-2 py-2 rounded-md border transition-colors",
                    isActive
                      ? "border-purple-500/40 bg-purple-500/10"
                      : "border-white/5 hover:border-white/10 hover:bg-white/5",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className={cn("w-4 h-4 shrink-0", isActive ? "text-purple-200" : "text-slate-400")} />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-xs font-medium truncate", isActive ? "text-white" : "text-slate-200")}>
                        {String(f.path).split("/").pop()}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{String(f.path)}</div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-white/10 bg-black/20">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-red-400">Quick Backtest</div>
          {lastBacktestId != null ? (
            <Badge variant="outline" className="text-[10px] border-white/10 bg-black/30 text-slate-300">
              #{lastBacktestId}
            </Badge>
          ) : null}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-slate-400 mb-1">Timeframe</div>
            <select
              value={quickTimeframe}
              onChange={(e) => {
                setQuickConfigTouched(true);
                setQuickTimeframe(e.target.value as Timeframe);
              }}
              className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
            >
              {Timeframes.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-[10px] text-slate-400 mb-1">Stake</div>
            <Input
              value={String(quickStake)}
              onChange={(e) => {
                setQuickConfigTouched(true);
                setQuickStake(Number(e.target.value));
              }}
              className="h-8 text-xs bg-black/30 border-white/10 text-slate-200"
              inputMode="decimal"
            />
          </div>

          <div className="col-span-2">
            <div className="text-[10px] text-slate-400 mb-1">Pairs</div>
            <Popover open={pairsOpen} onOpenChange={setPairsOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-8 justify-between bg-black/30 border-white/10 text-slate-200 hover:bg-white/5"
                  onClick={() => setQuickConfigTouched(true)}
                >
                  <span className="text-xs truncate">
                    {quickSelectedPairs.length > 0 ? `${quickSelectedPairs.length} selected` : "Select pairs"}
                  </span>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[340px] p-2">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <Input
                    value={pairsQuery}
                    onChange={(e) => setPairsQuery(e.target.value)}
                    placeholder="Search pairs..."
                    className="h-8 text-xs"
                  />
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => {
                      setQuickConfigTouched(true);
                      selectAllQuickPairs();
                    }}
                  >
                    Select All
                  </Button>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={availablePairs.length}
                      defaultValue={10}
                      id="random-pair-count"
                      className="h-7 w-12 px-1 text-center text-[10px] bg-black/30 border-white/10"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10px] text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                      onClick={() => {
                        setQuickConfigTouched(true);
                        const input = document.getElementById("random-pair-count") as HTMLInputElement;
                        const count = Math.min(parseInt(input?.value || "10", 10), availablePairs.length);
                        const shuffled = [...availablePairs].sort(() => 0.5 - Math.random());
                        const randomPairs = shuffled.slice(0, count);
                        setQuickSelectedPairs(randomPairs);
                      }}
                      title="Select random pairs"
                    >
                      Random
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => {
                      setQuickConfigTouched(true);
                      clearQuickPairs();
                    }}
                  >
                    Clear
                  </Button>
                </div>

                <div className="mt-2 max-h-[240px] overflow-auto rounded-md border border-border/50">
                  {filteredPairs.map((pair) => {
                    const checked = quickSelectedPairs.includes(pair);
                    return (
                      <div
                        key={pair}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-2 text-left text-xs hover:bg-accent",
                          checked && "bg-accent/40",
                        )}
                        onClick={() => {
                          setQuickConfigTouched(true);
                          toggleQuickPair(pair);
                        }}
                      >
                        <Checkbox checked={checked} onCheckedChange={() => {}} />
                        <span className="flex-1 truncate">{pair}</span>
                        {checked ? <Check className="w-3.5 h-3.5 text-primary" /> : null}
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <div className="text-[10px] text-slate-400 mb-1">Range</div>
            <select
              value={quickTimerangePreset}
              onChange={(e) => {
                setQuickConfigTouched(true);
                handleTimerangePresetChange(e.target.value);
              }}
              className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
            >
              <option value="30d">30d</option>
              <option value="60d">60d</option>
              <option value="90d">90d</option>
              <option value="180d">180d</option>
              <option value="365d">1y</option>
              <option value="ytd">YTD</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <div className="text-[10px] text-slate-400 mb-1">Max Open Trades</div>
            <select
              value={maxTradesMode === "custom" ? "custom" : String(quickMaxOpenTrades)}
              onChange={(e) => {
                setQuickConfigTouched(true);
                setMaxTradesUserSet(true);
                const v = e.target.value;
                if (v === "custom") {
                  setMaxTradesMode("custom");
                  return;
                }
                const n = Number(v);
                if (Number.isFinite(n)) {
                  setMaxTradesMode("preset");
                  setQuickMaxOpenTrades(n);
                }
              }}
              className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
            >
              {[1, 2, 3, 5, 10, 15, 20, 30].map((n) => (
                <option key={n} value={String(n)}>{n}</option>
              ))}
              <option value="custom">Custom</option>
            </select>

            {maxTradesMode === "custom" ? (
              <Input
                value={String(quickMaxOpenTrades)}
                onChange={(e) => {
                  setQuickConfigTouched(true);
                  setMaxTradesUserSet(true);
                  setQuickMaxOpenTrades(Number(e.target.value));
                }}
                className="mt-2 h-8 text-xs bg-black/30 border-white/10 text-slate-200"
                inputMode="numeric"
              />
            ) : null}
          </div>

          <div className="col-span-2 grid grid-cols-2 gap-2">
            <Input
              value={quickTimerange}
              onChange={(e) => {
                setQuickConfigTouched(true);
                setQuickTimerangePreset("custom");
                setQuickTimerange(e.target.value);
              }}
              placeholder="YYYYMMDD-YYYYMMDD"
              className="h-8 text-xs bg-black/30 border-white/10 text-slate-200 placeholder:text-slate-500"
            />

            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full px-2 text-xs gap-1"
              onClick={handleDownloadData}
              disabled={isDownloading || !quickSelectedPairs.length}
            >
              {isDownloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Download
            </Button>
          </div>

          {downloadStatus.status !== 'idle' && (
            <div className={cn(
              "col-span-2 flex items-center gap-2 text-[10px] px-2 py-1 rounded border",
              downloadStatus.status === 'downloading' && "border-purple-500/30 bg-purple-500/10 text-purple-200",
              downloadStatus.status === 'success' && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
              downloadStatus.status === 'error' && "border-red-500/30 bg-red-500/10 text-red-400"
            )}>
              {downloadStatus.status === 'downloading' && <Loader2 className="h-3 w-3 animate-spin" />}
              {downloadStatus.status === 'success' && <Check className="h-3 w-3" />}
              {downloadStatus.status === 'error' && <AlertCircle className="h-3 w-3" />}
              <span className="truncate">{downloadStatus.message}</span>
            </div>
          )}

          {Array.isArray(downloadLog) && downloadLog.length > 0 && !downloadLogDocked && (
            <div className="col-span-2 rounded-md border border-white/10 bg-black/30 p-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-[10px] text-slate-400">Download log</div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setDownloadLogDocked(true)}
                    title="Dock"
                  >
                    <Pin className="h-3 w-3" />
                  </Button>
                  {onClearDownloadLog && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={onClearDownloadLog}
                      title="Clear"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="max-h-[96px] overflow-auto text-[10px] leading-relaxed text-slate-200 font-mono whitespace-pre-wrap">
                {downloadLog.slice(-20).join("\n")}
              </div>
            </div>
          )}
        </div>
      </div>

      {Array.isArray(downloadLog) && downloadLog.length > 0 && downloadLogDocked && (
        <div className="absolute left-3 right-3 bottom-3 z-30 rounded-md border border-white/10 bg-black/70 backdrop-blur p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] text-slate-300">Download log</div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setDownloadLogOpen((v) => !v)}
                title={downloadLogOpen ? "Collapse" : "Expand"}
              >
                <X className={cn("h-3 w-3", downloadLogOpen ? "rotate-45" : "rotate-0")} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setDownloadLogDocked(false)}
                title="Undock"
              >
                <PinOff className="h-3 w-3" />
              </Button>
              {onClearDownloadLog && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={onClearDownloadLog}
                  title="Clear"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {downloadLogOpen && (
            <div className="mt-1 max-h-[140px] overflow-auto text-[10px] leading-relaxed text-slate-100 font-mono whitespace-pre-wrap">
              {downloadLog.slice(-40).join("\n")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
