// lib/paged-fetch.ts
// Resilient page fan-out for GHL's numbered-page endpoints.
//
// Extracted from ghl-client.ts because the inline `Promise.all` over every
// remaining page was all-or-nothing: one page rejecting after its retries threw
// away every page that HAD landed. On a 14k-opportunity sub-account that turned
// a single failed request into a dashboard reporting zero opportunities — a
// silently wrong answer, not a crash, which is exactly the bug class this repo
// covers with scripts/verify-*.ts.
//
// Framework-free and network-free: `fetchPage` is injected, so
// scripts/verify-paged-fetch.ts exercises every failure path without a socket.

/** Outcome of a paginated walk, carrying whether it came back complete. */
export interface PagedResult<T> {
  records: T[];
  /** Total the API reported, when it reported one. */
  total?: number;
  /** 1-indexed page numbers still missing after the retry pass. Empty = complete. */
  missingPages: number[];
  /** Estimated records lost. Capped by `total` when known. */
  missingEstimate: number;
}

export interface FanOutOptions<T> {
  /** Page 1's records, already fetched by the caller. Seeds the dedupe set. */
  initial: T[];
  /** 1-indexed page numbers still to fetch. May be empty. */
  pages: number[];
  fetchPage: (page: number) => Promise<T[]>;
  pageSize: number;
  /** Stable identity, so overlapping pages don't inflate the count. */
  idOf: (record: T) => string;
  total?: number;
  /** Running deduped count, fired after every absorbed batch. */
  onProgress?: (count: number) => void;
  /** Fired once, with the pages about to be retried, if any failed. */
  onRetry?: (pages: number[]) => void;
  /** Injected in verification to skip the real pause. */
  sleep?: (ms: number) => Promise<void>;
  /** Pause before the retry pass. Defaults to RETRY_PAUSE_MS. */
  retryPauseMs?: number;
}

// One GHL rate-limit window. Retrying instantly would just burn the attempt
// against a window that is still closed, so we wait it out first.
const RETRY_PAUSE_MS = 10_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fanOutPages<T>({
  initial,
  pages,
  fetchPage,
  pageSize,
  idOf,
  total,
  onProgress,
  onRetry,
  sleep = defaultSleep,
  retryPauseMs = RETRY_PAUSE_MS,
}: FanOutOptions<T>): Promise<PagedResult<T>> {
  const seen = new Set<string>();
  const records: T[] = [];

  const absorb = (batch: T[]) => {
    for (const r of batch) {
      const id = idOf(r);
      if (seen.has(id)) continue;
      seen.add(id);
      records.push(r);
    }
    onProgress?.(records.length);
  };

  absorb(initial);

  // Fetch a set of pages, keeping whatever lands. Returns the ones that didn't.
  const attempt = async (nums: number[]): Promise<number[]> => {
    if (nums.length === 0) return [];
    const settled = await Promise.allSettled(nums.map((p) => fetchPage(p)));
    const failed: number[] = [];
    settled.forEach((res, i) => {
      if (res.status === "fulfilled") {
        absorb(res.value);
      } else {
        failed.push(nums[i]);
        const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
        console.warn(`[GHL] page ${nums[i]} failed: ${reason}`);
      }
    });
    return failed;
  };

  let missingPages = await attempt(pages);

  // One retry pass over ONLY the pages that failed — 1 request of 140, not 140.
  if (missingPages.length > 0) {
    onRetry?.(missingPages);
    await sleep(retryPauseMs);
    missingPages = await attempt(missingPages);
  }

  const rawEstimate = missingPages.length * pageSize;
  const missingEstimate =
    total !== undefined
      ? Math.min(rawEstimate, Math.max(0, total - records.length))
      : rawEstimate;

  return { records, total, missingPages, missingEstimate };
}
