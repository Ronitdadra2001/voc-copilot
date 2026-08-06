# Finance Angle — Decision Frameworks

Use these when turning a customer-review failure theme into a **cost-of-problem
or opportunity-sizing recommendation**.

## Frame every theme as a cost or a foregone opportunity
- **Cost of the problem** (if it's your own product): refunds/credits issued,
  support-ticket load, churn-driving reviews translating to lower conversion on
  app-store/G2 pages (social proof loss), CAC wasted on users who then churn
  right after the failure.
- **Opportunity in a competitor's failure**: if a rival's weakness is costing
  them (e.g. refund-for-late-delivery payouts, negative-review-driven CAC
  inflation), a reliability edge can win their frustrated users at a *lower*
  acquisition cost than cold acquisition — quantify that delta when possible.

## Unit economics lens (CAC / LTV)
- If a failure theme is concentrated in newly-acquired users (e.g. onboarding
  confusion), the cost is inflated CAC — you paid to acquire someone who churns
  before reaching activation, so CAC is fully wasted.
- If a failure theme is concentrated in long-tenured users, the cost is LTV
  erosion — a smaller number of higher-value customers leaving early.
- Rule of thumb: LTV:CAC should stay ≥ 3:1. A failure theme that pulls this
  ratio toward 1:1 is a red flag regardless of raw review volume.

## Relevant-cost discipline (don't recommend fixing everything)
Before recommending a fix, ask: is the cost of the *fix* relevant compared to
the cost of the *problem*? Ignore sunk costs (money already spent building the
broken feature) and allocated costs (fixed overhead that exists regardless).
Only weigh the incremental cost of the fix against the incremental cost the
theme is actually causing.

## Severity triage using cost, not just review count
A theme with fewer mentions but high stated-exit language ("cancelled,"
"switching to X," "uninstalled") is more financially urgent than a
higher-volume theme with only mild complaints — exit language predicts real
revenue loss, complaint volume alone does not.

## Output discipline
- Weak: "This is costing us money."
- Strong: "Late-delivery refunds appear in 34% of RivalMeals' 1-star reviews;
  if their refund policy pays out ~$X per late order and this is Y% of orders,
  that's a recurring bleed — a reliability edge lets us acquire their
  frustrated users at a CAC below blended market CAC, since public complaint
  volume signals an already-primed switching intent."

## The margin waterfall — use this to say WHERE money is leaking (only with real figures)
Gross Margin (Revenue−COGS) → EBITDA Margin (minus opex) → EBIT Margin (minus
depreciation) → PAT Margin (minus interest/tax). Each gap accuses a different
part of the business, and only apply this when real financial figures are
present in the source text:
- Thin Gross Margin → sourcing/pricing problem; no amount of downstream
  efficiency fixes a product that costs too much to make relative to price.
- Big EBITDA→EBIT gap → capital intensity (heavy fixed assets); explains a high
  break-even and high operating leverage.
- Big EBIT→PAT gap → the company is financing-heavy; a review-driven revenue
  dip is more dangerous here because there's less room to absorb it.

## Relevant-cost / hidden-loser check (ABC logic)
When a company allocates overhead evenly across products, high-volume simple
products get over-costed and low-volume complex products get under-costed — so
a "hero SKU" can be secretly unprofitable while a low-volume item quietly loses
money on every unit. If review/finance data suggests a specific product/SKU is
being scaled while complaints (returns, refunds) concentrate there, flag this
as a candidate hidden loser rather than assuming the flagship product is
automatically the profitable one. A cost is only relevant to a fix decision if
it *differs* between doing the fix and not doing it — ignore sunk costs and
costs the company pays either way.

## Break-even / operating leverage (only with real fixed-cost data)
Contribution margin = price − variable cost per unit. Operating leverage =
contribution margin ÷ EBIT — it's an amplifier: a business with high fixed
costs sees profit swing hard in both directions with revenue. If a company's
reviews show declining volume AND its cost structure is fixed-cost-heavy
(evidenced in the data, not assumed), flag that the revenue risk is amplified,
not linear — this changes how urgently the root-cause fix should be
prioritized.
