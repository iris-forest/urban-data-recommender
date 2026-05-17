import { Dataset, DatasetFitInsight } from "./types";

export type InsightQualityBand = "strong" | "usable" | "limited";

/** Headline score for fit review — aligned with final overview (`fit_score`). */
export function getInsightFitScore(insight: DatasetFitInsight): number {
  if (typeof insight.fit_score === "number") {
    return Math.max(0, Math.min(100, Math.round(insight.fit_score)));
  }
  return 0;
}

export function getInsightQualityScore(insight: DatasetFitInsight): number {
  return getInsightFitScore(insight);
}

export function getInsightFitBand(insight: DatasetFitInsight): InsightQualityBand {
  const score = getInsightFitScore(insight);
  if (score >= 75) return "strong";
  if (score >= 50) return "usable";
  return "limited";
}

export function getInsightQualityBand(insight: DatasetFitInsight): InsightQualityBand {
  const band = insight.quality_band;
  if (band === "strong" || band === "usable" || band === "limited") return band;
  return getInsightFitBand(insight);
}

export function formatQualityScore(score: number): string {
  return `${Math.max(0, Math.min(100, Math.round(score)))}%`;
}

export function qualityScoreClass(band: InsightQualityBand): string {
  if (band === "strong") return "text-emerald-700";
  if (band === "usable") return "text-amber-700";
  return "text-red-700";
}

export function qualityBandLabel(band: InsightQualityBand): string {
  if (band === "strong") return "Strong fit";
  if (band === "usable") return "Usable fit";
  return "Limited fit";
}

export function getCompletenessColorClass(completeness: number) {
  if (completeness >= 75) return "text-green-600";
  if (completeness >= 50) return "text-amber-600";
  return "text-red-600";
}

export function getCompletenessCoverageLabel(completeness: number) {
  if (completeness >= 80) return "Strong Coverage";
  if (completeness >= 60) return "Usable Coverage";
  return "Limited Coverage";
}

export function getCompletenessBand(completeness: number) {
  if (completeness >= 80) return "strong";
  if (completeness >= 60) return "usable";
  return "limited";
}

export function getCompletenessBandLabel(completeness: number) {
  if (completeness >= 80) return "Strong completeness";
  if (completeness >= 60) return "Usable completeness";
  return "Limited completeness";
}

export function technicalQualityScore(dataset: Dataset): number {
  const timeliness = { recent: 1, moderate: 0.65, outdated: 0.25 }[dataset.quality.timeliness];
  const consistency = { high: 1, medium: 0.65, low: 0.25 }[dataset.quality.consistency];
  const documentation = { excellent: 1, good: 0.75, limited: 0.35 }[dataset.quality.documentation];

  return (
    dataset.quality.completeness / 100 +
    timeliness +
    consistency +
    documentation
  ) / 4;
}

export function getCoverageStrengthLabel(completeness: number) {
  if (completeness >= 80) return "Strong";
  if (completeness >= 60) return "Usable";
  return "Limited";
}

export function hasCompletenessRisk(completeness: number) {
  return completeness < 60;
}

export function hasFreshnessRisk(value: Dataset["quality"]["timeliness"]) {
  return value === "outdated";
}
