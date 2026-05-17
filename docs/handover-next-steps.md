# Next Chat Handover

Last updated: 2026-05-13

This file is the pickup point for the next implementation chat. The app is running as a Vite React frontend plus FastAPI backend. The current user-visible goal is to make dataset details and dataset-fit review explain their scores more clearly, while rendering catalog descriptions with their intended formatting.

## Already Done In This Pass

- Slowed the rotating loading status on the results page by changing `LOADING_STATUS_ROTATION_MS` in `frontend/src/app/components/DatasetResults.tsx` from `2400` to `3600`.
- Added this handover doc as the only current Markdown file under `docs/`.
- Removed stale docs that no longer matched the code: API contract, backend/frontend overview, manual QA, release readiness, and the old completion checklist.
- Updated `README.md` to reference only this handover doc.
- Removed small docs noise: the stray leading blank line in `frontend/README.md`.

## Main TODO 1: Missing-Data Summary In Dataset Preview

Goal: In `DatasetDetailPanel`, add a compact summary near Data Preview that explains which preview columns have missing values and how many preview rows are affected. This should help users understand why a dataset completeness score is lower than expected.

Suggested product behavior:

- Show the summary only when preview rows exist.
- Keep it small and scannable, for example: `Missing values found in 3 of 5 preview rows. Most affected: district_code (2), population_total (1).`
- If no missing values are visible in the sampled rows, show a calmer note such as: `No missing values were visible in the preview rows.`
- Make it clear this is based on the preview sample, not the full source file, unless the backend later computes full-file statistics.
- Place the summary between the Schema chips and the preview table in `frontend/src/app/components/DatasetDetailPanel.tsx`.
- Treat `null`, `undefined`, empty strings, whitespace-only strings, `"NA"`, `"N/A"`, `"null"`, and `"None"` as missing.

Implementation outline:

- Add a helper in `DatasetDetailPanel.tsx`, for example `getPreviewMissingnessSummary(rows, columnNames)`.
- Return `{ affectedRows, totalRows, columns: Array<{ name: string; missingCount: number }> }`.
- Use `rowColumnNames` as the column list so the summary matches the visible table.
- Render only the top 3 affected columns, with a `+N more` suffix if needed.
- Style it as a neutral or amber inline note, not a large alert, because preview-level missingness is informational.

Testing:

- Add a frontend unit test only if the repo already has a test harness. If not, run `pnpm build`.
- Manually verify with a dataset whose preview has blank/null cells.

## Main TODO 2: Render Markdown In Dataset Descriptions

Goal: Some catalog descriptions include Markdown syntax, but the detail panel currently renders them as plain text in a `<p>`. Render safe Markdown so emphasis, links, and lists look intentional.

Recommended approach:

- Use a small Markdown renderer in `DatasetDetailPanel`.
- Prefer `react-markdown` plus `remark-gfm` if adding dependencies is acceptable.
- If adding dependencies, run `pnpm install` from `frontend/` and commit both `frontend/package.json` and `frontend/pnpm-lock.yaml`.
- Do not render raw HTML from catalog descriptions. Keep raw HTML disabled or sanitize it before rendering.
- Links should open in a new tab with `rel="noreferrer"`.
- Preserve the existing `Read more` / `Show less` behavior. The simplest first pass can still truncate the raw string before rendering; a more polished pass can clamp the rendered block with CSS.

Likely files:

- `frontend/src/app/components/DatasetDetailPanel.tsx`
- `frontend/package.json`
- `frontend/pnpm-lock.yaml`

Testing:

- Use a local description sample with bold text, a list, and a link.
- Run `pnpm build`.
- Check that plain descriptions still look the same.

## Main TODO 3: Preview Completeness Versus Dataset Completeness

The existing `dataset.quality.completeness` value comes from backend metadata heuristics and is not currently calculated from preview missingness. The new missing-data summary should not claim to be the direct source of the completeness percentage unless backend logic is changed.

If the next pass wants tighter alignment:

- Extend `backend/app/preview.py` to compute missingness stats over the preview rows and include them in `DatasetPreviewResponse`.
- Update `backend/app/api_schemas.py` with a new optional field such as `missingness_summary`.
- Update `frontend/src/app/api.ts` and `frontend/src/app/types.ts` to carry that response shape.
- Add backend contract coverage in `backend/scripts/test_contract.py`.

