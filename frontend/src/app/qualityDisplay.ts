import { Dataset } from "./types";

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
