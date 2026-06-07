import { Dataset } from "./types";

export function hasCompletenessRisk(completeness: number) {
  return completeness < 60;
}

export function hasFreshnessRisk(value: Dataset["quality"]["timeliness"]) {
  return value === "outdated";
}
