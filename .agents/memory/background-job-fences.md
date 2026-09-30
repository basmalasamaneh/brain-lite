---
name: Background job fences
description: Precision loss can silently reject valid AI work when database timestamps are used as concurrency fences.
---
Never round-trip a PostgreSQL timestamp through a JavaScript Date when requiring exact equality to reject stale background work. Prefer integer versions or retain the database's exact timestamp text.

**Why:** Space matching generated embeddings and retried jobs but could not persist results reliably: JavaScript Date loses PostgreSQL microseconds, invalidating an otherwise unchanged candidate's timestamp fence.

**How to apply:** Preserve database precision for equality checks, separately from human-readable date formatting. Verify persisted results through the actual worker path; successful provider responses alone do not establish that a background feature works.