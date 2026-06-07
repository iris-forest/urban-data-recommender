import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { 
  ArrowLeft, 
  Download, 
  AlertTriangle, 
  CheckCircle2,
  GitMerge,
  Home
} from "lucide-react";
import { appStore } from "../store";
import { IndicatorRequest, Dataset, DatasetFitAnalysis, DatasetNotes } from "../types";
import { createDatasetPackage } from "../api";
import { formatFileTypeLabels } from "../fileFormats";
import {
  hasCompletenessRisk,
  hasFreshnessRisk,
} from "../qualityDisplay";
import { formatGeographicLevel } from "../geographyDisplay";
import { formatThemeName, getDatasetCategoryDisplay } from "../themeTaxonomy";

const SUMMARY_LIST_LIMIT = 4;

export function FinalOverview() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<IndicatorRequest | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [fitAnalysis, setFitAnalysis] = useState<DatasetFitAnalysis | null>(null);
  const [datasetNotes, setDatasetNotes] = useState<DatasetNotes>({});
  const [showAllSelectedDatasets, setShowAllSelectedDatasets] = useState(false);
  const [showAllQualityInsights, setShowAllQualityInsights] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    // The summary is a read-only view of the current workflow state. If the
    // user lands here without a completed selection, restart at the input step.
    const indicatorRequest = appStore.getIndicatorRequest();
    const selectedDatasets = appStore.getSelectedDatasets();

    if (!indicatorRequest || selectedDatasets.length === 0) {
      navigate("/");
      return;
    }

    setRequest(indicatorRequest);
    setDatasets(selectedDatasets);
    setFitAnalysis(appStore.getDatasetFitAnalysis());
    setDatasetNotes(appStore.getDatasetNotes());
  }, [navigate]);

  const handleStartNew = () => {
    appStore.reset();
    navigate("/");
  };

  const handleExport = () => {
    if (datasets.length === 0) return;
    setExporting(true);
    setDownloadError(null);
    try {
      const summaryWindow = window.open("", "_blank");
      if (!summaryWindow) {
        throw new Error("Could not open the PDF summary window. Allow popups and try again.");
      }

      summaryWindow.opener = null;
      summaryWindow.document.write(
        buildPrintableSummaryHtml({
          request,
          datasets,
          fitAnalysis,
          datasetNotes,
          qualityInsights,
          workflowRecommendations,
          hasQualityWarnings,
          hasAccessRestrictions,
        })
      );
      summaryWindow.document.close();
      summaryWindow.focus();
      summaryWindow.setTimeout(() => {
        summaryWindow.print();
      }, 250);

      toast.success("PDF summary ready", {
        description: "Use the print dialog to save the summary as a PDF.",
      });
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      setDownloadError(errorMsg);
      toast.error("Export failed", {
        description: errorMsg,
      });
    } finally {
      window.setTimeout(() => setExporting(false), 300);
    }
  };

  const handleDownloadPackage = async () => {
    // Package generation is backend-owned because imported/API-backed dataset
    // metadata needs to be resolved against the active catalog.
    if (datasets.length === 0) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const datasetIds = datasets.map((d) => d.id);
      const blob = await createDatasetPackage({
        dataset_ids: datasetIds,
        dataset_notes: appStore.getDatasetNotes(),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `datasets-package-${new Date().toISOString()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Package downloaded with ${datasetIds.length} dataset(s)`, {
        description: "The ZIP includes a manifest, docs, and source files when available.",
      });
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error("Package download failed", err);
      setDownloadError(errorMsg);
      toast.error("Download failed", {
        description: errorMsg,
      });
    } finally {
      setDownloading(false);
    }
  };

  if (!request || datasets.length === 0) return null;

  const displayedDatasets = showAllSelectedDatasets
    ? datasets
    : datasets.slice(0, SUMMARY_LIST_LIMIT);
  const displayedEssentialDatasets = displayedDatasets.filter(d => d.essential);
  const displayedOptionalDatasets = displayedDatasets.filter(d => !d.essential);
  const hasQualityWarnings = datasets.some(
    d => hasCompletenessRisk(d.quality.completeness) ||
        hasFreshnessRisk(d.quality.timeliness) ||
        d.quality.consistency === "low"
  );
  const hasAccessRestrictions = datasets.some(
    d => d.accessType !== "open"
  );
  const qualityInsights = [...(fitAnalysis?.datasets || [])].sort(
    compareReviewInsights
  );
  const displayedQualityInsights = showAllQualityInsights
    ? qualityInsights
    : qualityInsights.slice(0, SUMMARY_LIST_LIMIT);
  const workflowRecommendations =
    fitAnalysis?.cross_dataset_summary.recommended_workflow.length
      ? fitAnalysis.cross_dataset_summary.recommended_workflow
      : [
          "Verify spatial alignment between population and transport datasets",
          "Document any data preprocessing steps for reproducibility",
          "Consider temporal alignment when combining datasets from different update cycles",
          "Validate results against known reference neighborhoods",
        ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
            <h1 className="text-2xl">Dataset Selection Complete</h1>
          </div>
          <p className="text-neutral-600">
            Review your planning question and selected datasets before proceeding
            with analysis.
          </p>
        </div>

        {/* Original Planning Question */}
        <Card>
          <CardHeader>
            <CardTitle>Your Planning Question</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-blue-900 italic mb-4">"{request.description}"</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-blue-600">Geographic Level:</span>
                  <span className="ml-2 font-medium text-blue-900">
                    {formatGeographicLevel(request.geographicLevel)}
                  </span>
                </div>
                <div>
                  <span className="text-blue-600">Time Frame:</span>
                  <span className="ml-2 font-medium text-blue-900">
                    {request.timeFrame}
                  </span>
                </div>
                <div>
                  <span className="text-blue-600">Population:</span>
                  <span className="ml-2 font-medium text-blue-900">
                    {request.population}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Selected Datasets */}
        <Card>
          <CardHeader>
            <CardTitle>Selected Datasets ({datasets.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Essential Datasets */}
            {displayedEssentialDatasets.length > 0 && (
              <div>
                <div className="space-y-2">
                  {displayedEssentialDatasets.map(dataset => (
                    <div
                      key={dataset.id}
                      className="border border-neutral-200 rounded-lg p-3 bg-white"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-medium">{dataset.name}</h4>
                          <p className="text-sm text-neutral-500">
                            {dataset.provider} - {formatDatasetCategorySummary(dataset)}
                          </p>
                        </div>
                      </div>
                      <DatasetMetadataLine dataset={dataset} note={datasetNotes[dataset.id]} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional Datasets */}
            {displayedOptionalDatasets.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-neutral-600 mb-2">
                  Optional / Supplementary Datasets
                </h3>
                <div className="space-y-2">
                  {displayedOptionalDatasets.map(dataset => (
                    <div
                      key={dataset.id}
                      className="border border-neutral-200 rounded-lg p-3 bg-white"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-medium">{dataset.name}</h4>
                          <p className="text-sm text-neutral-500">
                            {dataset.provider} - {formatDatasetCategorySummary(dataset)}
                          </p>
                        </div>
                        <Badge variant="outline">Optional</Badge>
                      </div>
                      <DatasetMetadataLine dataset={dataset} note={datasetNotes[dataset.id]} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {datasets.length > SUMMARY_LIST_LIMIT && (
              <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
                <p className="text-sm text-neutral-500">
                  Showing {displayedDatasets.length} of {datasets.length} selected datasets
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAllSelectedDatasets((current) => !current)}
                >
                  {showAllSelectedDatasets ? "Show fewer" : `Show all ${datasets.length}`}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Data Quality Analysis */}
        {fitAnalysis && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitMerge className="w-5 h-5 text-blue-600" />
                Data Quality Review
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
                <p className="text-sm text-neutral-700">
                  Selected datasets were checked for analysis usability, preview quality, and data gaps. {fitAnalysis.cross_dataset_summary.summary}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {displayedQualityInsights.map((insight) => (
                  <div
                    key={insight.dataset_id}
                    className="border border-neutral-200 rounded-lg p-3 bg-white"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h4 className="font-medium leading-snug">{insight.title}</h4>
                        <p className="text-sm text-neutral-600">
                          <span className="font-medium">Suggested analysis role:</span>{" "}
                          {formatRecommendedRoleUse(insight.recommended_role)}
                        </p>
                      </div>
                      <Badge variant="outline" className={reviewBadgeClass(insight.eda_interpretation?.readiness_band)}>
                        {formatQualityStatusLabel(insight.eda_interpretation?.readiness_band)}
                      </Badge>
                    </div>
                    <p className="text-xs font-medium text-neutral-600 mb-2">
                      {formatReviewActionSummary(insight)}
                    </p>
                    <p className="text-sm text-neutral-700 mb-2">
                      {formatQualitySummaryForFinal(insight)}
                    </p>
                    <div className="text-xs text-neutral-600 space-y-1">
                      <p>
                        <span className="font-medium">Join keys:</span>{" "}
                        {insight.join_keys.length ? insight.join_keys.slice(0, 3).join(", ") : "Not detected"}
                      </p>
                      <p>
                        <span className="font-medium">Useful fields:</span>{" "}
                        {insight.useful_columns.length
                          ? insight.useful_columns
                              .slice(0, 3)
                              .map((column) => `${column.name} (${formatRoleForSummary(column.semantic_role)})`)
                              .join(", ")
                          : "Not detected"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {qualityInsights.length > SUMMARY_LIST_LIMIT && (
                <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
                  <p className="text-sm text-neutral-500">
                    Showing {displayedQualityInsights.length} of {qualityInsights.length} data quality results
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAllQualityInsights((current) => !current)}
                  >
                    {showAllQualityInsights ? "Show fewer" : `Show all ${qualityInsights.length}`}
                  </Button>
                </div>
              )}

              {fitAnalysis.cross_dataset_summary.gaps.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-amber-900 mb-1">
                    Remaining gaps
                  </p>
                  <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
                    {fitAnalysis.cross_dataset_summary.gaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Data Gaps and Risks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Data Considerations and Risks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasQualityWarnings && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-900 mb-1">
                  Quality Considerations
                </p>
                <p className="text-sm text-amber-800">
                  Some datasets have limited coverage, stale source data, or low consistency.
                  This may affect the accuracy of your planning measure. Consider validating
                  results with additional sources or local knowledge.
                </p>
              </div>
            )}

            {hasAccessRestrictions && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-900 mb-1">
                  Access Restrictions
                </p>
                <p className="text-sm text-blue-800">
                  Some selected datasets require special access permissions or formal
                  requests. Plan additional time for data acquisition before analysis.
                </p>
              </div>
            )}

            <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3">
              <p className="text-sm font-medium text-neutral-900 mb-1">
                Recommendations
              </p>
              <ul className="text-sm text-neutral-700 space-y-1 list-disc list-inside">
                {workflowRecommendations.map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="space-y-3">
          {downloadError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">Download Error</p>
                <p className="text-sm text-red-800">{downloadError}</p>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <Button
              onClick={() => navigate("/dataset-fit")}
              variant="outline"
              className="gap-2"
              aria-label="Go back to data quality review"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Data Quality Review
            </Button>
            <Button
              onClick={handleExport}
              variant="outline"
              className="gap-2"
              disabled={exporting}
              aria-label="Export selected dataset summary as a PDF"
              aria-busy={exporting}
            >
              <Download className="w-4 h-4" />
              {exporting ? "Preparing PDF…" : "Export PDF Summary"}
            </Button>
            <Button
              onClick={handleDownloadPackage}
              variant="default"
              className="gap-2"
              disabled={downloading}
              aria-label={downloading ? "Preparing package download" : "Download selected datasets package"}
              aria-busy={downloading}
            >
              <Download className="w-4 h-4" />
              {downloading ? "Preparing package…" : "Download Data Package"}
            </Button>
            <Button
              onClick={handleStartNew}
              className="flex-1 gap-2"
              aria-label="Start a new planning question"
            >
              <Home className="w-4 h-4" />
              Start New Planning Question
            </Button>
          </div>
        </div>

        <div className="text-center text-sm text-neutral-500">
          Step 5 of 5: Final summary and export
        </div>
      </div>
    </div>
  );
}

type PrintableSummaryInput = {
  request: IndicatorRequest | null;
  datasets: Dataset[];
  fitAnalysis: DatasetFitAnalysis | null;
  datasetNotes: DatasetNotes;
  qualityInsights: DatasetFitAnalysis["datasets"];
  workflowRecommendations: string[];
  hasQualityWarnings: boolean;
  hasAccessRestrictions: boolean;
};

function buildPrintableSummaryHtml({
  request,
  datasets,
  fitAnalysis,
  datasetNotes,
  qualityInsights,
  workflowRecommendations,
  hasQualityWarnings,
  hasAccessRestrictions,
}: PrintableSummaryInput): string {
  const generatedAt = new Date().toLocaleString();
  const essentialDatasets = datasets.filter((dataset) => dataset.essential);
  const optionalDatasets = datasets.filter((dataset) => !dataset.essential);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Urban Data Recommender Summary</title>
    <style>
      @page { margin: 18mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #171717;
        background: #ffffff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        line-height: 1.5;
      }
      main { max-width: 820px; margin: 0 auto; padding: 24px; }
      h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.15; }
      h2 { margin: 0 0 12px; font-size: 17px; }
      h3 { margin: 0 0 4px; font-size: 13px; }
      p { margin: 0 0 8px; }
      ul { margin: 6px 0 0; padding-left: 18px; }
      li { margin: 2px 0; }
      .muted { color: #737373; }
      .section { border-top: 1px solid #d4d4d4; margin-top: 20px; padding-top: 16px; }
      .card {
        border: 1px solid #d4d4d4;
        border-radius: 8px;
        padding: 12px;
        margin: 10px 0;
        break-inside: avoid;
      }
      .question {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        border-radius: 8px;
        padding: 12px;
      }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
      .badge {
        display: inline-block;
        border: 1px solid #d4d4d4;
        border-radius: 999px;
        padding: 2px 7px;
        margin: 3px 4px 0 0;
        font-size: 10px;
        color: #404040;
      }
      .note {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        border-radius: 6px;
        padding: 8px;
        color: #1e3a8a;
      }
      .warning {
        border: 1px solid #fcd34d;
        background: #fffbeb;
        border-radius: 8px;
        padding: 10px;
        margin-top: 8px;
      }
      .screen-note {
        margin-bottom: 16px;
        padding: 10px;
        border: 1px solid #d4d4d4;
        border-radius: 8px;
        background: #f5f5f5;
      }
      @media print {
        main { padding: 0; }
        .screen-note { display: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="screen-note">Use your browser print dialog to save this summary as a PDF.</div>
      <header>
        <h1>Dataset Selection Summary</h1>
        <p class="muted">Generated ${escapeHtml(generatedAt)}</p>
      </header>

      <section class="section">
        <h2>Planning Question</h2>
        <div class="question">
          <p><strong>${escapeHtml(request?.description || "No planning question recorded.")}</strong></p>
          <div class="grid">
            <p><span class="muted">Geographic level:</span> ${escapeHtml(formatGeographicLevel(request?.geographicLevel || ""))}</p>
            <p><span class="muted">Time frame:</span> ${escapeHtml(request?.timeFrame || "Not specified")}</p>
            <p><span class="muted">Population:</span> ${escapeHtml(request?.population || "Not specified")}</p>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Selected Datasets (${datasets.length})</h2>
        ${renderPrintableDatasetGroup("Recommended for analysis", essentialDatasets, datasetNotes)}
        ${renderPrintableDatasetGroup("Optional / supplementary datasets", optionalDatasets, datasetNotes)}
      </section>

      ${fitAnalysis ? renderPrintableQualitySection(fitAnalysis, qualityInsights) : ""}

      <section class="section">
        <h2>Data Considerations and Risks</h2>
        ${hasQualityWarnings ? `<div class="warning"><h3>Quality considerations</h3><p>Some datasets have limited coverage, stale source data, or low consistency. Validate results with additional sources or local knowledge.</p></div>` : ""}
        ${hasAccessRestrictions ? `<div class="warning"><h3>Access restrictions</h3><p>Some selected datasets require special access permissions or formal requests. Plan additional time for acquisition before analysis.</p></div>` : ""}
        <div class="card">
          <h3>Recommendations</h3>
          ${renderPrintableList(workflowRecommendations, "No recommendations recorded.")}
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderPrintableDatasetGroup(title: string, datasets: Dataset[], datasetNotes: DatasetNotes): string {
  if (!datasets.length) return "";
  return `
    <h3>${escapeHtml(title)}</h3>
    ${datasets
      .map((dataset) => {
        const badges = [
          ...(dataset.dataTypes || []),
          ...formatFileTypeLabels(dataset.formats || []),
        ].filter(Boolean);
        const note = datasetNotes[dataset.id]?.trim();
        return `
          <article class="card">
            <h3>${escapeHtml(dataset.name)}</h3>
            <p class="muted">${escapeHtml(dataset.provider)} - ${escapeHtml(formatDatasetCategorySummary(dataset))}</p>
            ${badges.length ? `<p>${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</p>` : ""}
            ${note ? `<p class="note"><strong>Domain note:</strong> ${escapeHtml(note)}</p>` : ""}
          </article>
        `;
      })
      .join("")}
  `;
}

function renderPrintableQualitySection(
  fitAnalysis: DatasetFitAnalysis,
  qualityInsights: DatasetFitAnalysis["datasets"]
): string {
  return `
    <section class="section">
      <h2>Data Quality Review</h2>
      <div class="card">
        <p>${escapeHtml(fitAnalysis.cross_dataset_summary.summary)}</p>
      </div>
      ${qualityInsights
        .map((insight) => {
          const usefulFields = insight.useful_columns
            .slice(0, 5)
            .map((column) => `${column.name} (${formatRoleForSummary(column.semantic_role)})`);
          return `
            <article class="card">
              <h3>${escapeHtml(insight.title)}</h3>
              <p><strong>Review status:</strong> ${escapeHtml(formatQualityStatusLabel(insight.eda_interpretation?.readiness_band))}</p>
              <p>${escapeHtml(formatReviewActionSummary(insight))}</p>
              <p><strong>Suggested analysis role:</strong> ${escapeHtml(formatRecommendedRoleUse(insight.recommended_role))}</p>
              <p>${escapeHtml(formatQualitySummaryForFinal(insight))}</p>
              <p><strong>Join keys:</strong> ${escapeHtml(insight.join_keys.length ? insight.join_keys.slice(0, 5).join(", ") : "Not detected")}</p>
              <p><strong>Useful fields:</strong> ${escapeHtml(usefulFields.length ? usefulFields.join(", ") : "Not detected")}</p>
            </article>
          `;
        })
        .join("")}
      ${
        fitAnalysis.cross_dataset_summary.gaps.length
          ? `<div class="warning"><h3>Remaining gaps</h3>${renderPrintableList(fitAnalysis.cross_dataset_summary.gaps, "No gaps recorded.")}</div>`
          : ""
      }
    </section>
  `;
}

function renderPrintableList(items: string[], fallback: string): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (!cleaned.length) return `<p class="muted">${escapeHtml(fallback)}</p>`;
  return `<ul>${cleaned.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compareReviewInsights(left: DatasetFitAnalysis["datasets"][number], right: DatasetFitAnalysis["datasets"][number]): number {
  const readinessDelta =
    reviewPriority(right.eda_interpretation?.readiness_band) -
    reviewPriority(left.eda_interpretation?.readiness_band);
  if (readinessDelta !== 0) return readinessDelta;
  return left.title.localeCompare(right.title);
}

function reviewPriority(band?: string): number {
  if (band === "metadata_only_review") return 3;
  if (band === "usable_with_checks") return 2;
  if (band === "ready_for_exploration") return 0;
  return 1;
}

function formatQualityStatusLabel(band?: string): string {
  if (band === "ready_for_exploration") return "No major issues";
  if (band === "usable_with_checks") return "Needs review";
  if (band === "metadata_only_review") return "Source check needed";
  return "Review needed";
}

function formatReviewActionSummary(insight: DatasetFitAnalysis["datasets"][number]): string {
  const band = insight.eda_interpretation?.readiness_band;
  const caution = insight.eda_interpretation?.quality_checks?.find((check) => check.status === "caution");
  if (caution?.message) return caution.message;
  if (band === "metadata_only_review") return "Open the source file before analysis; only catalog metadata was checked.";
  if (band === "usable_with_checks") return "Review the flagged checks before using this dataset in analysis.";
  if (band === "ready_for_exploration") return "Spot-check the source file before analysis; no major preview issues were found.";
  return "Review source fields, coverage, and freshness before analysis.";
}

function reviewBadgeClass(band?: string): string {
  if (band === "ready_for_exploration") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (band === "usable_with_checks") return "border-amber-200 bg-amber-50 text-amber-800";
  if (band === "metadata_only_review") return "border-red-200 bg-red-50 text-red-800";
  return "border-neutral-200 bg-white text-neutral-700";
}

function formatDatasetCategorySummary(dataset: Dataset): string {
  const categoryDisplay = getDatasetCategoryDisplay(dataset);
  const secondaryLabels = categoryDisplay.secondaryThemeIds.slice(0, 2).map(formatThemeName);
  const overflowLabel = categoryDisplay.overflowCount > 0 ? `+${categoryDisplay.overflowCount} secondary` : "";

  return [categoryDisplay.primary.label, ...secondaryLabels, overflowLabel]
    .filter(Boolean)
    .join(" - ");
}

function DatasetMetadataLine({ dataset, note }: { dataset: Dataset; note?: string }) {
  return (
    <div className="mb-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {(dataset.dataTypes || []).map((tag) => (
          <Badge key={tag} variant="outline">{tag}</Badge>
        ))}
        {formatFileTypeLabels(dataset.formats || []).map((format) => (
          <Badge key={format} variant="outline">{format}</Badge>
        ))}
      </div>
      {note?.trim() ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
          <span className="font-medium">Domain note:</span> {note}
        </div>
      ) : null}
    </div>
  );
}

function formatRoleForSummary(role: string): string {
  return role.replace(/_/g, " ");
}

function formatQualitySummaryForFinal(insight: DatasetFitAnalysis["datasets"][number]): string {
  const synthesis = insight.eda_interpretation?.synthesis?.trim();
  if (synthesis) return synthesis;
  const caution = insight.eda_interpretation?.quality_checks?.find((check) => check.status === "caution");
  if (caution) return caution.message;
  return "Review source quality, preview availability, and usable fields before analysis.";
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
