# Admin user management

This document describes the individual and bulk user deletion flow shipped with
the dashboard UX release. It is written for the next engineer who has to change
it without weakening the safeguards.

---

## 1. Where the code lives

| Concern | File |
|---|---|
| Shared deletion service | `src/lib/admin/user-deletion.ts` |
| Error codes | `src/lib/admin/user-delete-error.ts` |
| Individual API | `src/app/api/admin/users/[id]/route.ts` (`DELETE`) |
| Bulk API | `src/app/api/admin/users/bulk-delete/route.ts` (`POST`) |
| Directory UI | `src/components/admin/admin-users-table.tsx` |
| Detail-page danger zone | `src/components/admin/delete-user-button.tsx` |
| Storage retry queue | `src/lib/admin/storage-cleanup.ts` |
| Strict asset deletion | `src/lib/durable-upload.ts` (`deleteStoredAssetWithResult`) |
| Audit / queue models | `prisma/schema.prisma` (`AdminAuditEvent`, `StorageCleanupTask`) |
| Migration | `prisma/migrations/20261109120000_admin_user_deletion_audit/` |

Both routes call the same `deleteAdminUsers` service. There is no second
implementation of the safety rules.

---

## 2. Authorization and validation

- Every request re-reads the current user from the database via
  `getCurrentAdmin()`. A stale JWT cannot grant admin rights.
- The service re-checks the actor's role again inside the destructive path and
  accepts no caller-supplied role or permission flag.
- Rate limiting is shared per admin between individual and bulk requests.
  Bulk requests cannot bypass the individual bucket.
- The bulk body must contain exactly one key, `userIds`, and nothing else.
  Filters, roles, and "delete all" flags are rejected.
- IDs are trimmed, pattern-checked and de-duplicated. A malformed ID fails the
  whole request rather than deleting the subset that happened to parse.
- The server enforces `MAX_ADMIN_DELETE_BATCH = 50` independently of the UI.
  The directory renders 25 users per page, so normal UI requests stay well below
  the ceiling.

---

## 3. Protected accounts

Two protections are enforced inside the serializable transaction:

1. **Self-deletion** — an administrator cannot delete their own account. The UI
   also disables the checkbox and Delete button for the current admin, but that
   is presentation only.
2. **Last administrator** — deleting an admin is refused when no other admin
   would remain. The check and the delete execute in one `SERIALIZABLE`
   transaction. If two admins try to delete each other concurrently, Postgres
   forces a serialization conflict (`P2034`), the service retries a bounded
   number of times, and at least one administrator survives.

A protected target produces a `skipped` outcome, not a crash. In a bulk request
the other targets still proceed and the audit row is marked `PARTIAL`.

---

## 4. Transaction and relation handling

The user row is deleted inside a serializable transaction. User-owned tables
(jobs, resumes, interview prep, notifications, subscriptions, usage, etc.)
cascade from `User`.

Four optional administrator references intentionally do **not** cascade because
they describe actions taken on *other* users' records. They are detached before
the delete:

- `Subscription.updatedByAdminId`
- `SubscriptionEvent.actorAdminId`
- `UpgradeRequest.resolvedByAdminId`
- `JobTitle.createdById`

This lets an administrator leave the team without erasing the history of what
they did or violating a foreign key.

Any transactional email still queued for the deleted user's address is removed as
part of the same transaction (`EmailOutbox` has no user FK). The match is
case-insensitive on the exact address.

---

## 5. Storage cleanup

Database deletion and external file deletion cannot share a transaction. The
service therefore implements explicit, result-aware cleanup:

1. Before deletion, collect server-stored asset URLs from the target's profile
   and resume documents.
2. After the database delete commits, call `deleteStoredAssetWithResult` for each
   asset.
3. Ownership is checked first: only URLs under the deleted user's namespace are
   touched. A URL in someone else's namespace is **skipped**, never deleted and
   never queued.
