import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { X, CheckCircle2, ExternalLink, Loader2, TableProperties, AlertTriangle } from "lucide-react";
import { Dataset } from "../types";
import { getDatasetPreview, type DatasetPreviewResponse } from "../api";
import {
  getCompletenessCoverageLabel,
  hasCompletenessRisk,
} from "../qualityDisplay";

const DESCRIPTION_PREVIEW_LENGTH = 360;

interface DatasetDetailPanelProps {
  dataset: Dataset;
  onClose: () => void;
}

export function DatasetDetailPanel({ dataset, onClose }: DatasetDetailPanelProps) {
  const sourceLabel = formatSourceLabel(dataset.source || "unknown");
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [preview, setPreview] = useState<DatasetPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const description = dataset.description || "No description available.";
  const hasLongDescription = description.length > DESCRIPTION_PREVIEW_LENGTH;
  const visibleDescription =
    isDescriptionExpanded || !hasLongDescription
      ? description
      : truncateDescription(description, DESCRIPTION_PREVIEW_LENGTH);

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [dataset.id]);

  useEffect(() => {
    let isActive = true;
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);

    getDatasetPreview(dataset.id, 5)
      .then((payload) => {
        if (!isActive) return;
        setPreview(payload);
      })
      .catch((error: any) => {
        if (!isActive) return;
        setPreviewError(error?.message || "Unable to load dataset preview.");
      })
      .finally(() => {
        if (!isActive) return;
        setPreviewLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [dataset.id]);

  const getQualityTags = () => {
    const tags: string[] = [];

    tags.push(getCompletenessCoverageLabel(dataset.quality.completeness));
    if (hasCompletenessRisk(dataset.quality.completeness)) tags.push("Review Coverage");
    if (dataset.quality.documentation === "excellent" || dataset.quality.documentation === "good") {
      tags.push("Well Documented");
    }
    if (dataset.quality.consistency === "high") tags.push("High Quality");
    
    return tags;
  };

  const schemaColumns =
    preview?.columns && preview.columns.length > 0
      ? preview.columns
      : dataset.schemaFields || [];
  const previewRows = preview?.rows || [];
  const rowColumnNames = getPreviewColumnNames(schemaColumns.map((column) => column.name), previewRows);
  const previewSourceUrl = preview?.source_url || dataset.apiUrl;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-200 p-6 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-semibold">{dataset.name}</h2>
              {dataset.essential && (
                <Badge className="bg-blue-600">Essential</Badge>
              )}
              <Badge variant="secondary">{dataset.category || "Uncategorized"}</Badge>
            </div>
            <p className="text-neutral-600">
              {dataset.provider}
              {dataset.source ? ` - ${dataset.source}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Description */}
          <div>
            <h3 className="font-semibold mb-2">Description</h3>
            <p className="text-neutral-700 leading-6">{visibleDescription}</p>
            {hasLongDescription && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 px-0 text-blue-700 hover:bg-transparent hover:text-blue-800"
                onClick={() => setIsDescriptionExpanded((expanded) => !expanded)}
              >
                {isDescriptionExpanded ? "Show less" : "Read more"}
              </Button>
            )}
          </div>

          {/* Source */}
          <div>
            <h3 className="font-semibold mb-2">Source</h3>
            <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-neutral-500">Provider</p>
                  <p className="font-medium text-neutral-900">{dataset.provider || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Source catalog</p>
                  <p className="font-medium text-neutral-900">{sourceLabel}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-neutral-500">Dataset ID</p>
                  <p className="font-mono text-xs text-neutral-800 break-all">{dataset.id}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-neutral-500">Publication Date</p>
                  <p className="font-medium text-neutral-900">{dataset.publicationDate}</p>
                </div>
              </div>
              {dataset.apiUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => window.open(dataset.apiUrl, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="w-4 h-4" />
                  Open source record
                </Button>
              ) : (
                <p className="text-xs text-neutral-500">
                  No external source URL is available for this entry.
                </p>
              )}
            </div>
          </div>

          {dataset.categories && dataset.categories.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Categories</h3>
              <div className="flex flex-wrap gap-2">
                {dataset.categories.map((category, idx) => {
                  const [label, score] = Object.entries(category)[0] ?? ["Uncategorized", 0];
                  return (
                    <Badge key={`${label}-${idx}`} variant={idx === 0 ? "default" : "outline"}>
                      {label} {score ? `${Math.round(score * 100)}%` : ""}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quality Summary */}
          <div>
            <h3 className="font-semibold mb-2">Quality Summary</h3>
            <div className="flex flex-wrap gap-2">
              {getQualityTags().map((tag, idx) => (
                <Badge key={idx} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* Detailed Quality Metrics */}
          <div>
            <h3 className="font-semibold mb-2">Quality Screening Details</h3>
            <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-neutral-600">Completeness</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 bg-neutral-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${dataset.quality.completeness}%` }}
                    />
                  </div>
                  <span className="font-medium w-12 text-right">
                    {dataset.quality.completeness}%
                  </span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">Consistency</span>
                <span className="font-medium capitalize">{dataset.quality.consistency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">Documentation</span>
                <span className="font-medium capitalize">{dataset.quality.documentation}</span>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div>
            <h3 className="font-semibold mb-2">Data Preview</h3>
            <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 space-y-4">
              {previewLoading && (
                <div className="flex items-center gap-2 text-sm text-neutral-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading preview…
                </div>
              )}

              {previewError && (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{previewError}</span>
                </div>
              )}

              {!previewLoading && !previewError && (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 text-neutral-700">
                        <TableProperties className="w-4 h-4" />
                        <span className="text-sm font-medium">Schema</span>
                      </div>
                      {preview?.resource_format && (
                        <Badge variant="outline">{preview.resource_format}</Badge>
                      )}
                    </div>
                    {schemaColumns.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {schemaColumns.slice(0, 12).map((column) => (
                          <Badge key={column.name} variant="secondary" className="max-w-full">
                            <span className="truncate">{column.name}</span>
                            <span className="ml-1 text-neutral-500">{column.inferred_type || "unknown"}</span>
                          </Badge>
                        ))}
                        {schemaColumns.length > 12 && (
                          <Badge variant="outline">+{schemaColumns.length - 12} more</Badge>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500">No schema metadata is available for this record.</p>
                    )}
                  </div>

                  {previewRows.length > 0 ? (
                    <div className="bg-white rounded border border-neutral-200 overflow-x-auto">
                      <table className="w-full min-w-max text-sm">
                        <thead>
                          <tr className="border-b border-neutral-200">
                            {rowColumnNames.map((columnName) => (
                              <th
                                key={columnName}
                                className="text-left py-2 px-3 font-medium text-neutral-600 whitespace-nowrap"
                              >
                                {columnName}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-b border-neutral-100 last:border-0">
                              {rowColumnNames.map((columnName) => (
                                <td
                                  key={`${rowIndex}-${columnName}`}
                                  className="py-2 px-3 text-neutral-700 max-w-64 truncate"
                                  title={formatPreviewValue(row[columnName])}
                                >
                                  {formatPreviewValue(row[columnName])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="bg-white rounded border border-neutral-200 p-3 text-sm text-neutral-600">
                      <p>{preview?.message || "No row preview available from this API record. Open source record to inspect files."}</p>
                    </div>
                  )}

                  {previewSourceUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => window.open(previewSourceUrl, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open source record
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Usage Explanation */}
          <div>
            <h3 className="font-semibold mb-2">How This Dataset Will Be Used</h3>
            <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-blue-900">{dataset.usageExplanation}</p>
            </div>
          </div>

          {/* Close button */}
          <div className="pt-2">
            <Button onClick={onClose} className="w-full">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    madrid_ckan: "Madrid CKAN",
    datos_gob_es: "datos.gob.es",
    unknown: "Unknown source",
  };
  return labels[source] || source;
}

function truncateDescription(description: string, maxLength: number): string {
  if (description.length <= maxLength) return description;

  const preview = description.slice(0, maxLength).trimEnd();
  const lastSpace = preview.lastIndexOf(" ");
  const trimmedPreview = lastSpace > maxLength * 0.75 ? preview.slice(0, lastSpace) : preview;
  return `${trimmedPreview}...`;
}

function getPreviewColumnNames(schemaNames: string[], rows: Array<Record<string, unknown>>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const name of schemaNames) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "n/a";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
