import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  GitMerge,
  Loader,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import { Textarea } from "./ui/textarea";
import { appStore } from "../store";
import { analyzeSelectedDatasetFit } from "../api";
import { formatFileTypeLabel, formatFileTypeLabels } from "../fileFormats";
import {
  Dataset,
  DatasetFitAnalysis,
  DatasetFitInsight,
  EdaCheckItem,
  IndicatorRequest,
} from "../types";
import {
  compatibilityBandLabel,
  formatCompatibilityScore,
  getDatasetCompatibilityBand,
  getDatasetCompatibilityScore,
} from "../compatibilityDisplay";
import {
  formatQualityScore,
  getInsightFitBand,
  getInsightFitScore,
  qualityBandLabel,
  qualityScoreClass,
} from "../qualityDisplay";
import { formatThemeName } from "../themeTaxonomy";

const FIT_REVIEW_LOADING_STATUSES = [
  "Reading your selected datasets...",
  "Fetching preview samples from sources when needed...",
  "Checking rows for missing or empty values...",
  "Assessing completeness and column coverage...",
  "Scoring data quality for each dataset...",
  "Preparing the fit review...",
];
const LOADING_STATUS_ROTATION_MS = 3600;
const FIT_REVIEW_PREVIEW_ROWS = 5;

type DatasetNotesState = Record<string, string>;

function filterOperationalWarnings(warnings: string[]): string[] {
  return warnings.filter(
    (warning) => !warning.toLowerCase().includes("limited row preview data")
  );
}

