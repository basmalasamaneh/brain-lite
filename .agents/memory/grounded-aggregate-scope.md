---
name: Grounded aggregate scope
description: Guard against plausible but incorrect answers when combining semantic retrieval and SQL totals.
---
Treat aggregates as evidence only for their exact scope. Merchant/category qualifiers, memory type, currency, and the user's local calendar must be respected. Never infer spending intent from Arabic “كم” or English “how much” alone.

**Why:** A correct overall SQL total can still produce a false answer to a merchant-specific question. Broad quantity detection also misroutes Arabic appointment-count questions into receipts. These failures can pass generic retrieval and total tests.

**How to apply:** Test qualified spending, an absent merchant/category, and nonfinancial quantity questions alongside unqualified totals. Aggregate over all matching owned rows, not top-k examples; report currencies separately. If the requested scope cannot be resolved safely, explain the limitation instead of substituting a broader total.