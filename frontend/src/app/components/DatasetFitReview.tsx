import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Columns3,
  ExternalLink,
  FileText,
  GitMerge,
  Loader,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { appStore } from "../store";
import { analyzeSelectedDatasetFit } from "../api";
import { Dataset, DatasetFitAnalysis, IndicatorRequest } from "../types";

const FIT_REVIEW_LOADING_STATUSES = [
  "Reading your selected datasets...",
  "Checking available columns and preview rows...",
  "Matching columns to the indicator requirements...",
  "Looking for missing themes and join fields...",
  "Preparing the fit review...",
];
const LOADING_STATUS_ROTATION_MS = 3600;

export function DatasetFitReview() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<IndicatorRequest | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [analysis, setAnalysis] = useState<DatasetFitAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStatusStep, setLoadingStatusStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The fit review is intentionally scoped to the user's selected datasets, so
  // the backend can inspect columns and preview rows without scanning the whole
  // catalog again.
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
    setLoading(true);
    setLoadingStatusStep(0);
    setError(null);

    try {
      const result = await analyzeSelectedDatasetFit({
        indicator_text: currentRequest.description,
        selected_themes: appStore.getExtractedThemes(),
        dataset_ids: selectedDatasets.map((dataset) => dataset.id),
        dataset_snapshots: selectedDatasets,
        parsed_indicator: {
          geographic_level: currentRequest.geographicLevel,
          time_frame: currentRequest.timeFrame,
          population: currentRequest.population,
          attributes: currentRequest.attributes,
        },
        preview_rows: 5,
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
    // Reuse a cached analysis while the indicator and selected datasets are
    // unchanged; any selection edit invalidates it in the shared store.
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
    // Backend insights are keyed by dataset id; this map lets the UI enrich
    // them with the already translated selected dataset snapshot.
    return new Map(datasets.map((dataset) => [dataset.id, dataset]));
  }, [datasets]);

  const sortedInsights = analysis?.datasets || [];
  const loadingStatusIndex = loadingStatusStep % FIT_REVIEW_LOADING_STATUSES.length;
  const currentLoadingMessage = FIT_REVIEW_LOADING_STATUSES[loadingStatusIndex];
  const previousLoadingMessage =
    loadingStatusStep > 0
      ? FIT_REVIEW_LOADING_STATUSES[
          (loadingStatusIndex - 1 + FIT_REVIEW_LOADING_STATUSES.length) %
            FIT_REVIEW_LOADING_STATUSES.length
        ]
      : null;
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
              Selected datasets are checked against the indicator, detected themes,
              available columns, and preview rows.
            </p>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-lg border border-neutral-200 p-8 flex flex-col items-center gap-3">
            <Loader className="w-8 h-8 text-blue-600 animate-spin" />
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
              Selected datasets are checked one by one.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-900">Analysis failed</p>
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
                <p className="text-sm text-neutral-700 mb-4">
                  {formatCrossDatasetSummary(analysis)}
                </p>
                <div className="space-y-3">
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
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
                    Recommended workflow
                  </p>
                  <ListBlock items={analysis.cross_dataset_summary.recommended_workflow} />
                </div>
              </div>
            </div>

            {analysis.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-medium text-amber-900 mb-2">
                  Analysis notes
                </p>
                <ListBlock items={analysis.warnings} tone="amber" />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sortedInsights.map((insight) => {
                const dataset = datasetsById.get(insight.dataset_id);
                const datasetTitle = dataset?.name || insight.title;
                const sourceUrl = getSourceUrl(dataset?.apiUrl || insight.source_url);
                const formats = dataset?.formats?.length ? dataset.formats : insight.formats;

                return (
                  <div
                    key={insight.dataset_id}
                    className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4"
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Badge className={scoreBadgeClass(insight.fit_score)}>
                          {insight.fit_score}% fit
                        </Badge>
                        <Badge variant="outline">
                          {insight.recommended_role}
                        </Badge>
                      </div>
                      <h3 className="font-semibold leading-snug">
                        {datasetTitle}
                      </h3>
                      <p className="text-sm text-neutral-500">{insight.provider}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <Badge variant="secondary" className="gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          {formatDatasetFormats(formats)}
                        </Badge>
                        {sourceUrl && (
                          <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                            <a href={sourceUrl} target="_blank" rel="noreferrer">
                              Source
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <Progress value={insight.fit_score} className={scoreProgressClass(insight.fit_score)} />
                    <p className="text-sm text-neutral-700 mt-3">
                      {formatFitSummary(insight.fit_summary, [datasetTitle, insight.title], insight.recommended_role)}
                    </p>
                  </div>

                  {insight.useful_columns.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Columns3 className="w-4 h-4 text-neutral-500" />
                        <p className="text-sm font-medium text-neutral-700">Useful columns</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {insight.useful_columns.map((column) => (
                          <Badge key={`${insight.dataset_id}-${column.name}`} variant="secondary">
                            {column.name} - {formatRole(column.semantic_role)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <FieldList label="Join keys" items={insight.join_keys} />
                    <FieldList label="Time fields" items={insight.time_fields} />
                  </div>

                  <div className="bg-neutral-50 border border-neutral-200 rounded-md p-3">
                    <p className="text-sm font-medium text-neutral-900 mb-1">Next action</p>
                    <p className="text-sm text-neutral-700">
                      {insight.recommended_next_action}
                    </p>
                  </div>

                  {(insight.limitations.length > 0 || insight.quality_risks.length > 0) && (
                    <div className="space-y-3">
                      <ListPanel title="Limitations" items={insight.limitations} />
                      <ListPanel title="Quality risks" items={insight.quality_risks} />
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          </>
        )}

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
            Re-analyze
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

        <div className="text-center text-sm text-neutral-500">
          Step 4 of 5: Dataset fit review
        </div>
      </div>
    </div>
  );
}

function FieldList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-neutral-500 mb-1">{label}</p>
      <p className="font-medium text-neutral-800">
        {items.length > 0 ? items.slice(0, 3).join(", ") : "Not detected"}
      </p>
    </div>
  );
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="border border-neutral-200 rounded-md p-3">
      <p className="text-sm font-medium text-neutral-900 mb-2">{title}</p>
      <ListBlock items={items} />
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

function scoreBadgeClass(score: number): string {
  if (score >= 75) return "bg-green-600";
  if (score >= 50) return "bg-amber-600";
  return "bg-red-600";
}

function scoreProgressClass(score: number): string {
  if (score >= 75) return "[&_[data-slot=progress-indicator]]:bg-green-600";
  if (score >= 50) return "[&_[data-slot=progress-indicator]]:bg-amber-600";
  return "[&_[data-slot=progress-indicator]]:bg-red-600";
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

  return `${coverageText} These requirements come from the indicator text, selected themes, geography, population, and time frame.`;
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

function getSourceUrl(value?: string): string {
  const url = value?.trim() || "";
  return /^https?:\/\//i.test(url) ? url : "";
}

function formatDatasetFormats(formats?: string[]): string {
  const cleanFormats = Array.from(
    new Set(
      (formats || [])
        .map((format) => format.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (cleanFormats.length === 0) return "Format not listed";
  if (cleanFormats.length <= 3) return cleanFormats.join(", ");
  return `${cleanFormats.slice(0, 3).join(", ")} +${cleanFormats.length - 3}`;
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

function formatRole(role: string): string {
  const labels: Record<string, string> = {
    water: "Water Management",
  };
  if (labels[role]) return labels[role];
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