For now, frontend-only preview missingness is enough and avoids changing the API contract.

## Main TODO 4: Explain Dataset-Fit Percentages And Repeat The Indicator

Goal: In `DatasetFitReview`, make the fit percentage easier to understand and repeat the user's indicator description on the page so users can judge the fit without navigating back.

Suggested product behavior:

- Show the original indicator description near the top of the dataset-fit review, below the title and intro copy.
- Keep the indicator text visually quieter than the page title but more prominent than helper text, for example in a bordered quote-style block or an unframed text band.
- Add a short explanation beside or below each dataset's fit percentage that says what contributed to the score.
- Avoid exposing raw scoring internals as formulas. Use planner-friendly language, such as: `Strong fit because it covers water management, includes district fields, and has previewable columns. Lower score if it misses time fields or requested themes.`
- Include the biggest positive signals and the biggest gap, not every possible factor.
- Preserve the existing progress bar and fit badge, but make the percentage feel explainable rather than arbitrary.

Implementation outline:

- In `frontend/src/app/components/DatasetFitReview.tsx`, render `request.description` in the top summary area.
- Use existing fields from `DatasetFitInsight`: `fit_score`, `fit_summary`, `useful_columns`, `limitations`, `missing_requirements`, `join_keys`, `time_fields`, `geo_fields`, and `quality_risks`.
- Add a helper such as `formatFitScoreExplanation(insight)` that returns one concise sentence.
- Consider showing a small `Why this score` section per dataset with two compact lines: `What helps` and `What lowers confidence`.
- Keep language human-readable: translate semantic roles with `formatRole` and reuse existing summary cleanup helpers where possible.

Testing:

- Run `pnpm build`.
- Manually verify a high-fit dataset, a medium-fit dataset, and a dataset with missing requirements.
- Check that the repeated indicator text wraps cleanly on mobile and does not crowd the fit cards.

## Main TODO 5: Add Filter And Sorting For Available Datasets

Goal: In the available datasets step, let users quickly narrow and reorder the list so they can find the most relevant datasets faster.

Suggested product behavior:

- Add filtering controls for at least source, category, access type, and quality signals (for example completeness bands).
- Add sorting options such as relevance, completeness, publication date, and alphabetical dataset name.
- Keep filtering and sorting state visible near the dataset list header.
- Apply filters and sorting to both card and table views consistently.
- Show an empty-state message when filters return no results, with a one-click reset action.

Implementation outline:

- Update state and derived list logic in `frontend/src/app/components/DatasetResults.tsx`.
- Keep existing search behavior and apply it together with new filters.
- Add small reusable helpers for sorting and filtering so behavior is easy to test.
- Ensure pagination uses the filtered/sorted list and resets to page 1 when controls change.

Testing:

- Run `pnpm build`.
- Manually verify filter combinations in both card and table views.
- Confirm sorting changes order correctly and remains stable when toggling views.
- Confirm reset controls restore the default dataset list.

## Main TODO 6: Clarify Product Language, Trust Signals, And Governance

Goal: Improve wording, transparency, and expectations so users understand what the tool does, how scores are produced, and how data is handled.

Requested wording and UX changes:

- The wording `indicator` is not really clear; perhaps change it to something else.
- Make sure text/phrasing matches your values.
- The `dataset fit review` should be a `dataset analysis` instead.
- The fit score is still vague.
- `Selected datasets are checked one by one.` -> clarify whether this is human review, AI analysis, or both.

Transparency and trust gaps to address:

- It’s not clear what user data (inputs, reports) is stored, for how long, and who can access it (privacy and governance).
- There is no quick way to see how many datasets match each theme before continuing.
- `Quality 80%` looks precise but unexplained; users don’t know how it’s calculated or if they can trust it.

Ideas to evaluate and potentially implement:

- Make it clear that the tool is matching fitting datasets that users can use to find specifics themselves, instead of suggesting the tool already finds all specifics for them.
- Maybe add an option to see previous reports, such as a 30-day memory/history.
- Clarify whether a page/session can be shared with another person and how.
- Explain the purpose of the tool at the beginning of the first step.
- Keep the imported-dataset `View` action visible but disabled, with a tooltip that says it is a future feature.

