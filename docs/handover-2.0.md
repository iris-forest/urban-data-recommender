# Next Chat Handover 2.0

Last updated: 2026-05-17

This file is the pickup point for the next implementation chat. The app is a Vite React frontend plus FastAPI backend for matching urban planning questions to useful datasets, then helping users review whether selected datasets are good enough to work with.

## Important Reminder For The Next Chat

When this handoff is used again, explicitly mention these two open product/research questions before jumping into implementation:

- The current dataset matching and recommendation logic still needs more testing and refinement. Ask ChatGPT for suggestions, ideas, approaches, and methods for validating and improving the matching system.
- The dataset fit review needs more focus on actual quality in the data. Ask ChatGPT for suggestions, ideas, approaches, and methods for assessing real data quality from preview rows, schema fields, resources, missingness, freshness, joinability, and documentation.
- Dataset analysis needs faster loading, and the app should remember the already-found recommendation results so clicking Back from the fit review does not reload and search the whole dataset catalog again.

Suggested wording to reuse:

> Before implementing more UI changes, I want suggestions for improving two areas: first, how to test and refine the dataset matching so unrelated datasets are filtered out; second, how to make the fit review focus more on actual data quality instead of only metadata or generic fit language.

## Current State

- The workflow is: planning question -> theme overview -> dataset recommendations -> dataset analysis / fit review (mini EDA per selected dataset) -> final overview.
- The backend uses a two-stage recommendation pipeline: broad catalog retrieval, then Stage 2 compatibility scoring with semantic similarity, concept evidence, geography gates, and time alignment.
- **Recommendation evaluation harness:** `backend/app/schemas/recommendation_eval_fixtures.json` plus contract tests in `backend/scripts/test_contract.py` assert must-rank-high / must-not-recommend cases (metro accessibility, Madrid vs Spain, bus stops, green space + LEZ).
- **Stage 2 gates tightened:** non-Madrid scope, generic-only lexical hits, population-only caps when other themes are required, and `is_essential` requires strong compatibility plus minimum metadata quality.
- **Results cache:** `frontend/src/app/store.ts` caches `/recommend` results keyed by planning question, themes, and active API sources. Returning from fit review reuses the cache; **Refresh recommendations** forces a new search.
- **Fit analysis cache:** keyed by indicator text, dataset ids, themes, and preview row count; invalidated when selection or question changes.
- **Mini EDA on fit API:** `eda_profile`, `eda_fit`, `eda_interpretation` on `DatasetFitInsight` (see `backend/app/preview_quality.py` and `backend/app/application/dataset_fit_analysis.py`). Fit review UI shows Match vs data readiness, Profile, Fit, Quality & ethics, Limitations, and domain notes.
- **Detailed fit profiling:** `/datasets/analyze-fit` fetches preview rows when the catalog sample is empty (`FIT_ANALYSIS_ALLOW_FETCH`, short-lived preview cache). Responses include per-column `column_profiles`, `preview_source`, and optional `preview_sample` for the Dataset Analysis UI column health table.
- **Overview themes:** flat subtheme list without main category headings (`StructuredOverview.tsx`).
- **Data sources UX:** unified status labels (`not_imported`, `importing`, `saved_locally`, `stale`, `failed`, `cancelled`), cache freshness hints, and lightweight progress polling while imports run (including on the analyze tab).
- **Continue cancels background imports:** `POST /import/full/cancel-active` before `/analyze` so the first Continue step stays responsive.
- High compatibility scores use green/blue styling; weak scores use red. Results sort by compatibility, not legacy `final_score`.

## Recent Fixes To Preserve

- Removed the hidden catalog warm-up from `/analyze` and `/topics/suggest`; old questions should not keep doing heavy work after the user goes back and edits the planning question.
- Added cancellation for stale recommendation requests on the results page so an old request does not update the UI after navigation.
- Added in-memory caching for catalog search records and semantic candidate vectors to make repeated recommendations faster.
- Added support for optional compatibility fields: `semantic_score`, `compatibility_band`, and `compatibility_evidence`.
- Kept the backend fallback behavior: if local sentence-transformers cannot load, the app uses the deterministic hashed vector backend.