export function DatasetFitReview() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<IndicatorRequest | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [analysis, setAnalysis] = useState<DatasetFitAnalysis | null>(null);
  const [datasetNotes, setDatasetNotes] = useState<DatasetNotesState>({});
  const [loading, setLoading] = useState(false);
  const [loadingStatusStep, setLoadingStatusStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hydrateNotes = (selectedDatasets: Dataset[]) => {
    setDatasetNotes(
      Object.fromEntries(
        selectedDatasets.map((dataset) => [dataset.id, appStore.getDatasetNote(dataset.id)])
      )
    );
  };

  const runAnalysis = useCallback(async () => {
    const currentRequest = appStore.getIndicatorRequest();
    const selectedDatasets = appStore.getSelectedDatasets();

    if (!currentRequest) {
      navigate("/");
      return;
    }
    if (selectedDatasets.length === 0) {
      navigate("/results");
      return;
    }

    setRequest(currentRequest);
    setDatasets(selectedDatasets);
    hydrateNotes(selectedDatasets);
    setLoading(true);
    setLoadingStatusStep(0);
    setError(null);
    appStore.invalidateFitAnalysisCache();

    try {
      const result = await analyzeSelectedDatasetFit({
        indicator_text: currentRequest.description,
        selected_themes: appStore.getExtractedThemes(),
        dataset_ids: selectedDatasets.map((dataset) => dataset.id),
        dataset_snapshots: selectedDatasets.map(toDatasetFitSnapshot),
        parsed_indicator: {
          geographic_level: currentRequest.geographicLevel,
          time_frame: currentRequest.timeFrame,
          population: currentRequest.population,
          attributes: currentRequest.attributes,
        },
        preview_rows: FIT_REVIEW_PREVIEW_ROWS,
      });
      appStore.setDatasetFitAnalysis(result);
      setAnalysis(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to analyze selected datasets";
      setError(message);
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    const currentRequest = appStore.getIndicatorRequest();
    const selectedDatasets = appStore.getSelectedDatasets();
    const cachedAnalysis = appStore.getDatasetFitAnalysis();

    if (!currentRequest) {
      navigate("/");
      return;
    }
    if (selectedDatasets.length === 0) {
      navigate("/results");
      return;
    }

    setRequest(currentRequest);
    setDatasets(selectedDatasets);
    hydrateNotes(selectedDatasets);

    if (cachedAnalysis) {
      setAnalysis(cachedAnalysis);
    } else {
      void runAnalysis();
    }
  }, [navigate, runAnalysis]);

  useEffect(() => {
    if (!loading) return;

    setLoadingStatusStep(0);

    const intervalId = window.setInterval(() => {
      setLoadingStatusStep((statusStep) => statusStep + 1);
    }, LOADING_STATUS_ROTATION_MS);

    return () => window.clearInterval(intervalId);
  }, [loading]);

  const datasetsById = useMemo(() => {
    return new Map(datasets.map((dataset) => [dataset.id, dataset]));
  }, [datasets]);

  const sortedInsights = useMemo(() => {
    const list = analysis?.datasets || [];
    return [...list].sort(
      (left, right) => getInsightFitScore(right) - getInsightFitScore(left)
    );
  }, [analysis]);
  const loadingStatusIndex = loadingStatusStep % FIT_REVIEW_LOADING_STATUSES.length;
  const currentLoadingMessage = FIT_REVIEW_LOADING_STATUSES[loadingStatusIndex];
  const previousLoadingMessage =
    loadingStatusStep > 0
      ? FIT_REVIEW_LOADING_STATUSES[
          (loadingStatusIndex - 1 + FIT_REVIEW_LOADING_STATUSES.length) %
            FIT_REVIEW_LOADING_STATUSES.length
        ]
      : null;
  const loadingProgress = Math.min(95, 12 + loadingStatusStep * 18);

  const handleNoteChange = (datasetId: string, note: string) => {
    setDatasetNotes((current) => ({ ...current, [datasetId]: note }));
    appStore.setDatasetNote(datasetId, note);
  };

  if (!request) return null;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl">Dataset Fit Review</h1>
            </div>
            <p className="text-neutral-600 max-w-3xl">
              Review verification across completeness, consistency, timeliness, resolution,
              coverage, and trustworthiness. Match scores from the previous step are for context
              only. See the note below on what this prototype analyzes.
            </p>
            <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                Planning question
              </p>
              <p className="text-neutral-800">{request.description}</p>
            </div>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-lg border border-neutral-200 p-8 flex flex-col items-center gap-3">
            <Loader className="w-8 h-8 text-blue-600 animate-spin" />
            <div className="w-full max-w-md">
              <Progress value={loadingProgress} />
            </div>
            <div className="loading-status-roll" aria-live="polite" aria-atomic="true">
              <span className="sr-only">{currentLoadingMessage}</span>
              {previousLoadingMessage && (
                <span
                  key={`previous-${loadingStatusStep}`}
                  className="loading-status-roll__item loading-status-roll__item--previous"
                  aria-hidden="true"
                >
                  {previousLoadingMessage}
                </span>
              )}
              <span
                key={`current-${loadingStatusStep}`}
                className="loading-status-roll__item loading-status-roll__item--current"
                aria-hidden="true"
              >
                {currentLoadingMessage}
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Automated checks run per dataset; this is not a manual review.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-900">Fit review failed</p>
              <p className="text-sm text-red-800 mt-1">{error}</p>
            </div>
          </div>
        )}

        {analysis && !loading && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
              <div className="bg-white rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <GitMerge className="w-5 h-5 text-neutral-600" />
                  <h2 className="font-semibold">How These Datasets Work Together</h2>
                </div>
                <p className="text-sm text-neutral-700 mb-3">
                  {formatCrossDatasetSummary(analysis)}
                </p>
                <CrossDatasetSelectionSummary
                  insights={sortedInsights}
                  datasetsById={datasetsById}
                />
                <div className="space-y-2 mt-4">
                  {analysis.cross_dataset_summary.join_strategy.map((item) => (
                    <div key={item} className="flex gap-2 text-sm text-neutral-700">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>{formatJoinStrategyItem(item)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <h2 className="font-semibold">Gaps and Workflow</h2>
                </div>
                <ListBlock items={analysis.cross_dataset_summary.gaps} tone="amber" />
                <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
                    Recommended workflow
                  </p>
                  <OrderedListBlock items={analysis.cross_dataset_summary.recommended_workflow} />
                </div>
              </div>
            </div>

            <PrototypeAnalysisNotice
              previewRows={FIT_REVIEW_PREVIEW_ROWS}
              operationalWarnings={filterOperationalWarnings(analysis.warnings)}
            />

            <DatasetQualityCardGrid
              insights={sortedInsights}
              datasetsById={datasetsById}
              datasetNotes={datasetNotes}
              onNoteChange={handleNoteChange}
            />
          </>
        )}

        <div className="sticky bottom-0 z-20 -mx-6 border-t border-neutral-200 bg-neutral-50/95 p-4 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row">
            <Button
              onClick={() => navigate("/results")}
              variant="outline"
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Datasets
            </Button>
            <Button
              onClick={runAnalysis}
              variant="outline"
              className="gap-2"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Re-run fit review
            </Button>
            <Button
              onClick={() => navigate("/summary")}
              className="flex-1 gap-2"
              disabled={loading || (!analysis && !error)}
            >
              Continue to Final Summary
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="text-center text-sm text-neutral-500">
          Step 4 of 5: Fit review
        </div>
      </div>
    </div>
  );
}


function DatasetQualityCardGrid({
  insights,
  datasetsById,
  datasetNotes,
  onNoteChange,
}: {
  insights: DatasetFitInsight[];
  datasetsById: Map<string, Dataset>;
  datasetNotes: Record<string, string>;
  onNoteChange: (datasetId: string, note: string) => void;
}) {
  if (insights.length === 0) {
    return (
      <p className="text-sm text-neutral-600">No datasets were selected for quality review.</p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {insights.map((insight) => (
        <DatasetQualityReviewCard
          key={insight.dataset_id}
          insight={insight}
          dataset={datasetsById.get(insight.dataset_id)}
          note={datasetNotes[insight.dataset_id] || ""}
          onNoteChange={(value) => onNoteChange(insight.dataset_id, value)}
        />
      ))}
    </div>
  );
}

function DatasetQualityReviewCard({
  insight,
  dataset,
  note,
  onNoteChange,
}: {
  insight: DatasetFitInsight;
  dataset?: Dataset;
  note: string;
  onNoteChange: (value: string) => void;
}) {
  const datasetTitle = dataset?.name || insight.title;
  const edaInterpretation = insight.eda_interpretation;
  const qualityChecks = edaInterpretation?.quality_checks || [];
  const fitScore = getInsightFitScore(insight);
  const fitBand = getInsightFitBand(insight);
  const readinessBand = edaInterpretation?.readiness_band;
  const synthesis = edaInterpretation?.synthesis;
  const formats = dataset?.formats?.length ? dataset.formats : insight.formats;

  return (
    <Card className="shadow-sm">
      <CardContent className="p-5 space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Fit score</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-3xl font-bold leading-none ${qualityScoreClass(fitBand)}`}>
              {formatQualityScore(fitScore)}
            </span>
            <span className="text-sm font-semibold text-neutral-800">{qualityBandLabel(fitBand)}</span>
          </div>
          {readinessBand && (
            <p className="mt-2 text-sm text-neutral-600">{formatReadinessBandLabel(readinessBand)}</p>
          )}
        </div>

        <div>
          <p className="font-semibold text-neutral-900 leading-snug">{datasetTitle}</p>
          <p className="text-xs text-neutral-500">{insight.provider}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {formatDatasetFormats(formats).map((format) => (
            <Badge key={format} variant="secondary" className="gap-1.5 text-[11px]">
              <FileText className="w-3 h-3" />
              {format}
            </Badge>
          ))}
        </div>

        {insight.eda_profile && (
          <p className="text-sm text-neutral-600">{formatSampleScopeDisclaimer(insight.eda_profile)}</p>
        )}

        {synthesis && <p className="text-sm text-neutral-700 leading-relaxed">{synthesis}</p>}

        <QualityCheckCards checks={qualityChecks} />

        {formatMatchContextLine(dataset) && (
          <p className="text-xs text-neutral-500">{formatMatchContextLine(dataset)}</p>
        )}

        <ImplementationDetailsSection insight={insight} edaFit={insight.eda_fit} />

        <DatasetNotesField note={note} onNoteChange={onNoteChange} />
      </CardContent>
    </Card>
  );
}

function formatSampleScopeDisclaimer(profile: DatasetFitInsight["eda_profile"]): string {
  if (!profile) return "Sample scope not reported.";
  if (profile.metadata_only) {
    return "Based on catalog metadata only — not actual row values.";
  }
  const rows = profile.rows_analyzed ?? 0;
  const source = formatPreviewSource(profile.preview_source || "none");
  return `Based on ${rows} row${rows === 1 ? "" : "s"} ${source} — not the full dataset.`;
}

function formatPreviewSource(source: string): string {
  if (source === "catalog_sample") return "from catalog sample";
  if (source === "fetched_resource") return "fetched from source file";
  return "with no row sample";
}

function formatMatchContextLine(dataset: Dataset | undefined): string | null {
  if (dataset && getDatasetCompatibilityScore(dataset) != null) {
    return `Match when selected: ${compatibilityBandLabel(dataset)} · ${formatCompatibilityScore(getDatasetCompatibilityScore(dataset)!)}`;
  }
  return null;
}

function PrototypeAnalysisNotice({
  previewRows,
  operationalWarnings,
}: {
  previewRows: number;
  operationalWarnings: string[];
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">About this prototype</p>
      <p className="mt-2 text-sm text-amber-950/90 leading-relaxed">
        This prototype reviews each selected dataset using catalog metadata and up to{" "}
        <span className="font-medium">{previewRows}</span> sample rows only—not the full file.
        Verification scores reflect what could be checked from that sample. Open the source
        datasets to confirm values, coverage, and freshness before using them in a real indicator.
      </p>
      {operationalWarnings.length > 0 && (
        <div className="mt-4 border-t border-amber-200/80 pt-3">
          <p className="text-sm font-medium text-amber-900 mb-2">Issues during analysis</p>
          <ListBlock items={operationalWarnings} tone="amber" />
        </div>
      )}
    </div>
  );
}

function ImplementationDetailsSection({
  insight,
  edaFit,
}: {
  insight: DatasetFitInsight;
  edaFit?: DatasetFitInsight["eda_fit"];
}) {
  const hasRole = Boolean(insight.recommended_role);
  const hasMapping = Boolean(
    insight.useful_columns.length > 0 ||
      (edaFit?.roles_found?.length ?? 0) > 0 ||
      (edaFit?.roles_missing?.length ?? 0) > 0 ||
      insight.join_keys.length > 0
  );
  if (!hasRole && !hasMapping && !insight.recommended_next_action) return null;

  return (
    <FitDetailCollapsible title="Implementation details">
      {hasRole && (
        <p className="text-sm text-neutral-700">
          <span className="font-medium text-neutral-800">Use as:</span>{" "}
          {formatRecommendedRoleUse(insight.recommended_role)}
        </p>
      )}
      {insight.recommended_next_action && (
        <p className="text-sm text-neutral-600">
          <span className="font-medium text-neutral-800">Next:</span> {insight.recommended_next_action}
        </p>
      )}
      <FitIndicatorFieldMapping insight={insight} edaFit={edaFit} />
    </FitDetailCollapsible>
  );
}

function FitDetailCollapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="rounded-md border border-neutral-200 bg-white group"
      open={defaultOpen || undefined}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-neutral-800 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-neutral-100 px-3 pb-3 pt-3">{children}</div>
    </details>
  );
}

function FitIndicatorFieldMapping({
  insight,
  edaFit,
}: {
  insight: DatasetFitInsight;
  edaFit?: DatasetFitInsight["eda_fit"];
}) {
  const categoriesFound = (edaFit?.roles_found || []).map(formatThemeName);
  const categoriesMissing = (edaFit?.roles_missing || []).map(formatThemeName);
  const joinKeys = edaFit?.join_keys?.length ? edaFit.join_keys : insight.join_keys;
  const timeFields = edaFit?.time_fields?.length ? edaFit.time_fields : insight.time_fields;
  const geoFields = edaFit?.geo_fields?.length ? edaFit.geo_fields : insight.geo_fields;

  const hasContent =
    insight.useful_columns.length > 0 ||
    categoriesFound.length > 0 ||
    categoriesMissing.length > 0 ||
    joinKeys.length > 0 ||
    timeFields.length > 0 ||
    geoFields.length > 0;

  if (!hasContent) return null;

  return (
    <FitDetailCollapsible title="Columns you can use">
      {insight.useful_columns.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-500">Useful columns</p>
          <div className="flex flex-wrap gap-1.5">
            {insight.useful_columns.map((column) => (
              <Badge key={`${insight.dataset_id}-${column.name}`} variant="secondary" className="font-normal">
                {column.name} · {formatRole(column.semantic_role)}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <FieldList label="Categories found" items={categoriesFound} />
        <FieldList label="Categories missing" items={categoriesMissing} />
        <FieldList
          label="Join keys"
          items={joinKeys}
          description="Shared fields that can link this dataset to others."
        />
        <FieldList label="Time fields" items={timeFields} />
        <FieldList label="Geo fields" items={geoFields} />
      </div>
    </FitDetailCollapsible>
  );
}


function qualityCheckCardClass(status: string): string {
  const base = "rounded-lg border bg-white p-3 shadow-sm";
  if (status === "good") return `${base} border-emerald-200`;
  if (status === "caution") return `${base} border-amber-200`;
  if (status === "check") return `${base} border-blue-200`;
  return `${base} border-neutral-200`;
}

function QualityCheckCard({ check }: { check: EdaCheckItem }) {
  return (
    <article className={qualityCheckCardClass(check.status)}>
      <Badge variant="outline" className={`${edaCheckStatusClass(check.status)} font-normal`}>
        {formatEdaCheckStatus(check.status)}
      </Badge>
      <p className="mt-2 text-sm text-neutral-700 leading-relaxed">{check.message}</p>
    </article>
  );
}

function QualityCheckCards({ checks }: { checks: EdaCheckItem[] }) {
  if (checks.length === 0) {
    return <p className="text-sm text-neutral-500">No quality checks were run.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {checks.map((check) => (
        <QualityCheckCard key={`${check.id}-${check.message}`} check={check} />
      ))}
    </div>
  );
}

function DatasetNotesField({
  note,
  onNoteChange,
}: {
  note: string;
  onNoteChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2 pt-1">
      <p className="text-sm font-semibold text-neutral-900">Notes</p>
      <p className="text-xs text-neutral-500">
        Add local context, stakeholder trust, or reasons to include this dataset despite its score.
      </p>
      <Textarea
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Why did you include this dataset? What local context affects your decision?"
        className="min-h-24 resize-y bg-white border-neutral-200"
      />
    </div>
  );
}


function formatEdaCheckStatus(status: string): string {
  if (status === "good") return "Good";
  if (status === "caution") return "Caution";
  if (status === "check") return "Check";
  return "Unknown";
}

function edaCheckStatusClass(status: string): string {
  if (status === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "caution") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "check") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-neutral-200 bg-white text-neutral-700";
}

function formatReadinessBandLabel(band?: string): string {
  if (!band) return "Not assessed";
  if (band === "ready_for_exploration") return "Ready to explore";
  if (band === "usable_with_checks") return "Usable, check details";
  if (band === "metadata_only_review") return "Catalog only — open the file";
  return band.replace(/_/g, " ");
}

function scoreTextClass(score: number): string {
  if (score >= 75) return "text-emerald-700";
  if (score >= 50) return "text-amber-700";
  return "text-red-700";
}

function topProfileIssue(insight: DatasetFitInsight): string | null {
  const score = getInsightFitScore(insight);
  const band = getInsightFitBand(insight);
  const checks = insight.eda_interpretation?.quality_checks || [];
  const caution = checks.find((check) => check.status === "caution");
  if (caution) {
    const message = caution.message;
    const trimmed = message.length > 40 ? `${message.slice(0, 37)}…` : message;
    return `F${score} · ${trimmed}`;
  }
  if (band === "limited") return `F${score} · limited fit`;
  if (band === "usable") return `F${score} · usable fit`;
  return `F${score}`;
}

function shortReadinessLabel(band?: string): string {
  if (band === "ready_for_exploration") return "Ready";
  if (band === "usable_with_checks") return "Check";
  if (band === "metadata_only_review") return "Catalog";
  return "Review";
}

function matchBandForInsight(insight: DatasetFitInsight, dataset?: Dataset): "strong" | "partial" | "weak" {
  if (dataset) return getDatasetCompatibilityBand(dataset);
  if (insight.fit_score >= 75) return "strong";
  if (insight.fit_score >= 50) return "partial";
  return "weak";
}

function CrossDatasetSelectionSummary({
  insights,
  datasetsById,
}: {
  insights: DatasetFitInsight[];
  datasetsById: Map<string, Dataset>;
}) {
  if (insights.length === 0) return null;

  const matchCounts = { strong: 0, partial: 0, weak: 0 };
  const readinessCounts = { ready: 0, check: 0, metadata: 0, other: 0 };

  for (const insight of insights) {
    const dataset = datasetsById.get(insight.dataset_id);
    matchCounts[matchBandForInsight(insight, dataset)] += 1;
    const band = insight.eda_interpretation?.readiness_band;
    if (band === "ready_for_exploration") readinessCounts.ready += 1;
    else if (band === "usable_with_checks") readinessCounts.check += 1;
    else if (band === "metadata_only_review") readinessCounts.metadata += 1;
    else readinessCounts.other += 1;
  }

  const matchParts = [
    matchCounts.strong > 0 ? `${matchCounts.strong} strong` : null,
    matchCounts.partial > 0 ? `${matchCounts.partial} partial` : null,
    matchCounts.weak > 0 ? `${matchCounts.weak} weak` : null,
  ].filter(Boolean);

  const readinessParts = [
    readinessCounts.ready > 0 ? `${readinessCounts.ready} ready` : null,
    readinessCounts.check > 0 ? `${readinessCounts.check} need checks` : null,
    readinessCounts.metadata > 0 ? `${readinessCounts.metadata} metadata-only` : null,
    readinessCounts.other > 0 ? `${readinessCounts.other} to review` : null,
  ].filter(Boolean);

  const showChips = insights.length <= 4;

  return (
    <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5">
      <p className="text-sm text-neutral-700">
        <span className="font-medium">
          {insights.length} dataset{insights.length === 1 ? "" : "s"}
        </span>
        {matchParts.length > 0 && (
          <>
            {" · "}
            {matchParts.join(", ")} match
          </>
        )}
        {readinessParts.length > 0 && (
          <>
            {" · "}
            {readinessParts.join(", ")}
          </>
        )}
      </p>
      {showChips && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {insights.map((insight) => {
            const dataset = datasetsById.get(insight.dataset_id);
            const title = dataset?.name || insight.title;
            const shortTitle = title.length > 36 ? `${title.slice(0, 33)}…` : title;
            const profileIssue = topProfileIssue(insight);
            const chipTitle = profileIssue ? `${title} — ${profileIssue}` : title;
            return (
              <Badge
                key={insight.dataset_id}
                variant="secondary"
                className="max-w-full truncate text-[11px] font-normal"
                title={chipTitle}
              >
                {shortTitle} · {shortReadinessLabel(insight.eda_interpretation?.readiness_band)}
                {profileIssue ? ` · ${profileIssue.length > 40 ? `${profileIssue.slice(0, 37)}…` : profileIssue}` : ""}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FieldList({
  label,
  items,
  description,
}: {
  label: string;
  items: string[];
  description?: string;
}) {
  return (
    <div>
      <p className="text-neutral-500">{label}</p>
      {description && <p className="text-xs text-neutral-400">{description}</p>}
      <p className="font-medium text-neutral-800">
        {items.length > 0 ? items.slice(0, 3).join(", ") : "Not detected"}
      </p>
    </div>
  );
}

function ListPanel({
  title,
  items,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  tone?: "neutral" | "amber";
}) {
  if (items.length === 0) return null;
  const panelClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : "border-neutral-200 bg-white";
  const titleClass = tone === "amber" ? "text-amber-900" : "text-neutral-900";
  return (
    <div className={`border rounded-md p-3 ${panelClass}`}>
      <p className={`text-sm font-medium mb-2 ${titleClass}`}>{title}</p>
      <ListBlock items={items} tone={tone} />
    </div>
  );
}

function ListBlock({ items, tone = "neutral" }: { items: string[]; tone?: "neutral" | "amber" }) {
  const textClass = tone === "amber" ? "text-amber-800" : "text-neutral-700";
  return (
    <ul className={`space-y-1 text-sm ${textClass}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current flex-shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function OrderedListBlock({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-600">No workflow steps were generated.</p>;
  }
  return (
    <ol className="space-y-2 text-sm text-neutral-700">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-medium text-white">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function toDatasetFitSnapshot(dataset: Dataset) {
  return {
    id: dataset.id,
    name: dataset.name,
    provider: dataset.provider,
    source: dataset.source,
    apiUrl: dataset.apiUrl,
    formats: dataset.formats || [],
    theme: dataset.theme,
    themes: dataset.themes || [],
    matchingThemes: dataset.matchingThemes || [],
    category: dataset.category,
    categories: dataset.categories || [],
    categoryConfidence: dataset.categoryConfidence,
    categoryMethod: dataset.categoryMethod,
    schemaFields: dataset.schemaFields || [],
    spatialCoverage: dataset.spatialCoverage,
    spatialResolution: dataset.spatialResolution,
    updateFrequency: dataset.updateFrequency,
    lastUpdate: dataset.lastUpdate,
    accessType: dataset.accessType,
    quality: dataset.quality,
    description: dataset.description,
    usageExplanation: dataset.usageExplanation,
  };
}

function formatCrossDatasetSummary(analysis: DatasetFitAnalysis): string {
  const summary = analysis.cross_dataset_summary.summary.trim();
  const oldCoverageMatch = /^The selected datasets cover (\d+) of (\d+) detected requirement areas\./i.exec(summary);

  if (!oldCoverageMatch) return summary;

  const requirementLabels = extractRequirementLabels(analysis);
  const covered = Number(oldCoverageMatch[1]);
  const total = Number(oldCoverageMatch[2]);
  const coverageText = covered === total
    ? `All ${total} are represented by the selected datasets.`
    : `${covered} of ${total} are represented by the selected datasets.`;

  if (requirementLabels.length > 0) {
    return `Detected requirements: ${formatSentenceList(requirementLabels)}. ${coverageText}`;
  }

  return `${coverageText} These requirements come from the planning question, selected themes, geography, population, and time frame.`;
}

function extractRequirementLabels(analysis: DatasetFitAnalysis): string[] {
  const labels = new Set<string>();
  const roleOrder = [
    "accessibility",
    "air_quality",
    "geography",
    "geometry",
    "green_space",
    "water",
    "heat",
    "land_use",
    "population",
    "socioeconomic",
    "time",
    "transport",
  ];

  analysis.datasets.forEach((insight) => {
    insight.useful_columns.forEach((column) => {
      if (roleOrder.includes(column.semantic_role)) {
        labels.add(formatRole(column.semantic_role).toLowerCase());
      }
    });
  });

  analysis.cross_dataset_summary.gaps.forEach((gap) => {
    const normalized = gap.replace(/^Missing\s+/i, "").trim();
    if (normalized && !/no major requirement gaps/i.test(normalized)) {
      labels.add(normalized.toLowerCase());
    }
  });

  return Array.from(labels).sort((a, b) => {
    const aIndex = roleOrder.indexOf(a.replace(/\s+/g, "_"));
    const bIndex = roleOrder.indexOf(b.replace(/\s+/g, "_"));
    if (aIndex === -1 || bIndex === -1) return a.localeCompare(b);
    return aIndex - bIndex;
  });
}

function formatJoinStrategyItem(item: string): string {
  const trimmed = item.trim();
  const oldGeoMatch = /^Use shared geographic fields where possible/i.test(trimmed);
  if (oldGeoMatch) {
    return "Several selected datasets include geographic fields, so they can be compared once they are matched to the same reporting geography.";
  }

  const oldTimeMatch = /^Align records to (.+?) using .+\.?$/i.exec(trimmed);
  if (oldTimeMatch) {
    return `Temporal fields are present, which supports comparison for ${oldTimeMatch[1]} after date definitions are checked.`;
  }

  return trimmed;
}

function formatSentenceList(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatDatasetFormats(formats?: string[]): string[] {
  const cleanFormats = formatFileTypeLabels(formats || []);

  return cleanFormats.length ? cleanFormats : ["FORMAT NOT LISTED"];
}

function formatFitSummary(summary: string, datasetTitles: string[], recommendedRole: string): string {
  let text = summary.trim();

  for (const title of datasetTitles) {
    const cleanTitle = title.trim();
    if (!cleanTitle) continue;
    text = text.replace(new RegExp(`^${escapeRegExp(cleanTitle)}\\s+`, "i"), "");
  }

  text = stripRepeatedRole(text, recommendedRole);

  const usefulMatch = text.match(/^(?:is useful as|useful as)\s+(.+?)\s+because it contains\s+(.+?)\.?$/i);
  if (usefulMatch) {
    return `${capitalizeFirst(usefulMatch[1])}. Contains ${usefulMatch[2]}.`;
  }

  if (/^has weak direct evidence/i.test(text)) {
    return text.replace(/^has/i, "Has");
  }

  return text;
}

function stripRepeatedRole(summary: string, recommendedRole: string): string {
  const role = recommendedRole.trim();
  if (!role) return summary;
  return summary.replace(new RegExp(`^${escapeRegExp(role)}\\.?:?\\s*`, "i"), "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRecommendedRoleUse(role: string): string {
  const normalized = role.toLowerCase();
  if (!role.trim()) return "a supporting dataset to inspect alongside the stronger matches.";
  if (normalized.includes("not recommended")) return "not recommended for this planning question.";
  if (normalized.includes("green space")) {
    return "the green-space numerator, providing the park or green-area value you would measure.";
  }
  if (normalized.includes("denominator") || normalized.includes("population")) {
    return "the resident-count denominator, so the measure can be calculated per resident.";
  }
  if (normalized.includes("environmental") || normalized.includes("air quality")) {
    return "the LEZ or air-quality context layer, used to filter or compare the result.";
  }
  if (normalized.includes("geographic")) {
    return "the join geography, helping align datasets to the same districts or boundaries.";
  }
  if (normalized.includes("access") || normalized.includes("mobility")) {
    return "the access or mobility measure for travel, proximity, or network coverage.";
  }
  if (normalized.includes("heat") || normalized.includes("temperature")) {
    return "the heat context layer for temperature or exposure comparisons.";
  }
  if (normalized.includes("land use")) return "land-use context for interpreting the pattern.";
  if (normalized.includes("equity") || normalized.includes("socioeconomic")) {
    return "equity or socioeconomic context for comparing who is affected.";
  }
  if (normalized.includes("water")) return "water-management context for the analysis.";
  return role;
}

function formatRole(role: string): string {
  const labels: Record<string, string> = {
    water: "Water Management",
  };
  if (labels[role]) return labels[role];
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