Implementation outline:

- Audit all step titles, headings, and helper text in `InputScreen`, `StructuredOverview`, `DatasetResults`, and `DatasetFitReview`.
- Rename `Dataset Fit Review` user-facing text to `Dataset Analysis` (code-level rename can be deferred if risky).
- Add concise `How score is calculated` helper text next to fit score and quality score labels.
- Add a short privacy/governance notice covering stored fields, retention window, and access policy.
- Add a pre-continue summary showing matched dataset counts by theme.
- Replace ambiguous copy implying complete automation with copy that sets realistic scope and user responsibility.

Testing:

- Run `pnpm build`.
- Manually verify every step for terminology consistency (`indicator` replacement and `dataset analysis` naming).
- Manually verify that score explanations and privacy text are visible without opening developer tools.
- Validate that the theme-match count summary appears before the continue action.

## Main TODO 7: Improve Dataset Detail, Fit Review, And Loading Clarity

Goal: Make the dataset detail page, fit review, and loading states easier to understand and act on.

Requested product changes:

- Add the publication date in data source view for each dataset.
- `Essential` label has no context; maybe change it to `Matching`, or something clearer that ties back to the initial indicator.
- Add a tooltip or small info note for the data screening details.
- Add a tooltip to data preview for explainability.
- `Schema` in the data preview is vague wording.
- Put `How This Dataset Will Be Used` at the top of the information on the dataset detail page.
- The drop-down is hiding its functionality. Change it so it shows something similar to: `Access type: request needed` when selected.
- Make the next step button sticky to the bottom so that it’s always visible.
- Add a progression bar for the fit review loading screen.
- Highlight limitations in the fit review with a color; make it yellow like an analysis note.
- Split the recommended workflow into a numbered list. Make it a separate box and show it as steps.
- Explain what join keys are.
- Make a button for each file that is present in the dataset that links directly to the file in that dataset.
- Don’t hide the file types behind a `+1`; show all of them.
- Add a grouping to the datasets in the fit review.
- Change `export manifest` -> `export summary`.
- Make it clear on the first page what the tool does.
- Provide one command that runs both the backend and frontend together.

Implementation outline:

- Review `InputScreen`, `DatasetResults`, `DatasetDetailPanel`, `DatasetFitReview`, and `FinalOverview` for the affected copy and controls.
- Update dropdown labels and badges to be more descriptive and explicitly tied to access state or indicator matching.
- Add tooltip content for screening, preview, schema, and join-key explanations.
- Move dataset-usage guidance above the rest of the detail content.
- Convert workflow guidance into a numbered step box and visually separate it from summary text.
- Expand loading feedback with a visible progress bar and keep the next-step control pinned to the bottom of the viewport or container.
- Ensure file links render individually when multiple files/resources are present.
- Add a repo-level run command or task that starts both backend and frontend.

Testing:

- Run `pnpm build`.
- Manually verify the first-page copy, dataset detail page order, fit review grouping, loading bar, and sticky next-step button.
- Check that the access label, export summary text, and file links are understandable without extra context.

## Main TODO 8: "Why This Score?" Explanatory Panels On Detail Page

Goal: Replace the generic quality summary and quality screening details on the dataset detail page with a comprehensive explanatory panel that shows which specific criteria contribute to the overall quality score. This makes the scoring transparent while acknowledging that the score is just one perspective on data value.

Suggested product behavior:

- On `DatasetDetailPanel`, replace the current "Quality 80%" summary and "Data Screening" details section with a new "How This Score Is Calculated" panel.
- Show completeness as one of several scoring factors (not the only one).
- Include other factors such as: completeness, documentation quality, schema clarity, update frequency/freshness, and access availability.
- Display each factor with a brief explanation and visual indicator (bar, stars, or badge) showing its contribution.
- Add a disclaimer note such as: "This quality score reflects technical and structural qualities. Consider community trust, domain relevance, data provenance, and qualitative insights when making your final decision."
- Keep the panel concise and scannable; consider collapsible sub-sections for detailed explanations.

Implementation outline:

