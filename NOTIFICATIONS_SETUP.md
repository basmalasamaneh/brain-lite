# Reminders and notifications setup

## Secrets (never commit key values)

Generate your own VAPID keypair on your computer:

```sh
npx web-push generate-vapid-keys
```

Add the output in Replit Secrets as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
Set `VAPID_SUBJECT` to your real contact, for example a `mailto:` address you own.
The public key is intentionally exposed to the authenticated browser; the private key never is.
Set `CRON_SECRET` to a long randomly generated secret for your scheduler.
Existing `DATABASE_URL` and `SESSION_SECRET` are still required.

Optional email fallback is off by default. To enable it, configure `RESEND_API_KEY`,
`RESEND_FROM` (a sender on a domain you have verified in Resend), and `APP_URL`
(the actual HTTPS production app URL). Users must explicitly opt in through
`email_enabled`. With a missing Resend API key, email is silently skipped; push
and the notification center still work. Unsubscribe links are HMAC authenticated,
only disable the linked account's email, and never redirect.

## Deployment and scheduler

Use a **Reserved VM** for this full-stack PWA and minute-by-minute background
scheduler. Replit's official deployment documentation describes Reserved VM as
a dedicated machine that never sleeps; Autoscale can scale to zero:
https://docs.replit.com/cloud-services/deployments/reserved-vm-deployments

The API startup applies additive migration 006 transactionally, using the existing
migration advisory lock; the production bundle includes its SQL. It then starts
an in-process worker every 60 seconds. Do not replace the existing application's
build/run commands with a standalone scheduled task.

An external cron can additionally POST every minute to your **actual published
production URL**, not the workspace preview. Copy that URL from Publishing:

```sh
APP_URL='https://YOUR-ACTUAL-PUBLISHED-APP-HOST'
curl --fail --request POST "$APP_URL/api/cron/tick" \
  --header "Authorization: Bearer $CRON_SECRET"
```

`YOUR-ACTUAL-PUBLISHED-APP-HOST` above is a value you must replace, not a provisioned
domain. Put the header in your scheduler's secret configuration, not its public
URL, logs, or query string. Overlapping cron requests and multiple server workers
are safe: per-user PostgreSQL advisory locks, row locks with SKIP LOCKED, unique
delivery claims, and a transactional daily ledger prevent duplicate claims.

A Scheduled Deployment is appropriate for a **separate periodic cron caller**,
not the always-serving PWA/API. No sleeping Autoscale deployment can guarantee
that an in-process timer runs while it is scaled to zero.

## Delivery guarantee and privacy

Exactly-once external delivery cannot be guaranteed by Web Push or email.
This implementation deliberately chooses **at-most-once external attempts**:
commit the durable reminder/notification claim before contacting providers and
never retry an uncertain result. A crash after that commit or a temporary provider
failure can lose a delivery. Provider acceptance means “sent”, not “seen on phone”.
In-app notices remain available. HTTP 404/410 push endpoints are deleted.

Sent reminder identities are retained through date recomputation and logout in a
separate permanent `(memory_id, kind, fire_at)` claim ledger. They disappear only
with the source memory/account, or all-data deletion that removes those memories.
Snooze chooses a new UTC fire time. Restart never reinitializes existing pending
or snoozed plans. Per-user timezone calculations use IANA rules, calendar-day
leads, DST gap-forward resolution, and earliest-occurrence overlap resolution;
the custom-time UI rejects ambiguous/nonexistent times.

The minimal dedup ledger also stores pre-fire Done/Dismiss tombstones (only owner,
memory ID, kind, fire time, reason and claim time, never title/body or push keys).
Logout removes visible reminder/notification records as requested; login queues
future plans again without resurrecting those tombstoned identities. Recompute
reconciles unchanged pending pairs, preserving quiet-hour waiting and explicit
snoozes. A `none` override or memory deletion cancels snoozes.
Subscriptions must match an unexpired session with the same account before every
push attempt. Expired/regenerated/account-swapped binds are pruned. Login/signup
remove old-session subscriptions before regeneration under the delivery fence.

Five ordinary notices and one reserved overflow-summary slot are allowed per
local calendar day, shared by reminders, tests, daily briefs and suggestions.
Only one summary is ever claimed that day. Further overflow stays in the ledger,
not another push. Dots and Spaces share one suggestion slot/day and persistent
source fingerprints. Briefs use deterministic owned memory counts and no AI.

Hidden lock-screen text is the default. The title becomes the app name and the
body a localized generic reminder; neither memory title/body nor category details
are exposed. Minimal operational metadata remains: opaque reminder/notification
IDs, a safe same-app related-memory deep link, and localized Done/Snooze actions.
IDs are not authorization credentials. Both hidden and detailed payload actions
require the current authenticated session; an expired session cannot mutate a
reminder. Payloads never include auth tokens, session IDs or subscription keys.

Deletion/logout and delivery share a database owner fence held through external
attempts. A delivery already in flight cannot be recalled; deletion waits for its
linearization point. Once deletion/cleanup completes, no later delivery can start.
Logout clears **all owned reminders and notifications**, but removes only devices
bound to the current session. Other devices' subscriptions stay. Delete all data
removes every subscription, reminder and notification; account deletion cascades.

## Validation

Pure timezone/DST tests and opt-in PostgreSQL fixture tests are in
`artifacts/api-server/src/lib/reminder-time.test.ts` and `notifications-db.test.ts`.
They use only disposable accounts; existing user memories are not deleted.

After the owning agent builds/restarts the API, run the live real-minute timer
test (takes roughly 2–3 minutes):

```sh
NOTIFICATIONS_API_TEST=1 node --test artifacts/api-server/src/lib/notifications-api.test.mjs
```

Override `NOTIFICATIONS_API_BASE_URL` if the API is not on the existing `PORT`.
The test creates disposable English/Arabic accounts, sets a real two-minute
reminder, checks snooze/done/deletion/isolation/logout, and deletes its accounts.
No test claims a real push was delivered without VAPID keys and real subscriptions.

Finally, a person must test on an **actual installed PWA phone** with real VAPID
configuration: enable from the friendly permission screen, send a test, receive
a reminder while locked, check hidden details, Done/Snooze, denied permissions,
and iOS Share → Add to Home Screen. Desktop automation is not proof of real-phone
push reception.