4. Missing local files and already-absent blobs count as successful cleanup.
5. A genuine storage failure creates a `StorageCleanupTask` row with the URL,
   owner id, kind and error class.
6. The API response reports `fileCleanup: { status: 'COMPLETE' | 'PENDING' |
   'NONE', pending, skipped }`. The UI tells the administrator when files are
   queued instead of claiming everything is gone.

`processStorageCleanupBatch` retries pending tasks from the maintenance cron
(`GET /api/cron/maintenance`) and `npm run maintenance:run`. Retries use
exponential backoff, are bounded per invocation, and stop permanently after
eight attempts. A task whose URL fails the ownership check is marked `FAILED`
immediately; that is a security condition, not a transient outage.

---

## 6. Audit trail

`AdminAuditEvent` deliberately has **no foreign keys**. It must survive deletion
of both the acting administrator and the target account.

Each operation writes two rows in effect:

1. A `STARTED` row before any destructive work. If this insert fails, the
   deletion is refused — an unauditable operation must not start.
2. A final update with `COMPLETED`, `PARTIAL` or `FAILED`, per-target outcomes,
   counts, and the storage cleanup state.

Stored fields: actor id/email snapshot, action, mode, target user ids, counts,
outcome codes and messages, cleanup status/pending count, timestamps.

Never stored: passwords, reset/verification tokens, resume contents, interview
answers, email payloads or raw provider errors. Operational logs likewise carry
IDs, outcome codes and counts only.

If the final audit update fails, the service returns `AUDIT_FAILED` and the UI
tells the administrator to review the audit log before retrying. The database
work may already have committed; the caller must not assume it rolled back.

---

## 7. UI behaviour

### Directory (`/admin/users`)

- Per-row **Delete** beside **View**, and a page-scoped checkbox selection.
- Select-all covers only the current page and only eligible rows (the current
  admin is excluded).
- Selection clears whenever the row set changes (page, filter, refresh). It is
  never carried silently into a different page.
- The bulk action bar shows the count, a Clear action and **Delete selected**.
- Individual confirmation requires typing the target email exactly.
- Bulk confirmation requires typing `DELETE`.
- The dialog uses a native `<dialog>` with `showModal()`, `aria-labelledby` /
  `aria-describedby`, focus handling and a `motion-reduce` spinner fallback.
- Partial failures are reported per account, including codes such as `SELF`,
  `NOT_FOUND` and `DELETE_FAILED`.
- After a successful detail-page delete, the directory receives
  `?deleted=1&filesPending=N` and displays the cleanup outcome.

### Detail page (`/admin/users/[id]`)

The danger zone keeps the existing exact-email confirmation and now surfaces the
API's cleanup warning before navigating back to the directory.

---

## 8. Testing

`tests/admin-user-deletion.test.ts` runs against a real Postgres database (no
Prisma mocks) and covers:

- ID normalisation, malformed input, empty selection and batch ceiling
- cascade deletion of profile/resume documents
- case-insensitive removal of queued email
- self-deletion protection and non-admin rejection
- bulk partial success with `NOT_FOUND` and `SELF` outcomes
- detaching subscription, event, upgrade-request and job-title admin references
- pending storage cleanup when a blob cannot be deleted
- namespace ownership skips
- successful retry and permanent failure of a cleanup task

Run it with a disposable local/test database:

```bash
TEST_DATABASE_URL="postgresql://user@localhost:5432/job_seeker_os_test" npm test
```

Apply the new migration to the test database first:

```bash
DATABASE_URL="postgresql://user@localhost:5432/job_seeker_os_test" npx prisma migrate deploy
```

---

## 9. Operational notes

- The release requires migration `20261109120000_admin_user_deletion_audit`.
  Apply it with `prisma migrate deploy` before deploying the code.
- The maintenance cron now includes a storage-cleanup batch. A failed cron run
  is alerted through the existing observability path.
- There is intentionally no restore/undo endpoint. Recovery of a deleted account
  is a database-backup operation, not an application feature.
