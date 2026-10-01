---
name: Graph question scope
description: Why graph questions use a strict visible-memory scope while existing Space Ask keeps its broader behavior.
---
Graph “Ask about this” intentionally asks about the selected entity’s memories visible under the current graph filters and node cap. Space/Person labels must make that subset explicit, with total counts distinguished from on-map counts.

**Why:** Existing Space Ask intentionally expands through confirmed connections. Reusing that behavior for a selected graph node could answer using memories outside the selection the user sees. Changing legacy Space Ask would also change an existing feature the user asked to preserve.

**How to apply:** Keep graph retrieval, aggregates, and conversation state strictly scoped. If adding full-entity questions later, make that a distinct, explicit UI choice rather than silently expanding the current graph selection.