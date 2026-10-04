# Plan value remaining

Accepted October 4, 2026.

## Problem

Adding account percentages gives a full $100 plan and a full $20 plan equal influence. Using each provider's largest plan as 100% solves that within a provider but makes comparisons misleading: $120 of Claude plans appears as 120%, while $220 of Codex plans appears as 105%.

## Decision

Use a fixed $100 monthly-plan-value baseline for every provider and quota window. Label pooled estimates **Plan value remaining**, with **100% = $100 in monthly plans**. Keep monthly USD list prices beside known plan labels in the provider registry: Claude Pro $20, Max 5x $100, Max 20x $200; Codex Plus $20 and Pro 20x $200.

For each window, show `sum(remaining_percent × monthly_price_usd) / 100` left against `sum(monthly_price_usd) / 100 × 100` full value. Round once after each calculation. One continuous weekly bar fills by the unrounded remaining share of the pool's plan value, `sum(remaining_percent × monthly_price_usd) / sum(monthly_price_usd)`.

A full Claude $100 + $20 pool gives 120%, and a full Codex $200 + $20 pool gives 220%. Two $200 Claude plans plus $100 and $20 give 520%. Adding a larger plan does not rescale existing accounts. Claude $100 at 74% plus $20 at 51% gives 84% left of 120% after rounding. Codex $200 at 95% plus $20 at 100% gives 210% left of 220%.

The provider's reported plan code determines the known price. Only when no code is available, an exact known `pool_plan` label can supply it. An unrecognized code or custom label stays unknown; prices are not parsed from arbitrary labels. Missing usage or an unknown window holder's price hides the total and weekly bar rather than presenting a partial pool as complete. A successfully read account without a window is outside that window's calculation.

## Limits

This is a price-weighted estimate of unused subscription value. It is not a cash balance, actual billing, or a measure of interchangeable requests across providers. List prices do not account for taxes, discounts, annual billing or local pricing. Actual request allowances depend on the model, workload and provider policy. Keep each account's original quota percentage, and update the registry if supported tiers or list prices change. Routing priorities, reserve floors and reset counts are independent of this display calculation.
