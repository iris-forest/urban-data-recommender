import { CompatibilityBand, Dataset } from "./types";

export function getDatasetCompatibilityScore(dataset: Dataset): number | undefined {
  return dataset.compatibilityScore;
}

export function getDatasetCompatibilityBand(dataset: Dataset): CompatibilityBand {
  if (dataset.compatibilityBand) return dataset.compatibilityBand;

  const score = getDatasetCompatibilityScore(dataset);
  if (typeof score !== "number") return "weak";
  const normalized = score > 1 ? score / 100 : score;
  if (normalized >= 0.75) return "strong";
  if (normalized >= 0.5) return "partial";
  return "weak";
}

export function formatCompatibilityScore(score: number | undefined): string {
  if (typeof score !== "number") return "Not scored";
  const normalized = score > 1 ? score : score * 100;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
}

export function compatibilityScoreClass(dataset: Dataset): string {
  if (typeof getDatasetCompatibilityScore(dataset) !== "number") return "text-neutral-500";
  const band = getDatasetCompatibilityBand(dataset);
  if (band === "strong") return "text-emerald-700";
  if (band === "partial") return "text-amber-700";
  return "text-red-700";
}

export function compatibilityBadgeClass(dataset: Dataset): string {
  if (typeof getDatasetCompatibilityScore(dataset) !== "number") {
    return "border-neutral-200 bg-neutral-50 text-neutral-700";
  }
  const band = getDatasetCompatibilityBand(dataset);
  if (band === "strong") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (band === "partial") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-red-200 bg-red-50 text-red-800";
}

export function compatibilityBandLabel(dataset: Dataset): string {
  const band = getDatasetCompatibilityBand(dataset);
  if (band === "strong") return "Strong match";
  if (band === "partial") return "Partial match";
  return "Weak match";
}

export interface CompatibilityExplanation {
  summary: string;
  matchedConcepts: string[];
  missingConcepts: string[];
  geography?: string;
  time?: string;
}

export function getCompatibilityExplanation(dataset: Dataset): CompatibilityExplanation {
  const evidence = dataset.compatibilityEvidence;
  return {
    summary:
      evidence?.summary ||
      dataset.compatibilityReason ||
      "Match score reflects how well the dataset text and fields relate to your planning question.",
    matchedConcepts: evidence?.matched_concepts || [],
    missingConcepts: evidence?.missing_concepts || [],
    geography: evidence?.geography,
    time: evidence?.time,
  };
}

export function formatCompatibilityTooltip(dataset: Dataset): string {
  const explanation = getCompatibilityExplanation(dataset);
  const parts = [explanation.summary];

  if (explanation.matchedConcepts.length) {
    parts.push(`Matched: ${explanation.matchedConcepts.join(", ")}.`);
  }
  if (explanation.missingConcepts.length) {
    parts.push(`Missing: ${explanation.missingConcepts.join(", ")}.`);
  }
  if (explanation.geography) {
    parts.push(`Geography: ${explanation.geography}`);
  }
  if (explanation.time) {
    parts.push(`Time: ${explanation.time}`);
  }

  return parts.join(" ");
}
