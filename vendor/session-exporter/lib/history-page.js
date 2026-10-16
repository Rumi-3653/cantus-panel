'use strict';
// Opt-in paged reading. Existing export callers retain their original limits.
const MAX_SCAN_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const fail = code => Object.assign(Error(code), { code, status: 409 });
function historyPage(options) {
  if (!options.page) return null;
  const before = options.before ?? null;
  if (before !== null && (!Number.isSafeInteger(before) || before < 1 || !/^[a-f0-9]{64}$/.test(options.pageSignature || ''))) throw fail('input');
  let count = 0, bytes = 0, start = 0;
  const rows = [], deadline = Date.now() + 60000;
  return {
    rows,
    check(seen) { if (Date.now() > deadline || seen.size > 1000000) throw fail('limit'); },
    add(row) {
      const index = count++;
      if (before !== null && index >= before) return;
      const size = Buffer.byteLength(row.text);
      if (size > MAX_PAGE_BYTES) throw fail('limit');
      rows.push(row); bytes += size;
      while (rows.length > 120 || bytes > MAX_PAGE_BYTES) { bytes -= Buffer.byteLength(rows.shift().text); start++; }
    },
    finish(signature) {
      if (options.pageSignature && options.pageSignature !== signature) throw fail('stale');
      return { totalRows: count, pageStart: start, hasMore: start > 0, nextBefore: start > 0 ? start : null, pageSignature: signature };
    }
  };
}
module.exports = { historyPage, MAX_SCAN_BYTES };