## Recommendation System — Method And Criteria (Plan Input)

Use this section when turning handover 2.0 into an implementation plan. The codebase already follows this shape (`filter_candidates_state` → `score_recommendations_state` in `backend/app/application/recommend_datasets.py`, scoring in `backend/app/domain/recommendations.py`).

### Best overall method

Do **not** rely on a single score from one model. Use a **hybrid pipeline**:

```text
Planning question + user-confirmed themes
        ↓
Stage 1 — Broad retrieval (high recall, cheap)
        ↓
Stage 2 — Compatibility rerank (precision, explainable)
        ↓
Stage 3 — Dataset analysis / fit review (slower; actual data quality)
```

| Approach | Verdict |
|----------|---------|
| Keyword + catalog search only | Fast, but generic terms (`access`, `population`, `mobility`) create false positives. |
| Embeddings only | Good recall; weak on geography, time, and “must mention X” constraints. |
| LLM picks datasets end-to-end | Hard to test, opaque, prompt drift. |
| **Hybrid retrieve + rule/semantic rerank** | **Preferred** — testable, debuggable, evidence in API. |
| Learning-to-rank | Only after labeled good/bad/partial fixtures exist. |

**Do not** add a stronger reranker or bigger embedding model until an **evaluation harness** shows improvement on fixed planning questions.

### Stage 1 — Retrieval (recall)

**Goal:** do not miss plausible datasets; do not finalize ranking here.

**Inputs:**

- Full planning question text
- **User-confirmed themes** (not auto-extracted themes alone)
- Active sources (Madrid CKAN, datos.gob.es cache, imports)

**Retrieval criteria:**

1. Theme overlap — catalog tags + glossary inference (`candidate_from_dataset`, `infer_dataset_theme_overlap`). Themes are **hints**, not proof of fit.
2. Source-appropriate search — CKAN queries, cached catalog scan, imported datasets (`search_relevant_datasets` in `backend/app/catalog.py`).
3. Bounded pool — e.g. ~120 candidates; enough breadth without scoring the entire catalog every request.

**Rule:** category/theme labels are **retrieval hints only**. Stage 2 must use title, description, spatial coverage, and focused concept evidence.

### Stage 2 — Compatibility (precision)

**Goal:** is this dataset actually about the planning question? **Separate from metadata quality.**

Current blend in `score_title_description_compatibility` (conceptual weights):

| Signal | Role |
|--------|------|
| Focused theme / concept evidence | **High** — core relevance |
| Semantic similarity (embeddings) | **High** — capped by gates |
| Lexical overlap / phrases | **Medium** — disambiguate generic embedding matches |
| Temporal fit | **Medium** — years, “last N years”, update frequency |
| Geography | **Hard gate or strong cap** — Madrid vs Spain-wide, granularity |
| Metadata quality (`completeness`, etc.) | **Low for ranking** — tie-break only; stronger in fit review |

Approximate formula today: **45% semantic + 35% concept + 10% text + 10% temporal**, with caps when gates fail.

**Hard gates** (fail → weak / not recommended; do not trust a high % without these):

1. **Geographic scope** — Madrid question + clearly non-Madrid / national coverage → cap (`_non_madrid_scope_reason`).
2. **No focused concept evidence** — theme tag only, no focused keywords/phrases → cap when `not focused_theme_hits`.
3. **Missing required concepts** — question requires phrases the dataset metadata never mentions → cap (`_missing_requested_theme_phrases`).
4. **Weak semantic + no lexical support** — embedding-only false positive → cap.
5. **Generic token dominance** — extend stopwords / phrase groups so `access`, `distance`, `population` alone cannot drive “strong”.

