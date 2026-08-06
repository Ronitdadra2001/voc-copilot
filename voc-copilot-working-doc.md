# Voice-of-Customer Copilot — Working Concept Doc

*A record of our thinking, and a foundation for a PM portfolio case study.*

---

## 1. What this is, in one line

A tool that reads customer reviews for a product — yours or a competitor's — and turns them into a short, ranked list of specific, quantified problems, each backed by real quotes, plus a recommendation for what to do about it.

**Primary user (for the first version):** someone sizing up a competitor's weak spots — a founder or product person who wants to know exactly where a rival is failing customers so they can beat them or avoid the same mistakes.

**Secondary use of the same engine:** point it at your *own* product's reviews to find your top problems. Same machine, two directions.

Note: "for anyone" is not a user. The engine can be pointed at any company, but the *person we design for* is the one above. Keeping that specific is what keeps the product sharp.

---

## 2. How the idea evolved (this is the interesting part)

The concept changed shape three times, and each change made it better. Worth keeping this history, because it shows product thinking in motion.

**v1 — "Scrape the whole internet and run a PM's roadmap."** Broad, exciting, and unbuildable. It mixed together two different jobs (what customers want vs. how hard things are to build) and tried to serve every user at once.

**v2 — "Help someone dissect a competitor through their negative reviews."** A real pivot. Narrower, concrete, demoable. The job became clear: *show me why customers are unhappy with my competitor, so I know where I can win.*

**v3 — the current version.** The output got specific (quantified failure themes with quotes, not vague sentiment), the differentiator got real (an opinionated knowledge base on how to turn problems into roadmap calls), and the inputs got defined.

The lesson embedded here: good products get *narrower and more specific* over time, not broader.

---

## 3. The product, in a paragraph

You point the tool at a company (yours or a competitor's) and feed it that product's reviews. It finds the top pain points, clusters them into themes, attaches the real customer quotes behind each theme, flags language that signals customers are at risk of leaving, and recommends what belongs on a roadmap in response. An AI layer lets you ask follow-up questions, answering from the review data plus an opinionated knowledge base on how to assess a product across the finance, marketing, and product angles.

---

## 4. How it works (the pipeline)

1. **Ingest** the reviews (start with pasted text and App/Play Store, G2, or Trustpilot links — all public and legitimately accessible).
2. **Find the top pain points** — what customers complain about most.
3. **Cluster them into themes** — group "app crashes," "kept freezing," "wouldn't load" into one "stability" theme, so you get signal instead of 500 individual gripes.
4. **Attach real quotes** — every theme is backed by the actual customer sentences, so it's trustworthy and defensible, not a black box.
5. **Flag at-risk signals** — surface exit language ("cancelled," "switching to X," "uninstalled").
6. **Recommend a roadmap move** — for each major theme, what to consider doing about it.

---

## 5. The core principle: specific output, not vibes

This is the heart of the whole product. The difference between a useless tool and a valuable one is entirely in the specificity of the output.

**Weak output (a vibe — do not build this):**
> "Users are unhappy with onboarding."

**Strong output (a decision — build this):**
> "12 of 50 reviews mention onboarding confusion. 5 users couldn't complete the first step (sign-up)."

The strong version is quantified, points at an exact broken step, and tells you what to fix. The weak version tells you nothing you can act on. This move — from *sentiment* (good/bad) to a *root-cause taxonomy* (which specific thing failed, and how often) — is the actual value. Everything else is packaging.

A self-test to use on every feature: **can you write one real row of the output?** If you can, the feature is real. If all you can write is a vague promise, it isn't real yet.

---

## 6. What makes it different: the knowledge base

Anyone can bolt an AI chatbot onto a pile of reviews. That part is a commodity. The differentiator is the **knowledge base you author** — an opinionated method for turning a failure theme into a recommendation across three lenses:

- **Product angle** — what to build or fix.
- **Marketing angle** — how to position against the gap.
- **Finance angle** — the cost of the problem, or the opportunity in solving it.

The value is not "the AI knows marketing." It's "the AI applies *your* specific point of view on how to act." A generic knowledge base has no moat. An opinionated one does.

Example of a single strong output row:

| | |
|---|---|
| **Competitor** | RivalMeals |
| **Failure theme** | Late / missing deliveries — 34% of 1-star reviews, spiking on weekends |
| **Product angle** | Guarantee weekend delivery slots — their weakest point |
| **Marketing angle** | Position explicitly on "reliable weekend delivery" |
| **Finance angle** | Their refund-for-late cost is a bleeding wound; a reliability edge could win their churned users at lower acquisition cost |

---

## 7. Inputs (and a scoping note)

Planned inputs: pasted text, review links, PDFs, Excel/CSV exports, and voice recordings (transcribed, then analyzed).

Reality check for a *portfolio* project: you describe these, you don't build them. Each format is a separate engineering lift. If you ever build, sequence it: pasted text and review links first (easy, high value); voice and file uploads later. And interrogate "image input" — if you can't say exactly what an image is *for* (a screenshot of reviews?), cut it.

---

## 8. Precision note on "churn"

Reviews cannot show real churn — that needs product-usage data you won't have. What reviews *can* show is exit *language*: "cancelled," "switching," "uninstalled." So the honest label is **at-risk / stated-exit signals**, not "churn detection." Being precise about the limits of your data is a senior signal. Overclaiming is the opposite.

---

## 9. PM concepts and frameworks that came up (glossary)

- **Voice of Customer (VoC)** — the category this lives in. A managed system for capturing customer feedback across channels and turning it into prioritized, owned actions. The hard part has never been *collecting* feedback; it's *synthesis and deciding*.
- **"For everyone is for no one"** — trying to serve every user produces a product that fits none. Narrowing to one user is the skill, and the thing PM interviewers look for.
- **Native integrations, not scraping** — real tools connect officially to data sources (App Store, Zendesk, etc.). Scraping "the whole internet" is legally shaky, fragile, and gets blocked. Public review sources are the sane starting point.
- **RICE prioritization** — score features by Reach × Impact × Confidence ÷ Effort, then sort. Forces you to make tradeoffs explicit instead of building whatever's most exciting.
- **Sentiment vs. root-cause taxonomy** — "40% negative" is a chart; "34% cite late delivery" is a decision. The taxonomy is where the value is.
- **The "can you write the output?" test** — if a feature can't be shown as one concrete row of output, it's still a wish, not a feature.

---

## 10. Open questions still to decide

- **Primary user, locked:** competitor-analysis (founder/PM checking a rival) vs. own-product analysis. The doc assumes competitor-first; confirm.
- **What's the single "aha" moment** you want a viewer of your case study to feel? (Likely: the vibe-vs-specific-output contrast.)
- **How opinionated is the knowledge base?** The more specific your method, the stronger the moat — and the better the portfolio story.
- **Success metric** — how would you know the tool worked? (e.g., a user acts on a recommendation they'd otherwise have missed.)

---

## 11. Suggested next step

Turn this into a one-page **PRD / case study** — the format PM applications want. Structure: the user and their painful moment, the narrow first version, the failure-theme taxonomy as the star, a RICE-style prioritization of features, what you deliberately cut and why, and a success metric.

Goal to keep in view: this is a **portfolio project** meant to prove you think like a PM. A focused, sharply-reasoned case study beats a sprawling mega-pitch every time. The grand vision is not the flex — the disciplined scoping is.
