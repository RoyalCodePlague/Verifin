# Phase 7 — Platform Experience and Reliability

## Status

The existing responsive and offline workflows were reviewed, and the remaining reliability and security gaps found during Phase 6 were addressed.

## Completed

- Kept the new report and automation controls responsive with wrapping controls and mobile-sized form grids.
- Confirmed the offline flow retains actions until the server confirms their IDs. The queue uses unique operation IDs; the sync endpoint processes a user's batch transactionally and records `(user, action_id)` uniquely to prevent duplicate sale or stock processing. Failed actions remain available for conflict review.
- Added upload limits for avatars and expense receipts, and content checks for GRN PDF/JPEG/PNG attachments in addition to extension and size checks.
- Scoped API-key logs and saved reports to their owning business. Custom-report execution applies branch restrictions for staff. Automation setup/history is owner-only, and valid API-key requests with insufficient scopes still count against the key's limit and appear in logs.
- Kept automation, report export, and API-key management behind subscription entitlements.

## Verification and deployment notes

- Backend regression suite: **225 tests passed** on an in-memory SQLite test database. This included approval requests and exact-payload retries, high-value API-key restrictions, offline idempotency, cross-business access, upload validation, rate limiting, report exports, and automation retries.
- Frontend: **33 tests passed**, TypeScript check passed, and production build/prerender completed.
- Configure the `run_automations` and `deliver_webhooks` commands in the deployment scheduler. Apply the new migrations before running the updated application.
- The backend suite ran with `config.test_settings`; no production data was read or modified. New layouts were build-checked and use responsive styling, but a separate physical-device visual QA pass was not performed.
