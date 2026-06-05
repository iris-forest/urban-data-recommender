import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  TableProperties,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";
import { Dataset } from "../types";
import { getDatasetPreview, type DatasetPreviewResponse } from "../api";
import {
  compatibilityBadgeClass,
  compatibilityBandLabel,
  formatCompatibilityDelta,
  formatCompatibilityScore,
  formatCompatibilityTooltip,
  getDatasetCompatibilityScore,
} from "../compatibilityDisplay";
import { formatFileTypeLabel, formatFileTypeLabels } from "../fileFormats";
import { formatThemeName, getDatasetCategoryDisplay } from "../themeTaxonomy";

const DESCRIPTION_PREVIEW_LENGTH = 360;

interface DatasetDetailPanelProps {
  dataset: Dataset;
  preferredThemeIds?: string[];
  onClose: () => void;
}

export function DatasetDetailPanel({ dataset, preferredThemeIds = [], onClose }: DatasetDetailPanelProps) {
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

  const schemaColumns =
    preview?.columns && preview.columns.length > 0
      ? preview.columns
      : dataset.schemaFields || [];
  const previewRows = preview?.rows || [];
  const rowColumnNames = getPreviewColumnNames(schemaColumns.map((column) => column.name), previewRows);
  const previewSourceUrl = preview?.source_url || dataset.apiUrl;
  const resources = dataset.resources || [];
  const displayFormats = getDisplayFormats(dataset);
  const compatibilityScore = getDatasetCompatibilityScore(dataset);
  const compatibilityTooltip = formatCompatibilityTooltip(dataset);
  const breakdown = dataset.compatibilityBreakdown;
  const signalContributionTotal = breakdown?.signals.reduce((sum, signal) => sum + signal.contribution, 0) ?? 0;
  const signalAdjustment = breakdown?.final_adjustment ?? 0;
  const signalFinalScore = breakdown?.final_score ?? (compatibilityScore ?? 0);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-200 p-6 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-semibold leading-snug">{dataset.name}</h2>
            {dataset.essential && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge className="bg-blue-600">Recommended</Badge>
              </div>
            )}
            <p className="mt-2 text-neutral-600">
              {dataset.provider}
              {dataset.source ? ` - ${sourceLabel}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
            aria-label="Close dataset details"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="font-semibold mb-2">Why This Dataset Matches</h3>
            <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={compatibilityBadgeClass(dataset)}>
                  {compatibilityBandLabel(dataset)} {formatCompatibilityScore(compatibilityScore)}
                </Badge>
                {typeof dataset.semanticScore === "number" && (
                  <Badge variant="secondary">
                    Semantic {formatCompatibilityScore(dataset.semanticScore)}
                  </Badge>
                )}
              </div>
              {dataset.compatibilityBreakdown?.signals && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3">
                  {dataset.compatibilityBreakdown.signals.map((sig) => (
                    <div
                      key={sig.id}
                      className="rounded border border-neutral-200 bg-white/40 p-3 flex flex-col items-start"
                    >
                      <div className="text-xs text-neutral-500">{sig.label}</div>
                      <div className="flex items-baseline gap-2 mt-1">
                        <div className="text-lg font-semibold text-neutral-900">{sig.percentage}%</div>
                        <div className="text-xs text-neutral-500">({Math.round(sig.weight * 100)}% weight)</div>
                      </div>
                      <div className="w-full h-2 bg-neutral-100 rounded mt-2 overflow-hidden">
                        <div
                          className="h-2 bg-blue-600"
                          style={{ width: `${Math.round(sig.contribution * 100)}%`, opacity: 0.9 }}
                        />
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">contributes {Math.round(sig.contribution * 100)}%</div>
                    </div>
                  ))}
                </div>
              )}
              {dataset.compatibilityBreakdown && (
                <div className="flex flex-wrap items-center gap-4 rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                  <span>Signals total: {formatCompatibilityScore(signalContributionTotal)}</span>
                  <span>Adjustment: {formatCompatibilityDelta(signalAdjustment)}</span>
                  <span className="font-medium text-neutral-800">Final score: {formatCompatibilityScore(signalFinalScore)}</span>
                </div>
              )}
              <div className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <p className="text-neutral-800">{dataset.usageExplanation}</p>
              </div>
              <p className="text-sm text-neutral-700">{compatibilityTooltip}</p>
              {dataset.compatibilityEvidence?.missing_concepts?.length ? (
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="text-neutral-500">Missing concepts:</span>
                  {dataset.compatibilityEvidence.missing_concepts.map((concept) => (
                    <Badge key={concept} variant="outline">
                      {concept}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <DatasetMetadataGrid dataset={dataset} preferredThemeIds={preferredThemeIds} />

          <div>
            <h3 className="font-semibold mb-2">Description</h3>
            <div className="prose prose-sm max-w-none text-neutral-700 leading-6">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                      {children}
                    </a>
                  ),
                }}
              >
                {visibleDescription}
              </ReactMarkdown>
            </div>
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
                <div>
                  <p className="text-neutral-500">Published</p>
                  <p className="font-medium text-neutral-900">{dataset.publicationDate || "Not listed"}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Access type</p>
                  <p className="font-medium text-neutral-900">{formatAccessLabel(dataset.accessType)}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-neutral-500">Dataset ID</p>
                  <p className="font-mono text-xs text-neutral-800 break-all">{dataset.id}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {displayFormats.map((format) => (
                  <Badge key={format} variant="outline">{format}</Badge>
                ))}
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

          {resources.length > 0 && (
            <details className="rounded-lg border border-neutral-200 bg-white">
              <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-neutral-900">
                Source files ({resources.length})
              </summary>
              <div className="border-t border-neutral-200 px-4 py-3 flex flex-wrap gap-2">
                {resources.map((resource, index) => (
                  <Button key={`${resource.url}-${index}`} asChild variant="outline" size="sm" className="gap-2">
                    <a href={resource.url} target="_blank" rel="noreferrer" title={resource.description || resource.name}>
                      <FileText className="w-4 h-4" />
                      {resource.name}
                      {resource.format ? <Badge variant="secondary">{formatFileTypeLabel(resource.format)}</Badge> : null}
                    </a>
                  </Button>
                ))}
              </div>
            </details>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">Data Preview</h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-4 h-4 text-neutral-500" />
                </TooltipTrigger>
                <TooltipContent>
                  The preview is a small source sample. It may not represent the full dataset.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 space-y-4">
              {previewLoading && (
                <div className="flex items-center gap-2 text-sm text-neutral-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading preview...
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
                        <span className="text-sm font-medium">Preview columns</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-4 h-4 text-neutral-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Fields listed in source metadata or detected in the preview rows.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {preview?.resource_format && (
                        <Badge variant="outline">{formatFileTypeLabel(preview.resource_format)}</Badge>
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
                      <p className="text-sm text-neutral-500">No preview-column metadata is available for this record.</p>
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

function InfoBadge({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="bg-white">
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}

function DatasetMetadataGrid({
  dataset,
  preferredThemeIds,
}: {
  dataset: Dataset;
  preferredThemeIds: string[];
}) {
  const dataTypes = (dataset.dataTypes || []).filter(Boolean);
  const provenanceLabel = dataset.provenance || "";
  const categoryDisplay = getDatasetCategoryDisplay(dataset, preferredThemeIds);

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm md:grid-cols-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Category</p>
        <div className="mt-1 space-y-2">
          <div className="space-y-1">
            <p className="font-medium text-neutral-900">{categoryDisplay.primary.label}</p>
            {categoryDisplay.secondaryThemeIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {categoryDisplay.secondaryThemeIds.map((themeId) => (
                  <Badge key={themeId} variant="outline" className="bg-white">
                    {formatThemeName(themeId)}
                  </Badge>
                ))}
                {categoryDisplay.overflowCount > 0 && (
                  <Badge variant="outline" className="bg-white">
                    +{categoryDisplay.overflowCount} secondary
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Type</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {dataTypes.length > 0 ? (
            dataTypes.map((tag) => (
              <InfoBadge key={tag} label={tag} description={getDataTypeDescription(tag)} />
            ))
          ) : (
            <span className="text-neutral-600">Not inferred</span>
          )}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Labels</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {provenanceLabel ? (
            <InfoBadge label={provenanceLabel} description={getProvenanceDescription(provenanceLabel)} />
          ) : (
            <span className="text-neutral-600">No provenance label</span>
          )}
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

function formatAccessLabel(accessType: Dataset["accessType"]): string {
  if (accessType === "open") return "Open access";
  if (accessType === "restricted") return "Restricted access";
  return "Access type: request needed";
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

function isMissingPreviewValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "" || ["na", "n/a", "null", "none"].includes(normalized);
}

function formatPreviewValue(value: unknown): string {
  if (isMissingPreviewValue(value)) return "n/a";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function getDisplayFormats(dataset: Dataset): string[] {
  return formatFileTypeLabels([
    ...(dataset.formats || []),
    ...(dataset.resources || []).map((resource) => resource.format || ""),
  ]);
}

function getProvenanceDescription(label: string): string {
  const descriptions: Record<string, string> = {
    "Official Government": "Published by a government or public-sector catalog.",
    "Community-Generated": "Produced or maintained by community contributors.",
    "Research Organization": "Published by a research, university, or observatory source.",
    "Participatory Data": "Collected through participatory or stakeholder input.",
    "Non-Profit / NGO": "Published by a non-profit or civil-society organization.",
    "Catalog Metadata": "Provenance is inferred from the available catalog metadata.",
  };
  return descriptions[label] || "Provenance inferred from catalog metadata.";
}

function getDataTypeDescription(label: string): string {
  const descriptions: Record<string, string> = {
    Quantitative: "Structured values, counts, measurements, or coded fields.",
    Qualitative: "Textual, narrative, or perception-based information.",
    "Mixed Methods": "Combines structured measurements with qualitative context.",
    "Survey Data": "Likely collected through questionnaires or survey instruments.",
    Crowdsourced: "Collected or maintained by public contributors.",
    "Participatory Data": "Collected with direct participant or stakeholder input.",
  };
  return descriptions[label] || "Data type inferred from metadata and file formats.";
}
