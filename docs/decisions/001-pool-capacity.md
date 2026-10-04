# Plan-weighted pool estimates

Accepted October 4, 2026.

## Problem

Adding account percentages treats a full Claude Max 5x subscription and a full Pro subscription as equal. It also produces totals such as 125% of 200%, which do not express the percentage of combined capacity remaining.

## Decision

Use each known plan's advertised multiplier relative to its provider's base plan. Keep weights beside plan labels in the provider registry: Claude Pro 1, Max 5x 5, Max 20x 20; Codex Plus 1 and Pro 20x 20. Prices do not determine weights.

For each window, its largest holder's plan is the 100% reference. Show `sum(remaining_percent × weight) / largest_weight` left, against `sum(weight) / largest_weight × 100` full capacity. Round once after each calculation. One continuous weekly bar fills by the unrounded share of total capacity remaining, `sum(remaining_percent × weight) / sum(weight)`.

With Claude Max 5x at 74% and Pro at 51%, the estimate is `(74 × 5 + 51) / 5 = 84%` after rounding, out of 120% capacity. A full Pro plan contributes 20%. Codex Pro 20x at 95% plus Plus at 100% gives 100% left out of 105%, since a full Plus contributes 5%. Two identical full plans give 200% out of 200%.

The provider's reported plan code determines capacity. Only when no code is available, an exact known `pool_plan` label can supply it. An unrecognized code or custom label stays unknown. Missing usage or an unknown window holder's weight hides the total and weekly bar rather than presenting a partial pool as complete. A successfully read account without a window is outside that window's calculation and reference plan.

## Limits

The registry reflects the tiers already labeled by this fork. These multipliers are estimates of relative capacity, not measured token budgets or guaranteed ratios for every window. Model, workload and provider policy can change actual allowances. Label summaries as estimates, keep each account's original quota percentage, and update the registry if supported tiers change. Routing priorities, reserve floors and reset counts are independent of this display calculation.