**Soft scores** (rank among survivors):

- Semantic similarity, title/description overlap, recency vs requested period, multi-theme coverage (`_promote_theme_coverage`), source/provenance as **tags/filters** not a hidden multiplier.

**Bands:** `strong` / `partial` / weak. **“Recommended”** = strong **and** passes gates — not “top N by score”.

**Sort order for results list:**

1. Passes hard gates
2. `compatibility_score`
3. `semantic_score`
4. Theme coverage (one strong representative per selected theme when multi-theme)
5. `quality_score` last — never let quality alone promote an irrelevant dataset

Consider **removing `final_score` (theme×quality blend) from recommendation ranking** or renaming it in the UI so it is not read as relevance.

### Themes in the pipeline

1. `/analyze` — suggest themes; **no heavy `/recommend`** on first Continue.
2. User confirms themes — constraints for retrieval and Stage 2.
3. `/recommend` — Stage 1 uses confirmed themes + question; Stage 2 explains per-theme evidence (`focused_matching_themes`, `compatibility_evidence`).

### Validation before algorithm changes

Build a **fixed evaluation set** (5–10 planning questions), each with:

- **Must recommend** (2–5 dataset IDs or stable titles)
- **Acceptable partial** (optional)
- **Must not recommend** (wrong geography, wrong concept, generic overlap traps)

Extend `backend/scripts/test_contract.py` into fixture-driven regression tests. Examples already exist (e.g. metro/accessibility false positives, Madrid vs Spain air quality).

Only after metrics improve: stronger embeddings, or LLM rerank on **top 20** with the same harness.

### Planner-facing checklist (every “strong” row)

1. **Concept** — covers the planning topic
2. **Geography** — right place and granularity
3. **Time** — period and update cadence match
4. **Usability** — formats, preview, join/geo/time fields (fit review)
5. **Trust** — provenance, documentation, license (tags + fit review)

If a row cannot be explained in one sentence from those five, it should not be **strong**.

---

## Open Concern 1: Matching Still Needs Testing And Refinement

The matching system is better structured than before, but it is not trustworthy enough yet. Recent behavior still showed unrelated datasets receiving strong scores, especially when generic words like `access`, `distance`, `population`, `mobility`, or broad public-service terms overlap with the question.

What needs improvement (maps to **Recommendation System — Method And Criteria** above):

- Build a small evaluation set of planning questions with expected good datasets, acceptable partial matches, and known bad datasets.
- Add regression tests for unrelated examples that must never become recommended.
- Tighten geography gates so Spain-wide, non-Madrid, or wrong-granularity datasets cannot score as strong for Madrid-specific questions.
- Tighten concept evidence so generic words do not overpower the actual requested planning concept.
- Treat category/theme labels as retrieval hints only; Stage 2 should rely on real metadata evidence.
- Add debug traces that explain why a dataset crossed or failed the recommendation threshold.
- Consider a stronger reranking method, but only after there is an evaluation harness to prove it helps.

## Fit Review — Mini EDA With Ethical And Quality Interpretation (Plan Input)

Treat **dataset analysis / fit review** not as a second relevance score, but as a **mini exploratory data analysis (EDA)** on each selected dataset: profile what is in the sample, interpret what it means for the planning question, then surface **data quality** and **ethical/use considerations** in plain language.

**Product framing (user-facing):** “We looked at a small sample of this dataset and its documentation so you can judge whether it is fit for your analysis and responsible to use.”

**Technical home:** `DatasetFitReview`, `backend/app/application/dataset_fit_analysis.py`, fit analysis API. Deterministic checks first; LLM may **narrate** findings later, but must not invent statistics not present in preview/schema.

### Mini EDA pipeline (per selected dataset)

```text
1. Profile   — What is in the data? (structure, sample, missingness, types)
2. Fit       — Does it support the indicator? (roles, joins, time, geography)
3. Interpret — Quality + ethics: trust, bias, representation, access, appropriate use
```

