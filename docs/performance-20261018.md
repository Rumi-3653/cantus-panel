# Incremental catalogs and responsive reading

- Catalog replies carry a content version. Matching versions return a tiny acknowledgment; recent versions receive changed/removed rows and ordering only when needed. Unknown versions fall back to full catalogs. Cache retains two snapshots per visibility scope.
- Browser caches are workspace/generation scoped and used only after a successful authenticated response. Unchanged catalogs no longer trigger large JSON comparisons or list rebuilding.
- List groups and rows retain their existing nodes; collapsed branches are not constructed until expanded. Search, folders, selection, and expansion state remain supported.
- Composer construction and capability checking run concurrently with history reading. Drafting is available immediately, but sending stays disabled until history and capability checks succeed.
- `content-visibility:auto` defers offscreen message layout/paint without removing full searchable/copyable text. Browsers without support retain ordinary rendering.
- Initial full scans remain necessary; these changes do not promise instant first load.

Validation: `npm test`, `node --test catalog-delta.test.cjs`, and optional browser tests in `cloud/performance-ui.test.cjs`, `cloud/mobile-ui.test.cjs`, `cloud/repair-regression.test.cjs`, `cloud/send-reconcile.test.cjs`, `cloud/message-queue-ui.test.cjs`, `cloud/catalog-refresh-ui.test.cjs`. Browser tests use `PLAYWRIGHT_MODULE` and optional `CHROME_PATH`.
