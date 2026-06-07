import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Circle,
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
  DatasetCoverageStatus,
  getDatasetCoverageSummary,
} from "../datasetCoverage";
import {
  compatibilityScoreClass,
  formatCompatibilityScore,
  getDatasetCompatibilityScore,
} from "../compatibilityDisplay";
import { formatFileTypeLabel, formatFileTypeLabels } from "../fileFormats";
import { formatThemeName, getDatasetCategoryDisplay } from "../themeTaxonomy";

const DESCRIPTION_PREVIEW_LENGTH = 360;

type ScoreDriverStatus = DatasetCoverageStatus | "unknown";

interface DatasetDetailPanelProps {
  dataset: Dataset;
  preferredThemeIds?: string[];
  onClose: () => void;
}

interface DatasetDetailContentProps {
  dataset: Dataset;
  preferredThemeIds?: string[];
  onClose?: () => void;
  showCloseButton?: boolean;
}

export function DatasetDetailPanel({ dataset, preferredThemeIds = [], onClose }: DatasetDetailPanelProps) {
  const sourceLabel = formatSourceLabel(dataset.source || "unknown");

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-200 p-6 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-semibold leading-snug">{dataset.name}</h2>
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

        <DatasetDetailContent
          dataset={dataset}
          preferredThemeIds={preferredThemeIds}
          onClose={onClose}
          showCloseButton
        />
      </div>
    </div>
  );
}

export function DatasetDetailContent({
  dataset,
  preferredThemeIds = [],
  onClose,
  showCloseButton = false,
}: DatasetDetailContentProps) {
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
  const breakdown = dataset.compatibilityBreakdown;
  const coverageSummary = getDatasetCoverageSummary(dataset, preferredThemeIds);
  const scoreDrivers = getScoreDrivers(dataset, coverageSummary);

  return (
        <div className="p-6 space-y-6">
          <div>
            <h3 className="font-semibold mb-2">Why This Dataset Matches</h3>
            <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
              <div className="flex flex-col gap-3 rounded-md bg-neutral-50 p-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Match</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`text-3xl font-semibold leading-none ${compatibilityScoreClass(dataset)}`}>
                      {formatCompatibilityScore(compatibilityScore)}
                    </span>
                    <Badge variant="secondary">{coverageSummary.bestRoleLabel}</Badge>
                  </div>
                  <p className="mt-2 max-w-xl text-sm text-neutral-700">
                    This score reflects how useful the dataset is as an input for the planning question, not whether it answers the full indicator alone.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CoverageList
                  title="Covers"
                  labels={[...coverageSummary.coveredLabels, ...coverageSummary.relatedLabels]}
                  emptyLabel="No detected indicator role is directly covered."
                  tone="covered"
                />
                <CoverageList
                  title="Needs pairing"
                  labels={coverageSummary.needsPairingLabels}
                  emptyLabel="No detected pairing gaps."
                  tone={coverageSummary.needsPairingLabels.length ? "missing" : "covered"}
                />
              </div>

              <div className="space-y-2">
                {scoreDrivers.map((driver) => (
                  <ScoreDriverRow key={driver.label} {...driver} />
                ))}
              </div>

              {breakdown?.signals?.length ? (
                <details className="group rounded-md border border-neutral-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-neutral-800 [&::-webkit-details-marker]:hidden">
                    Technical scoring details
                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-neutral-200 px-3 py-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {breakdown.signals.map((signal) => (
                        <div key={signal.id} className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-neutral-800">{signal.label}</span>
                            <span className="font-semibold text-neutral-900">{signal.percentage}%</span>
                          </div>
                          <p className="mt-1 text-xs text-neutral-500">
                            Weight {Math.round(signal.weight * 100)}%; influence {Math.round(signal.contribution * 100)}%.
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
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

          {showCloseButton && onClose && (
            <div className="pt-2">
              <Button onClick={onClose} className="w-full">
                Close
              </Button>
            </div>
          )}
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

function CoverageList({
  title,
  labels,
  emptyLabel,
  tone,
}: {
  title: string;
  labels: string[];
  emptyLabel: string;
  tone: DatasetCoverageStatus;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</p>
      {labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {labels.map((label) => (
            <Badge key={label} variant="outline" className={coverageBadgeClass(tone)}>
              {label}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-neutral-600">{emptyLabel}</p>
      )}
    </div>
  );
}

function ScoreDriverRow({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status: ScoreDriverStatus;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-neutral-200 bg-white p-3">
      {status === "covered" ? (
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
          role="img"
          aria-label="Supported"
        />
      ) : status === "related" ? (
        <Circle
          className="mt-0.5 h-4 w-4 shrink-0 text-sky-600"
          role="img"
          aria-label="Related"
        />
      ) : status === "unknown" ? (
        <HelpCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500"
          role="img"
          aria-label="Not mentioned"
        />
      ) : (
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
          role="img"
          aria-label="Needs attention"
        />
      )}
      <div>
        <p className="text-sm font-medium text-neutral-900">{label}</p>
        <p className="text-sm text-neutral-600">{detail}</p>
      </div>
    </div>
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

function getScoreDrivers(
  dataset: Dataset,
  coverageSummary: ReturnType<typeof getDatasetCoverageSummary>
): Array<{ label: string; detail: string; status: ScoreDriverStatus }> {
  const evidence = dataset.compatibilityEvidence;
  const directLabels = coverageSummary.coveredLabels;
  const relatedLabels = coverageSummary.relatedLabels;
  const semanticScore = typeof dataset.semanticScore === "number"
    ? formatCompatibilityScore(dataset.semanticScore)
    : "not scored";
  const geography = evidence?.geography || "No geography evidence was returned.";
  const time = evidence?.time || "No clear time metadata was available for this dataset.";
  const hasGeographyEvidence = Boolean(evidence?.geography);
  const hasUnknownGeography =
    !hasGeographyEvidence ||
    /does not mention|not mentioned|not mention|not specified|not available|no .*evidence/i.test(geography);
  const hasUnknownTime =
    !Boolean(evidence?.time) ||
    /no clear|does not mention|not mentioned|not mention|not specified|not available/i.test(time);
  const hasNegativeGeography = /not compatible|outside|non-madrid/i.test(geography);

  return [
    {
      label: "Direct role evidence",
      detail: directLabels.length
        ? `Directly covers ${formatList(directLabels)}.`
        : "No required role is directly covered by focused evidence.",
      status: directLabels.length ? "covered" : "unknown",
    },
    {
      label: "Related text evidence",
      detail: relatedLabels.length
        ? `Related to ${formatList(relatedLabels)}; semantic similarity is ${semanticScore}.`
        : `No related required role was found; semantic similarity is ${semanticScore}.`,
      status: relatedLabels.length ? "related" : "unknown",
    },
    {
      label: "Geography context",
      detail: geography,
      status: hasUnknownGeography ? "unknown" : hasNegativeGeography ? "missing" : "covered",
    },
    {
      label: "Time context",
      detail: time,
      status: hasUnknownTime ? "unknown" : "covered",
    },
    {
      label: "Missing required components",
      detail: coverageSummary.needsPairingLabels.length
        ? `Pair with datasets for ${formatList(coverageSummary.needsPairingLabels)}.`
        : "No missing detected indicator components.",
      status: coverageSummary.needsPairingLabels.length ? "missing" : "covered",
    },
  ];
}

function coverageBadgeClass(status: DatasetCoverageStatus): string {
  if (status === "covered") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "related") return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function formatList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
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
