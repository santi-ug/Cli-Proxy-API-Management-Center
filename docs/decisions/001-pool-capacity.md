# Plan-weighted pool estimates

Accepted October 3, 2026.

## Problem

Adding account percentages treats a full Claude Max 5x subscription and a full Pro subscription as equal. It also produces totals such as 125% of 200%, which do not express the percentage of combined capacity remaining.

## Decision

Use each known plan's advertised multiplier relative to its provider's base plan. Keep weights beside plan labels in the provider registry: Claude Pro 1, Max 5x 5, Max 20x 20; Codex Plus 1 and Pro 20x 20. Prices do not determine weights.

For each window, calculate `sum(remaining_percent × weight) / sum(weight)` across its holders. Round once after the calculation. Size each weekly bar segment by the same weight and keep its fill relative to that account's remaining percentage. Show account names and multipliers below the bar.

With Claude Max 5x at 74% and Pro at 51%, the estimate is `(74 × 5 + 51) / 6 = 70%` after rounding. Codex Pro 20x at 95% plus Plus at 100% gives 95% after rounding.

The provider's reported plan code determines capacity. Only when no code is available, an exact known `pool_plan` label can supply it. An unrecognized code or custom label stays unknown. Missing usage or an unknown window holder's weight hides the total and weekly bar rather than presenting a partial pool as complete. A successfully read account without a window is outside that window's denominator.

## Limits

The registry reflects the tiers already labeled by this fork. These multipliers are estimates of relative capacity, not measured token budgets or guaranteed ratios for every window. Model, workload and provider policy can change actual allowances. Label summaries as estimates, keep each account's original quota percentage, and update the registry if supported tiers change. Routing priorities, reserve floors and reset counts are independent of this display calculation.
