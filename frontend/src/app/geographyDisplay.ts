export function formatGeographicLevel(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

  if (!normalized || normalized === "unknown") return value;
  if (
    normalized === "madrid" ||
    normalized === "madrid city" ||
    normalized === "madrid district" ||
    normalized === "district" ||
    normalized === "madrid neighbourhood" ||
    normalized === "madrid neighborhood" ||
    normalized === "neighbourhood" ||
    normalized === "neighborhood" ||
    normalized === "madrid census tract" ||
    normalized === "census tract" ||
    normalized === "madrid census section" ||
    normalized === "census section" ||
    normalized === "madrid borough" ||
    normalized === "borough"
  ) {
    return "Madrid";
  }

  return value;
}

export function formatSpatialResolution(coverage: string, value: string): string {
  const coverageNormalized = coverage.trim().toLowerCase();
  const resolutionNormalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

  if (coverageNormalized.includes("madrid")) {
    return "Madrid";
  }

  if (coverageNormalized.includes("spain")) {
    return "country";
  }

  if (!resolutionNormalized || ["unknown", "not specified", "n/a"].includes(resolutionNormalized)) {
    return value;
  }

  return value;
}
