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
import { IndicatorRequest, Dataset, DatasetFitAnalysis } from "../types";
import { createDatasetPackage, createDatasetPackageManifest } from "../api";
import { hasCompletenessRisk, hasFreshnessRisk } from "../qualityDisplay";
import { formatGeographicLevel } from "../geographyDisplay";

const SUMMARY_LIST_LIMIT = 4;

export function FinalOverview() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<IndicatorRequest | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [fitAnalysis, setFitAnalysis] = useState<DatasetFitAnalysis | null>(null);
  const [showAllSelectedDatasets, setShowAllSelectedDatasets] = useState(false);
  const [showAllFitInsights, setShowAllFitInsights] = useState(false);
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
  }, [navigate]);

  const handleStartNew = () => {
    appStore.reset();
    navigate("/");
  };

  const handleExport = async () => {
    // Export the same manifest payload that the backend places inside the zip
    // so JSON and package downloads stay consistent.
    if (datasets.length === 0) return;
    setExporting(true);
    setDownloadError(null);
    try {
      const manifest = await createDatasetPackageManifest({
        dataset_ids: datasets.map((dataset) => dataset.id),
      });
      const blob = new Blob([JSON.stringify(manifest, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "urban-planner-dataset-package-manifest.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Manifest exported", {
        description: "The JSON matches the package manifest.",
      });
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      setDownloadError(errorMsg);
      toast.error("Export failed", {
        description: errorMsg,
      });
    } finally {
      setExporting(false);
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
      const blob = await createDatasetPackage({ dataset_ids: datasetIds });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `datasets-package-${new Date().toISOString()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Package downloaded with ${datasetIds.length} dataset(s)`, {
        description: "Your dataset package is ready to use.",
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
  const fitInsights = fitAnalysis?.datasets || [];
  const displayedFitInsights = showAllFitInsights
    ? fitInsights
    : fitInsights.slice(0, SUMMARY_LIST_LIMIT);
  const workflowRecommendations =
    fitAnalysis?.cross_dataset_summary.recommended_workflow.length
      ? fitAnalysis.cross_dataset_summary.recommended_workflow
      : [
          "Verify spatial alignment between population and transport datasets",
          "Document any data preprocessing steps for reproducibility",
          "Consider temporal alignment when combining datasets from different update cycles",
          "Validate indicator results against known reference neighborhoods",
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
            Review your indicator specification and selected datasets before proceeding
            with analysis.
          </p>
        </div>

        {/* Original Indicator Request */}
        <Card>
          <CardHeader>
            <CardTitle>Your Indicator Request</CardTitle>
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
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Selected Datasets ({datasets.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={() => navigate("/results")}>
              Edit selection
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Essential Datasets */}
            {displayedEssentialDatasets.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-neutral-600 mb-2 flex items-center gap-2">
                  <Badge className="bg-blue-600">Essential</Badge>
                  <span>Required for Analysis</span>
                </h3>
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
                            {dataset.provider} - {dataset.category || "Uncategorized"}
                          </p>
                        </div>
                        <Badge variant={dataset.accessType === "open" ? "default" : "secondary"}>
                          {formatAccessLabel(dataset.accessType)}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-neutral-500">Source:</span>
                          <span className="ml-1 font-medium">
                            {dataset.source || "unknown"}
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500">Completeness:</span>
                          <span className="ml-1 font-medium">
                            {dataset.quality.completeness}%
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500">Consistency:</span>
                          <span className="ml-1 font-medium capitalize">
                            {dataset.quality.consistency}
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500">Documentation:</span>
                          <span className="ml-1 font-medium capitalize">
                            {dataset.quality.documentation}
                          </span>
                        </div>
                      </div>
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
                            {dataset.provider} - {dataset.category || "Uncategorized"}
                          </p>
                        </div>
                        <Badge variant="outline">Optional</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-neutral-500">Source:</span>
                          <span className="ml-1 font-medium">
                            {dataset.source || "unknown"}
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500">Completeness:</span>
                          <span className="ml-1 font-medium">
                            {dataset.quality.completeness}%
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500">Consistency:</span>
                          <span className="ml-1 font-medium capitalize">
                            {dataset.quality.consistency}
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500">Documentation:</span>
                          <span className="ml-1 font-medium capitalize">
                            {dataset.quality.documentation}
                          </span>
                        </div>
                      </div>
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

        {/* Dataset Fit Analysis */}
        {fitAnalysis && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitMerge className="w-5 h-5 text-blue-600" />
                Dataset Fit Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
                <p className="text-sm text-neutral-700">
                  {fitAnalysis.cross_dataset_summary.summary}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {displayedFitInsights.map((insight) => (
                  <div
                    key={insight.dataset_id}
                    className="border border-neutral-200 rounded-lg p-3 bg-white"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h4 className="font-medium leading-snug">{insight.title}</h4>
                        <p className="text-sm text-neutral-600">
                          {insight.recommended_role}
                        </p>
                      </div>
                      <Badge className={fitBadgeClass(insight.fit_score)}>
                        {insight.fit_score}%
                      </Badge>
                    </div>
                    <p className="text-sm text-neutral-700 mb-2">
                      {formatFitSummaryForFinal(insight.fit_summary, insight.title, insight.recommended_role)}
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

              {fitInsights.length > SUMMARY_LIST_LIMIT && (
                <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
                  <p className="text-sm text-neutral-500">
                    Showing {displayedFitInsights.length} of {fitInsights.length} dataset fit results
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAllFitInsights((current) => !current)}
                  >
                    {showAllFitInsights ? "Show fewer" : `Show all ${fitInsights.length}`}
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
                  This may affect the accuracy of your indicator. Consider validating
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
              aria-label="Go back to dataset fit review"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Fit Review
            </Button>
            <Button
              onClick={handleExport}
              variant="outline"
              className="gap-2"
              disabled={exporting}
              aria-label="Export package manifest as JSON"
              aria-busy={exporting}
            >
              <Download className="w-4 h-4" />
              {exporting ? "Exporting…" : "Export Manifest"}
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
              {downloading ? "Preparing package…" : "Download Package"}
            </Button>
            <Button
              onClick={handleStartNew}
              className="flex-1 gap-2"
              aria-label="Start a new indicator request"
            >
              <Home className="w-4 h-4" />
              Start New Indicator
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

function fitBadgeClass(score: number): string {
  if (score >= 75) return "bg-green-600";
  if (score >= 50) return "bg-amber-600";
  return "bg-red-600";
}

function formatAccessLabel(accessType: Dataset["accessType"]): string {
  if (accessType === "open") return "Open access";
  if (accessType === "restricted") return "Restricted access";
  return "Access by request";
}

function formatRoleForSummary(role: string): string {
  return role.replace(/_/g, " ");
}

function formatFitSummaryForFinal(summary: string, title: string, recommendedRole: string): string {
  let text = summary.trim();
  if (title.trim()) {
    text = text.replace(new RegExp(`^${escapeRegExp(title.trim())}\\s+`, "i"), "");
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
