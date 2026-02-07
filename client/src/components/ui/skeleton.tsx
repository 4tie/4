import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-white/5", className)}
      {...props}
    />
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-white/10 bg-black/20 p-4", className)}>
      <div className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton key={col} className="h-10 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStatsGrid({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-${Math.min(count, 4)} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 200 }: { height?: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <Skeleton className="h-4 w-1/4 mb-4" />
      <Skeleton className="w-full" style={{ height: `${height}px` }} />
    </div>
  );
}

export function SkeletonTradeRow() {
  return (
    <div className="flex items-center gap-4 p-3 rounded-lg border border-white/5 bg-black/10">
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-8 w-16" />
    </div>
  );
}

export function SkeletonButton({ className }: { className?: string }) {
  return (
    <Skeleton className={cn("h-9 w-24 rounded-md", className)} />
  );
}

export function SkeletonInput({ className }: { className?: string }) {
  return (
    <Skeleton className={cn("h-9 w-full rounded-md", className)} />
  );
}

export function SkeletonTabs() {
  return (
    <div className="flex gap-1 p-1 rounded-lg bg-black/20">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-8 flex-1 rounded-md" />
      ))}
    </div>
  );
}

export function SkeletonBadge() {
  return (
    <Skeleton className="h-5 w-16 rounded-full" />
  );
}

export function SkeletonProgress() {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
    </div>
  );
}

export function SkeletonCodeBlock({ lines = 5 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-xs">
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonDiffView() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <Skeleton className="h-4 w-1/3 mb-3" />
        <SkeletonCodeBlock lines={8} />
      </div>
      <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
        <Skeleton className="h-4 w-1/3 mb-3" />
        <SkeletonCodeBlock lines={8} />
      </div>
    </div>
  );
}

export function SkeletonDialog() {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-6 space-y-4">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <SkeletonButton />
        <SkeletonButton />
      </div>
    </div>
  );
}

export { Skeleton }
