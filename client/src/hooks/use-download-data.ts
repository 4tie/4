import { useMutation } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

interface DownloadDataInput {
  pairs: string[];
  timeframes: string[];
  date_from?: string;
  date_to?: string;
}

interface DownloadDataResponse {
  success: boolean;
  code?: number;
  command?: string;
  output?: string;
  exchange?: string;
  missing?: Array<{ pair: string; timeframe: string }>;
}

async function downloadData(input: DownloadDataInput): Promise<DownloadDataResponse> {
  const url = buildUrl(api.data.download.path);
  const res = await fetch(url, {
    method: api.data.download.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Download failed" }));
    throw new Error(err.message || `Download failed (${res.status})`);
  }

  return res.json();
}

export function useDownloadData() {
  return useMutation({
    mutationFn: downloadData,
  });
}