- In `frontend/src/app/components/DatasetDetailPanel.tsx`, locate the quality/screening display section.
- Create a new component or helper, for example `QualityScoreBreakdown`, that renders the scoring factors.
- Extend `frontend/src/app/types.ts` or use backend response fields to carry individual factor scores (completeness, documentation, etc.).
- If needed, update `backend/app/api_schemas.py` to return a structured quality breakdown in the dataset response.
- Add backend logic in `backend/app/models.py` or similar to compute individual quality factors (if not already present).
- Style the panel with a calm, informational tone (not alarming), perhaps with a soft background or border.

Testing:

- Run `pnpm build`.
- Manually verify that the score breakdown appears on several datasets with different quality levels.
- Confirm that the disclaimer note is readable and sets the right expectations.
- Verify that completeness is shown as one factor, not the only factor.

## Main TODO 9: Dataset Provenance & Type Tags

Goal: Add visible badges and tags to each dataset indicating its origin (source type) and data nature so users recognize that valuable datasets may fall outside typical "high-quality" scoring patterns (e.g., community-generated or qualitative data).

Suggested product behavior:

- Display provenance tags near the dataset title or in the header of `DatasetDetailPanel` and dataset cards in `DatasetResults`.
- Examples of provenance tags:
  - `Official Government`
  - `Community-Generated`
  - `Research Organization`
  - `Participatory Data`
  - `Non-Profit / NGO`
- Examples of data-nature tags:
  - `Quantitative`
  - `Qualitative`
  - `Mixed Methods`
  - `Survey Data`
  - `Crowdsourced`
- Use distinct colors or visual styles to differentiate provenance from data nature.
- Include a small info tooltip on hover explaining what each tag means.

Implementation outline:

- Extend `backend/app/api_schemas.py` with optional fields such as `provenance` (string) and `data_types` (list of strings).
- Update backend dataset models in `backend/app/models.py` to populate these fields from catalog metadata or a new data dictionary.
- Update `frontend/src/app/types.ts` with the new fields.
- In `frontend/src/app/components/DatasetCard.tsx` and `DatasetDetailPanel.tsx`, render the tags as Badges with appropriate styling and tooltips.
- Consider adding a filter option in `DatasetResults` to show/hide datasets by provenance type (integrates with TODO 5 filters).

Testing:

- Run `pnpm build`.
- Manually verify tags appear on dataset cards and detail pages.
- Confirm tooltips display helpful explanations.
- Verify that tags are visually distinct and not cluttered.

## Main TODO 10: "Domain Knowledge Override" Section

Goal: Allow users to add free-form notes or rationales for selecting a dataset despite its quality score, making their critical reasoning and domain knowledge visible in the analysis and supporting more transparent, values-aligned decision-making.

Suggested product behavior:

- On `DatasetFitReview` or the selection page, add a collapsible "Domain Knowledge Notes" section for each selected dataset.
- Allow users to type free-form text explaining why they chose this dataset (e.g., "Local stakeholders trust this source" or "This captures community perspectives missing in official data").
- Save these notes in the app state (and optionally to a session or export).
- Display the notes alongside the dataset in the final overview (`FinalOverview`) and in any exported summary/manifest.
- Keep the notes visible but de-emphasized so they don't overshadow the technical analysis.
- Optionally add preset prompts or suggestions such as:
  - "Why did you include this dataset despite its score?"
  - "What additional context or domain knowledge influenced this choice?"
  - "How does this dataset complement the others?"

Implementation outline:

- Extend `appStore` in `frontend/src/app/store.ts` to track domain-knowledge notes per dataset (e.g., `datasetNotes: Map<datasetId, string>`).
- Add a new component or section in `DatasetResults` or `DatasetFitReview`, for example `DomainKnowledgeNotes`, with a text area and save button.
- Render the notes section collapsibly below each dataset card in the fit review and final overview.
- Update the export/summary output to include these notes so users can see their reasoning in reports.
- Style notes distinctly (e.g., italicized text or a light accent color) to differentiate them from system-generated analysis.

Testing:

- Run `pnpm build`.
- Manually add and edit notes for several datasets.
- Verify notes persist across navigation and appear in the final overview.
- Confirm notes can be exported if an export/summary feature exists.

## Verification Commands

Run these after changes:

```bash
cd backend
../.venv/bin/python scripts/test_contract.py
```

```bash
cd frontend
pnpm build
```

If only `DatasetDetailPanel.tsx` changes and no backend contract changes were made, the frontend build is the essential check.
