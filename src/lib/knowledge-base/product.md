# Product Angle — Decision Frameworks

Use these when turning a customer-review failure theme into a **product recommendation**.

## RICE prioritization
Score `Reach × Impact × Confidence ÷ Effort`. Use this to justify why one theme's fix
belongs on the roadmap before another, not just "this seems important."

## CIRCLES (for "what should we build to fix this?")
- **C**omprehend the situation — what is the underlying job the broken feature was
  supposed to do?
- **I**dentify the customer segment most affected by this theme (not "all users").
- **R**eport their specific need (what would "fixed" look like to them, concretely).
- **C**ut through prioritization — RICE / MoSCoW / Impact-Effort / Kano.
- **L**ist the solution — the actual fix or feature.
- **E**valuate trade-offs — name the downside of the fix (e.g. added latency, dev cost,
  the fix could break something else).
- **S**ummarize the recommendation in one line.

## RCA discipline (root cause, not symptom)
Before recommending a fix, ask: is this an **external** factor (market/seasonal/
competitor move) or **internal** (a specific broken step in the product journey)?
A recommendation aimed at a symptom (e.g. "improve stability" for a crash theme)
is weak. A recommendation aimed at the root cause (e.g. "crash reproduced on
Android 12 during checkout — fix the payment SDK race condition") is strong.

## Kano model (for how badly a fix is needed)
- **Must-be**: absence causes major dissatisfaction, presence is just "expected"
  (e.g. app doesn't crash). Fix these first — they are floor, not ceiling.
- **Performance**: more of it = more satisfaction, linearly (e.g. faster delivery).
- **Delighter**: absence isn't noticed, presence creates disproportionate delight.
Failure themes are almost always Must-be violations — treat them with urgency,
not as a "nice improvement."

## Output discipline
A product recommendation must be **specific and buildable**, not a vibe:
- Weak: "Improve onboarding."
- Strong: "12/50 reviews cite onboarding confusion; 5 couldn't complete sign-up.
  Add inline validation on the email field (the most-cited blocker) — RICE:
  Reach 24%, Impact 3, Confidence 4, Effort 1 → score 288, prioritize this sprint."

## Which funnel stage does each theme actually belong to? (AARRR)
Tag every failure theme by funnel stage before recommending a fix — the fix
type differs completely by stage, and mixing them produces generic advice:
- **Acquisition/Activation** (can't sign up, first-use confusion, setup
  friction) → fix is onboarding flow, not a feature.
- **Retention** (churned, "switched to X," repeat-use friction) → fix is the
  core habit loop or a reliability issue, not more marketing.
- **Revenue** (won't pay, price complaints, downgrade requests) → fix is
  pricing/packaging, not the product itself.
- **Referral** (no organic mentions despite satisfied users) → fix is a
  sharing/incentive mechanic, not a product bug.
A theme with high mention count in Acquisition and a theme with the same count
in Retention are NOT equally urgent — retention loss compounds (existing
revenue at risk), acquisition friction only caps growth. Weight accordingly.

## Choosing a prioritization framework (don't default to RICE for everything)
- **RICE** (Reach × Impact × Confidence ÷ Effort) — best when you have enough
  theme-level data (mention counts, at-risk signals) to score Reach and
  Confidence honestly. This is the default for the main roadmap table.
- **Impact–Effort (Now/Near/Far)** — lighter, faster, and more honest when
  data is thin (few reviews, low confidence in exact scores) — use this
  instead of RICE when Reach/Confidence would just be guesses dressed as
  numbers.
- **Kano tagging** (must-be/performance/delighter) — always apply on top of
  whichever scoring method, since it tells you which fixes are floor
  (non-negotiable) vs ceiling (nice-to-have), independent of score.
Never present a RICE score built on Confidence < 0.3 as if it were precise —
that's the same fabrication risk as inventing a statistic; use Impact-Effort
instead and say the data is thin.
