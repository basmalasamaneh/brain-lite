---
name: Gemini model availability
description: Distinguish listed Gemini models from models available to an account.
---
Do not treat Gemini's models.list results as proof that a model can generate content for the configured account.

**Why:** On 2026-09-30, gemini-2.5-flash appeared in the model list but generation returned 404 stating it was no longer available to new users and recommended gemini-3.8-flash. The recommended model then returned a temporary 503 high-demand response.

**How to apply:** Validate a selected model with a small synthetic generation request. Distinguish model retirement from transient capacity errors, disclose unverified live behavior, and never expose keys in diagnostic output.
Test the application's actual structured extraction and grounded-answer prompts as well as a minimal generation probe. A successful short text response does not establish that the model handles the required JSON outputs reliably.

**Why:** Provider capacity errors were intermittent even for a model that passed a minimal probe; application-shaped tests distinguish connectivity from usable end-to-end behavior.

For structured speech extraction, normalize semantically absent optional values without relaxing validation of supplied facts or unknown fields.

**Why:** Real English and Arabic speech produced valid transcripts and separate tasks, but Gemini returned null for an irrelevant currency despite the prompt requesting a string. Rejecting that absence discarded otherwise usable extraction.

**How to apply:** Exercise actual audio in the target languages; allow explicit null/absence only for optional values, and keep incorrect types and invented facts rejected.

Treat high-confidence duplicate labels conservatively; related documents are not necessarily interchangeable.

**Why:** Real connection discovery once labeled a laptop warranty and its receipt as duplicates with high confidence, although an earlier run correctly identified them as related. Confidence alone is not evidence that deleting either preserves the user's information.

**How to apply:** Keep source-specific relationship prompts, deterministic safeguards against distinct-purpose duplicates, and explicit keeper selection plus confirmation before merging. Test receipt/copy and receipt/warranty together.