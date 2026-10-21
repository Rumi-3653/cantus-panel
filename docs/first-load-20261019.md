# First-load catalog freshness

The UI accepts optional `catalogCache` response metadata: `stale`, `refreshing`, `failed`, and `updatedAt`. A stale snapshot is explicitly labeled inside the conversation list, including on mobile. Freshness metadata updates even when the catalog version is unchanged, without replacing the active composer or its draft.

The production read-only deployment uses a visibility-scoped in-memory stale-while-revalidate catalog and compressed transport. Its writer services remain unchanged. This portable edition does not bundle that deployment-specific reader, host inventory, credentials, or tunnels. Without cache metadata, existing direct-source behavior is unchanged.

Cold service startup still needs an initial source scan. A usable snapshot moves that wait off the first-page critical path; it does not make the underlying scan instantaneous. Forced refresh and authorization checks must remain authoritative.

The mobile regression now checks every live-machine row rather than assuming exactly one row.
