// Verification for lib/paged-fetch.ts. Run: pnpm verify:paged
//
// This module exists because of a real production failure: getAllOpportunities
// fanned every remaining page out with Promise.all, so ONE page rejecting threw
// away the ~139 pages that had already landed and the dashboard reported zero
// opportunities on a 14k-opportunity sub-account. The first assertion below is
// that exact regression.
//
// Wrapped in main() rather than using top-level await: this package is CJS.
import assert from "node:assert/strict";
import { fanOutPages } from "../lib/paged-fetch";

type Row = { id: string };

// Build a fake page fetcher over `total` synthetic rows.
//   failOn      — page numbers that reject
//   failOnceOn  — page numbers that reject the first time and succeed after
function makeFetcher(opts: {
  total: number;
  pageSize: number;
  failOn?: number[];
  failOnceOn?: number[];
}) {
  const failOn = new Set(opts.failOn ?? []);
  const failedOnce = new Set<number>();
  const calls: number[] = [];

  const fetchPage = async (page: number): Promise<Row[]> => {
    calls.push(page);
    if (failOn.has(page)) throw new Error(`page ${page} is broken`);
    if ((opts.failOnceOn ?? []).includes(page) && !failedOnce.has(page)) {
      failedOnce.add(page);
      throw new Error(`page ${page} failed once`);
    }
    const start = (page - 1) * opts.pageSize;
    return Array.from(
      { length: Math.max(0, Math.min(opts.pageSize, opts.total - start)) },
      (_, i) => ({ id: `r${start + i}` })
    );
  };

  return { fetchPage, calls };
}

const idOf = (r: Row) => r.id;
// No real waiting in verification — the retry pause is injected.
const noSleep = async () => {};

async function main() {
  const pageSize = 100;

  // --- happy path: every page lands
  {
    const { fetchPage } = makeFetcher({ total: 350, pageSize });
    const first = await fetchPage(1);
    const res = await fanOutPages<Row>({
      initial: first,
      pages: [2, 3, 4],
      fetchPage,
      pageSize,
      idOf,
      total: 350,
      sleep: noSleep,
    });
    assert.equal(res.records.length, 350, "all 350 rows collected");
    assert.deepEqual(res.missingPages, [], "nothing missing");
    assert.equal(res.missingEstimate, 0);
  }

  // --- THE REGRESSION: one permanently broken page must NOT discard the rest.
  // Under the old Promise.all this returned zero rows.
  {
    const { fetchPage } = makeFetcher({ total: 350, pageSize, failOn: [3] });
    const first = await fetchPage(1);
    const res = await fanOutPages<Row>({
      initial: first,
      pages: [2, 3, 4],
      fetchPage,
      pageSize,
      idOf,
      total: 350,
      sleep: noSleep,
    });
    assert.equal(res.records.length, 250, "keeps pages 1,2,4 — loses only page 3");
    assert.deepEqual(res.missingPages, [3], "page 3 reported missing");
    assert.equal(res.missingEstimate, 100, "one page of 100 estimated lost");
  }

  // --- a page that fails once recovers on the retry pass
  {
    const { fetchPage, calls } = makeFetcher({ total: 350, pageSize, failOnceOn: [3] });
    const first = await fetchPage(1);
    const retried: number[][] = [];
    const res = await fanOutPages<Row>({
      initial: first,
      pages: [2, 3, 4],
      fetchPage,
      pageSize,
      idOf,
      total: 350,
      sleep: noSleep,
      onRetry: (p) => retried.push(p),
    });
    assert.equal(res.records.length, 350, "retry recovered the full set");
    assert.deepEqual(res.missingPages, [], "nothing missing after retry");
    assert.deepEqual(retried, [[3]], "onRetry fired with only the failed page");
    // Page 3 fetched twice; pages 2 and 4 exactly once — the retry must not
    // re-fetch pages that already succeeded.
    assert.equal(calls.filter((p) => p === 3).length, 2, "page 3 fetched twice");
    assert.equal(calls.filter((p) => p === 2).length, 1, "page 2 not re-fetched");
    assert.equal(calls.filter((p) => p === 4).length, 1, "page 4 not re-fetched");
  }

  // --- overlapping pages are deduped by id
  {
    const dupes: Row[] = [{ id: "a" }, { id: "b" }];
    const res = await fanOutPages<Row>({
      initial: [{ id: "a" }],
      pages: [2],
      fetchPage: async () => dupes,
      pageSize: 2,
      idOf,
      sleep: noSleep,
    });
    assert.equal(res.records.length, 2, "duplicate id absorbed once");
    assert.deepEqual(res.records.map(idOf), ["a", "b"], "first-seen order preserved");
  }

  // --- missingEstimate never claims more than `total` allows
  {
    const { fetchPage } = makeFetcher({ total: 210, pageSize, failOn: [3] });
    const first = await fetchPage(1);
    const res = await fanOutPages<Row>({
      initial: first,
      pages: [2, 3],
      fetchPage,
      pageSize,
      idOf,
      total: 210,
      sleep: noSleep,
    });
    assert.equal(res.records.length, 200, "pages 1 and 2 landed");
    // A whole page of 100 failed, but total says only 10 rows can be missing.
    assert.equal(res.missingEstimate, 10, "estimate capped by total - loaded");
  }

  // --- empty page list is a no-op, not a crash
  {
    const res = await fanOutPages<Row>({
      initial: [{ id: "x" }],
      pages: [],
      fetchPage: async () => {
        throw new Error("must not be called");
      },
      pageSize,
      idOf,
      total: 1,
      sleep: noSleep,
    });
    assert.equal(res.records.length, 1);
    assert.deepEqual(res.missingPages, []);
  }

  // --- onProgress reports the running deduped count
  {
    const { fetchPage } = makeFetcher({ total: 300, pageSize });
    const first = await fetchPage(1);
    const seen: number[] = [];
    await fanOutPages<Row>({
      initial: first,
      pages: [2, 3],
      fetchPage,
      pageSize,
      idOf,
      total: 300,
      sleep: noSleep,
      onProgress: (n) => seen.push(n),
    });
    assert.equal(seen[0], 100, "first callback is the seeded page");
    assert.equal(seen[seen.length - 1], 300, "last callback is the full count");
  }

  console.log("verify-paged-fetch: all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
