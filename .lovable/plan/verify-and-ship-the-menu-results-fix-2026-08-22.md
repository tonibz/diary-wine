# Verify and ship the menu-results fix

## Confirmed diagnosis

- The latest saved scan contains 6 parsed menu items, and matching completed for all 6.
- Opening that scan in the current preview renders all wines and prices immediately with no spinner.
- The published site serves a different, older application bundle than the current preview. The remaining report is therefore consistent with testing an older published deployment, not with the current preview code failing.
- The active code uses only the batched `find_wine_matches` RPC; no stale singular `find_wine_match` call remains in the source.

## Plan

1. Publish the current known-working preview without making another speculative code change.
2. Run one end-to-end scan on the published app and confirm:
   - navigation reaches the results route;
   - stored wines and prices appear immediately;
   - matching is only an inline enrichment state;
   - a failed or expired session ends within 15 seconds with Retry rather than blocking the list.
3. Capture the published request and console evidence during that test. Only if the published build still fails, fix the exact observed request or rendering path rather than changing unrelated scanner code.
4. Remove the remaining per-item database update loop in matching by writing match results in one batch, preserving the single batched lookup and avoiding avoidable post-match latency.

## Technical note

The database function grants are already correct for signed-in users. The latest database rows also prove the batched matcher executed successfully, so no permission migration is planned.