| Phase | EDA analogue | Planner question |
|-------|----------------|------------------|
| **Profile** | `df.info()`, head(), missingness | What columns exist? What does the sample look like? |
| **Fit** | Feature/target alignment | Can I actually compute or map my indicator from this? |
| **Interpret** | Analyst notes + limitations | Should I trust this for decisions? Who does it represent or exclude? |

A dataset can be **on-topic but untrustworthy**, or **trustworthy but wrong for the question**. The UI should show **match** (from `/recommend`) separately from **EDA conclusions** (from fit review).

### Ethical and responsible-use lens (interpretation layer)

This is not a full IRB review; it is **structured prompts** derived from metadata, provenance, and preview—so planners see tradeoffs before relying on a dataset.

**Suggested interpretation themes** (each → short bullet + `Good` / `Check` / `Caution` / `Unknown`):

1. **Provenance & authority** — official government vs community/participatory vs research; who produced it and for what purpose (`provenance` tags, provider).
2. **Representation & coverage** — who or what is counted; geographic granularity vs vulnerable areas; risk of **ecological fallacy** (area averages masking inequality).
3. **Missingness as equity signal** — high missingness in key fields may mean under-measurement of places or groups (interpret, don’t only flag technically).
4. **Surveillance-sensitive or personal data** — columns suggesting individuals, fine-grained location, or license plates; caution even when “open data.”
5. **Access & power** — `request needed`, API keys, or non-downloadable formats as barriers to community reuse.
6. **Temporal fairness** — stale data applied to current policy questions; mismatch between collection period and planning horizon.
7. **Appropriate use** — discourage over-claiming: sample is **N preview rows**, not verified full-file statistics; community datasets may be **high value but low formal quality score**.
8. **Complementarity** — when official data misses lived experience, note that a lower-scored community dataset may still be **ethically necessary** (links to domain-knowledge notes).

**Tone:** curious and transparent, not punitive. Prefer “check before using for X” over “bad dataset.”

### Three UI lenses (maps to EDA phases)

Split each card so users are not confused by one blended “fit %”:

| Lens | EDA phase | Question | Primary inputs |
|------|-----------|----------|----------------|
| **Match** | (prior step) | Did we pick the right catalog entry? | `compatibility_score`, `compatibility_evidence` from `/recommend`. |
| **Profile + fit** | Profile + Fit | What’s in the sample and does it support the indicator? | Preview rows, schema, role inference, join/time/geo fields. |
| **Quality & ethics** | Interpret | Can I trust it and use it responsibly? | Missingness, freshness, documentation, provenance, access, interpretation bullets above. |

### Suggested per-dataset UI blocks

**A. Header (keep, refine)**

- Dataset title, provider, provenance tag
- **Two scores side by side** (not one):
  - **Match** — from recommendation `compatibility_score` / band (from results step)
  - **Data readiness** — new composite from fit analysis (see below), with tooltip “Based on preview sample + metadata, not the full file”
- Retire or subordinate the single **fit_score** progress bar so it is not the only signal

**B. “Why it matches” (existing, keep)**

- `What helps` / `What lowers confidence` (`formatFitScoreExplanation`)
- `useful_columns`, `missing_requirements`, `recommended_role`

**C. “Data profile” (EDA — Profile)**

Short, factual summary of what was inspected (always state **sample scope**):

- Rows/columns analyzed; preview available or metadata-only
- **Missing values in preview** — e.g. “Missing values in 3 of 5 preview rows; most affected: `district_code` (2), `population` (1)” (`preview.py` / shared helper)
- Placeholder detection — empty, `NA`, `N/A`, `null`, whitespace
- **Uniform/suspicious columns** in sample (flag for manual check)
- Optional later: column types inferred, distinct counts in sample (keep lightweight)

**D. “Fit for your indicator” (EDA — Fit)**

