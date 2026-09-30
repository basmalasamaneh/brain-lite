---
name: Notification delivery tradeoff
description: Why reminder delivery chooses at-most-once attempts and preserves minimal dedup identities.
---
Preserve the deliberate at-most-once external delivery policy unless the user agrees to change it. Do not add automatic retries after an uncertain Web Push/email outcome.

**Why:** The user explicitly requires no duplicate sends. External providers cannot participate in the database transaction, so exactly-once delivery is not achievable. Claiming before sending prevents duplicates but can lose external delivery on crashes or temporary provider errors; setup documentation discloses that tradeoff.

**How to apply:** Keep in-app records available and distinguish provider acceptance from actual phone receipt. When changing retry behavior, explain the duplicate-versus-loss tradeoff first. Logout clears visible reminders/history as requested, but privacy-minimized terminal identities must survive so login regeneration cannot resurrect Done/Dismissed reminders.