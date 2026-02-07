import { toast } from "@/hooks/use-toast";

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

type ReportOptions = {
  description?: string;
  showToast?: boolean;
};

const onceKeys = new Set<string>();

export function reportError(title: string, err: unknown, options?: ReportOptions): void {
  const msg = toMessage(err);
  const desc = typeof options?.description === "string" && options.description.trim() ? options.description : msg;
  console.error(title, err);
  const showToast = options?.showToast !== false;
  if (showToast) {
    toast({
      variant: "destructive",
      title,
      description: desc,
    });
  }
}

export function reportErrorOnce(key: string, title: string, err: unknown, options?: ReportOptions): void {
  const k = String(key || "").trim();
  if (k && onceKeys.has(k)) {
    console.error(title, err);
    return;
  }
  if (k) onceKeys.add(k);
  reportError(title, err, options);
}
