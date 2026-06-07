import { Dataset } from "./types";
import { formatThemeName, normalizeThemeId } from "./themeTaxonomy";

export type DatasetCoverageStatus = "covered" | "related" | "missing";

export interface DatasetCoverageItem {
  themeId: string;
  label: string;
  status: DatasetCoverageStatus;
}

export interface DatasetCoverageSummary {
  bestRoleThemeId?: string;
  bestRoleLabel: string;
  coverageItems: DatasetCoverageItem[];
  coveredLabels: string[];
  relatedLabels: string[];
  needsPairingLabels: string[];
}

const IGNORED_THEME_IDS = new Set(["", "general", "other", "uncategorized", "unknown"]);

export function getDatasetCoverageSummary(
  dataset: Dataset,
  requiredThemeIds: string[] = []
): DatasetCoverageSummary {
  const requiredThemes = uniqueThemeIds(requiredThemeIds);
  const directThemes = uniqueThemeIds(dataset.focusedMatchingThemes || []);
  const relatedThemes = uniqueThemeIds([
    ...(dataset.matchingThemes || []),
    ...(dataset.themes || []),
    dataset.theme || "",
  ]);
  const evidenceMissing = uniqueThemeIds(dataset.compatibilityEvidence?.missing_concepts || []);

  const coverageItems = requiredThemes.map((themeId) => {
    let status: DatasetCoverageStatus = "missing";
    if (directThemes.includes(themeId)) {
      status = "covered";
    } else if (relatedThemes.includes(themeId)) {
      status = "related";
    }
    return {
      themeId,
      label: formatThemeName(themeId),
      status,
    };
  });

  const firstCovered = coverageItems.find((item) => item.status === "covered");
  const firstRelated = coverageItems.find((item) => item.status === "related");
  const fallbackTheme = directThemes[0] || relatedThemes[0];
  const bestRoleThemeId = firstCovered?.themeId || firstRelated?.themeId || fallbackTheme;
  const bestRoleLabel = bestRoleThemeId
    ? `${formatThemeName(bestRoleThemeId)} input`
    : "Supporting dataset";

  const coveredLabels = coverageItems
    .filter((item) => item.status === "covered")
    .map((item) => item.label);
  const relatedLabels = coverageItems
    .filter((item) => item.status === "related")
    .map((item) => item.label);
  const missingLabels = coverageItems
    .filter((item) => item.status === "missing")
    .map((item) => item.label);
  const evidenceMissingLabels = evidenceMissing
    .filter((themeId) => !requiredThemes.includes(themeId))
    .map((themeId) => formatThemeName(themeId));

  return {
    bestRoleThemeId,
    bestRoleLabel,
    coverageItems,
    coveredLabels,
    relatedLabels,
    needsPairingLabels: uniqueLabels([...missingLabels, ...evidenceMissingLabels]),
  };
}

export function getThemeCoverageStatus(
  themeId: string,
  datasets: Dataset[],
  selectedDatasetIds: Set<string>
): DatasetCoverageStatus {
  const selectedDatasets = datasets.filter((dataset) => selectedDatasetIds.has(dataset.id));
  const candidateDatasets = selectedDatasets.length > 0 ? selectedDatasets : datasets;
  const normalizedThemeId = normalizeRequiredThemeId(themeId);
  if (!normalizedThemeId) return "missing";

  const hasCovered = candidateDatasets.some((dataset) =>
    uniqueThemeIds(dataset.focusedMatchingThemes || []).includes(normalizedThemeId)
  );
  if (hasCovered) return "covered";

  const hasRelated = candidateDatasets.some((dataset) =>
    uniqueThemeIds([
      ...(dataset.matchingThemes || []),
      ...(dataset.themes || []),
      dataset.theme || "",
    ]).includes(normalizedThemeId)
  );
  return hasRelated ? "related" : "missing";
}

export function uniqueThemeIds(themeIds: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  themeIds.forEach((themeId) => {
    const normalized = normalizeRequiredThemeId(themeId);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    unique.push(normalized);
  });

  return unique;
}

function normalizeRequiredThemeId(themeId: string): string {
  const normalized = normalizeThemeId(themeId);
  return IGNORED_THEME_IDS.has(normalized) ? "" : normalized;
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  labels.forEach((label) => {
    const trimmed = label.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    unique.push(trimmed);
  });

  return unique;
}