- Required roles from indicator/themes vs detected roles (`THEME_ROLE_MAP`, column/schema inference)
- **Found** / **Missing** for geography, time, measure, population, etc.
- `join_keys`, `time_fields`, `geo_fields` with tooltips
- `useful_columns` with semantic roles
- Existing “Why this score?” / `What helps` / `What lowers confidence`

**E. “Quality & ethical considerations” (EDA — Interpret)**

Structured checklist with status per row: `Good` / `Check` / `Caution` / `Unknown` (avoid false precision unless computed from preview).

Group checks under two subheadings:

*Data quality*

- Structure & documentation (metadata description ≠ row completeness)
- Freshness vs `parsed_indicator.time_frame`; update frequency
- Spatial granularity vs requested geography
- Files & previewability; non-previewable formats

*Responsible use*

- Provenance & who produced the data
- Representation / coverage gaps suggested by missingness or coarse geography
- Access barriers (`access_type`, request-needed)
- Surveillance-sensitive column names (heuristic list)
- **Appropriate-use note** — sample-based EDA only; not a certified audit
- Prompt to add **domain knowledge notes** when formal score undervalues community or qualitative sources

**F. “Limitations” (synthesis)**

- Amber panel — top 3–5 synthesized caveats from Profile + Fit + Interpret
- Merge `limitations` + top `quality_risks`; lead with sample scope

**G. Domain knowledge notes (existing)**

- Collapsible; planner’s ethical/contextual override; include in export/summary

### Backend: suggested `DatasetFitInsight` extensions

Model the mini EDA as structured sections (names flexible):

```python
eda_profile: {
  "rows_analyzed": 5,
  "columns_analyzed": 12,
  "metadata_only": bool,
  "preview_stats": { "rows_with_missing": 3, "columns_affected": [...] },
  "profile_notes": ["Uniform value in column `status` across sample."]
}
eda_fit: {
  "roles_found": ["geography", "time", "measure"],
  "roles_missing": ["population"],
  "join_keys": [...],
  "time_fields": [...],
  "geo_fields": [...]
}
eda_interpretation: {
  "readiness_band": "usable_with_checks",  # optional summary band
  "quality_checks": [{"id": "preview_missingness", "status": "caution", "message": "..."}],
  "ethical_checks": [{"id": "provenance", "status": "good", "message": "Official municipal open data."}],
  "synthesis": "Short paragraph tying profile + fit + ethics (LLM optional if enabled)."
}
```

**Computation (deterministic first; LLM optional later):**

- **Profile:** `build_dataset_preview`, shared missingness helper, placeholder/uniform detectors in `dataset_fit_analysis.py`
- **Fit:** existing role inference, `_missing_requirements`, column insights
- **Interpret:** extend `_quality_risks` into categorized `quality_checks` + new `_ethical_considerations(dataset, evidence, request)` using provenance, access, column-name heuristics, missingness interpretation, timeliness
- Map catalog `DatasetQuality` only to **metadata/documentation** checks — never as “row completeness”
- If LLM is used: pass **structured check results** as input; require it to cite only those facts (no invented percentages)

**Scoring guidance:**

- **Readiness band** = synthesis label, not the hero metric
- Heavy weight: preview missingness, missing required roles, metadata-only when files exist
- Medium: timeliness, join/geo/time, access barriers
- Light: formal metadata quality scores
- **Ethical checks** never reduce to a single number; use `Caution` + explanation
- Deprecate or subordinate blended **fit_score** in favor of **match** (recommend) + **EDA synthesis** (fit review)

### Cross-dataset block (top of page)

Keep “How these datasets work together”; add one line per dataset:

- `Dataset A — match strong, data readiness: check missingness`
- So users see quality at a glance before scrolling cards

### Performance / UX

- Run cheap checks synchronously; show cards progressively if needed (handover concern 3)
- Cache fit analysis in `appStore` keyed by `dataset_ids` + question hash + preview row count
- Reuse recommendation snapshots sent from frontend (`dataset_snapshots`) to avoid refetch

### Implementation order (mini EDA fit review)

1. Shared `preview_missingness` + profile stats (backend); `eda_profile` on fit response
2. `eda_fit` from existing role/column inference; expose clearly in UI
3. `_ethical_considerations` + `eda_interpretation.quality_checks` / `ethical_checks`
4. UI: Profile → Fit → Quality & ethics → Limitations → Domain notes
5. Split **Match** (recommend) vs **EDA synthesis** in header; sample scope on every card
6. Optional: LLM `synthesis` paragraph only when `is_llm_enabled`, grounded in structured checks

### Testing

- Unit tests on missingness helper with fixture rows
- Contract test: fit response includes `data_quality_summary` for dataset with known nulls in preview
- Manual: high-fit + bad preview, low-fit + good preview, no-preview metadata-only

---

## Open Concern 2: Fit Review Needs More Actual Data Quality

The dataset fit review should behave like a **mini EDA**: profile the sample, interpret fit for the indicator, then explain **data quality and ethical/use considerations**—not another opaque relevance percentage.

What needs improvement (maps to **Fit Review — Mini EDA With Ethical And Quality Interpretation** above):

- Analyze preview rows for missing values, empty fields, repeated placeholders, invalid values, and suspicious uniform values.
- Inspect schema fields for useful geography fields, time fields, join keys, numeric measures, and unclear column names.
- Show whether the dataset has the fields needed for the planning question, not just whether its title sounds related.
- Explain data quality issues in concrete terms: missingness, granularity mismatch, stale publication date, weak documentation, non-previewable files, unclear license/access, or missing join fields.
- Separate `fit for the question` from `quality of the data`; a dataset can be relevant but low quality, or high quality but irrelevant.
- Use the actual preview/resources when possible, while clearly saying when the analysis is only based on sampled rows.

## Open Concern 3: Dataset Analysis Needs Faster Loading And Result Memory

The dataset analysis / fit review path needs to feel faster. A major avoidable slowdown is reloading recommendations after the user clicks Back from fit review to the results page. If the planning question and confirmed themes are unchanged, the app should reuse the already-found results instead of searching and reranking the whole catalog again.

What needs improvement:

- Store the recommendation response or converted dataset list in workflow state after the first successful `/recommend` call.
- Add a cache key based on planning question text, selected themes, active sources, and any other filters that materially change the result set.
- When returning to `/results`, reuse cached recommendations if the cache key matches.
- Keep selected dataset state separate from recommendation result state so selections can change without forcing a full reload.
- Add a manual refresh/re-run affordance if the user wants to recompute recommendations.
- Make dataset analysis loading faster by caching or reusing fit-review inputs where possible, especially preview rows and selected dataset metadata.
- Avoid stale-data bugs: invalidate cached recommendations when the planning question, confirmed themes, imported catalog sources, or active source filters change.

Questions to ask ChatGPT before implementation:

- What is the cleanest frontend state design for remembering recommendation results across route changes?
- Should recommendation caching live in the frontend store, backend session cache, or both?
- What cache key should invalidate results safely without causing unnecessary reloads?
- How can dataset analysis load progressively so users see useful content while slower quality checks finish?

## Open Concern 4: Overview Page Theme Display Cleanup

The overview page should remove the main category labels. Users should see the actual selectable themes/subthemes without extra main-category labeling that makes the page feel heavier and less precise.

What needs improvement:

- Remove main category labels/headings from the overview page theme display.
- Keep the selectable theme/subtheme chips or rows visible and understandable.
- Make sure removing category labels does not break theme grouping, selection state, or the Continue action.
- Check mobile layout after removing the labels so theme controls still scan well.

## Open Concern 5: Imported Dataset Browsing And Data Source State

The imported datasets page should be easier to browse and should make the source connection/import state feel reliable. Right now, viewing imported datasets does not have enough filtering controls, and the Data Sources tab can make it unclear whether the tool is actually connected to the data sources or whether the UI is stale.

What needs improvement:

- Add a search bar to the imported datasets page, including `/imported?source=madrid-ckan`.
- Add a category filter to the imported datasets page using the same category taxonomy/labels shown elsewhere in the app.
- Keep imported dataset filtering local and fast once the imported dataset list has loaded.
- Show a clear empty state when search/filter combinations return no datasets.
- Make the Data Sources tab reflect the current source state: imported, importing, failed, stale, not imported, or ready to import.
- Ensure the Data Sources tab and imported datasets page agree with each other after imports, clears, refreshes, and app reloads.
- Consider showing last import time, imported count, and cache freshness for each source.
- Make it obvious whether the app is using cached full-catalog data, live API import state, or only a bounded quick import.
- Make sure active imports cannot block or starve the first planning-question `/analyze` request. If an import is running, Continue should either remain responsive or explain that the data-source import is occupying backend work.
- Clear stale timeout messages after a successful retry so the user does not think Continue is still failing after the backend has recovered.
- Poll or subscribe to source progress/status so the Data Sources tab updates as soon as a source becomes fully connected.
- Do not rely on the user switching tabs, refreshing, or clicking again to reveal that a source is connected.
- Avoid UI pauses while checking source state; source status should load independently from the planning-question flow.

Questions to ask ChatGPT before implementation:

- What source-status model should the UI expose so users trust that external data sources are connected?
- How should cached catalog state, live import progress, and manually imported datasets be represented without confusing users?
- Should imported dataset filters share code with the main results filters, or stay separate because the page has a different purpose?
- Should full-catalog imports run in a separate worker/process so they cannot slow down `/analyze` and other interactive requests?
- What lightweight polling/subscription approach should keep source status current without adding backend load or flicker?

## Suggested Next Implementation Plan

1. Expand the recommendation eval fixture set (more planning questions, partial-band expectations).
2. Optional LLM-grounded `eda_interpretation.synthesis` when `is_llm_enabled`.
3. Results-page filters and detail-panel markdown (see `docs/handover-next-steps.md`).
4. Consider a background worker for full-catalog imports if `/analyze` latency is still an issue under load.
5. Browser regression pass on two different planning questions, fit-review Back navigation, and imported-dataset browse.

## Useful Files

- `backend/app/application/recommend_datasets.py`
- `backend/app/domain/recommendations.py`
- `backend/app/domain/theme_matching.py`
- `backend/app/embeddings.py`
- `backend/scripts/test_contract.py`
- `frontend/src/app/components/DatasetResults.tsx`
- `frontend/src/app/components/DatasetDetailPanel.tsx`
- `frontend/src/app/components/DatasetFitReview.tsx`
- `frontend/src/app/components/StructuredOverview.tsx`
- `frontend/src/app/components/ImportedApiDatasets.tsx`
- `frontend/src/app/api.ts`
- `frontend/src/app/types.ts`

## Verification To Run Next Time

- `uv run ruff check backend/app backend/scripts/test_contract.py`
- `../.venv/bin/python scripts/test_contract.py` from `backend/`
- `pnpm run build` from `frontend/`
- Browser pass: enter a planning question, confirm themes, inspect recommended datasets, then go back and try a second planning question to confirm stale recommendation work does not leak through.
- Browser pass: after reaching dataset analysis / fit review, click Back to results and confirm the previous recommendations appear without a full reload/search.
- Browser pass: open `/imported?source=madrid-ckan`, search imported datasets, filter by category, and verify the Data Sources tab shows the same source/import state.
- Browser pass: start or simulate an active data-source import, then enter a planning question and confirm Continue does not hang or leave a stale timeout error after retry.
- Browser pass: complete or simulate completion of a source import and verify the Data Sources tab updates to fully connected without refresh, tab switching, or a visible pause.

