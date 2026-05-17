/**
 * API client for the Urban Planner Dataset Assistant backend.
 * 
 * Communicates with the configured FastAPI backend.
 */

import {
  IndicatorRequest,
  Dataset,
  DatasetFitAnalysis,
  DatasetFitAnalysisRequest,
  CompatibilityBand,
  CompatibilityEvidence,
} from "./types";
import { translateCatalogText } from "./catalogTranslation";
import { formatFileTypeLabel, formatFileTypeLabels } from "./fileFormats";
import { formatGeographicLevel, formatSpatialResolution } from "./geographyDisplay";

/** Backend origin for fetch calls (proxied as /backend in dev — see vite.config.ts). */
function resolveApiBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return `${window.location.origin}/backend`;
  }
  return "http://127.0.0.1:8000";
}

const API_BASE_URL = resolveApiBaseUrl();
const API_DEBUG_ENABLED = !!import.meta.env.DEV;
const ANALYZE_TIMEOUT_MS = 30000;

// Runtime diagnostics stay behind the Vite dev flag so production builds do
// not leak catalog payload details into the browser console.
function logApiDebug(event: string, payload: Record<string, unknown>) {
  if (!API_DEBUG_ENABLED) return;
  console.debug(`[API] ${event}`, payload);
}

// Backend errors may arrive as FastAPI JSON or as a plain failed response. This
// helper keeps all API wrappers returning human-readable Error messages.
async function safeReadError(response: Response): Promise<string> {
  try {
    const error = await response.json();
    if (typeof error?.detail === "string" && error.detail) {
      return error.detail;
    }
  } catch {
    // no-op, fallback below
  }
  return `Request failed with status ${response.status}`;
}

// =============================================================================
// Type Definitions for API Communication
// =============================================================================

export interface AnalyzeResponse {
  parsed_indicator: {
    geographic_level: string;
    time_frame: string;
    population: string;
    attributes: string[];
  };
  extracted_themes: string[];
  theme_confidence: Record<string, number>;
  debug_trace?: string[];
}

export interface DatasetItemFromAPI {
  dataset_id: string;
  title: string;
  title_original?: string;
  title_en?: string;
  provider: string;
  themes: string[];
  matching_themes?: string[];
  focused_matching_themes?: string[];
  spatial_coverage: string;
  spatial_resolution: string;
  update_frequency: string;
  last_updated: string;
  publication_date?: string;
  access_type: "open" | "restricted" | "request";
  formats: string[];
  resources?: DatasetResourceFromAPI[];
  provenance?: string | null;
  data_types?: string[];
  quality: {
    completeness: number;
    timeliness: number | string;
    consistency: number | string;
    documentation: number | string;
  };
  description: string;
  description_original?: string;
  description_en?: string;
  reason_recommended?: string;
  relevance_score?: number;
  compatibility_score?: number;
  compatibility_reason?: string;
  semantic_score?: number;
  compatibility_band?: CompatibilityBand;
  compatibility_evidence?: CompatibilityEvidence;
  is_essential?: boolean;
  source?: string;
  api_url?: string;
  primary_category?: string;
  categories?: Array<Record<string, number>>;
  category_confidence?: number;
  category_method?: string;
  schema_fields?: DatasetPreviewColumn[];
  preview_available?: boolean;
}

export interface DatasetResourceFromAPI {
  id?: string;
  name: string;
  description?: string;
  format?: string;
  url: string;
}

export interface RecommendResponse {
  recommendations: DatasetItemFromAPI[];
  data_gaps: Array<Record<string, unknown>>;
  quality_risks: Array<Record<string, unknown>>;
  debug_trace?: string[];
}

export interface TopicSuggestResponse {
  parsed_indicator: {
    geographic_level: string;
    time_frame: string;
    population: string;
    attributes: string[];
  };
  topics: string[];
  theme_confidence: Record<string, number>;
  method: string;
  debug_trace: string[];
}

export interface PackageCreateRequest {
  dataset_ids?: string[];
  query?: string;
  limit?: number;
  dataset_notes?: Record<string, string>;
}

export interface DatasetPreviewColumn {
  name: string;
  inferred_type: string;
  description: string;
}

export interface DatasetPreviewResponse {
  dataset_id: string;
  columns: DatasetPreviewColumn[];
  rows: Array<Record<string, unknown>>;
  source_url: string;
  resource_name: string;
  resource_format: string;
  message?: string | null;
}

export interface PackageManifestResponse {
  package_name: string;
  dataset_count: number;
  datasets: Array<Record<string, unknown>>;
}

export interface DatasetCatalogResponse {
  datasets: DatasetItemFromAPI[];
  total_count: number;
}

export interface ImportSourceResponse {
  imported_count: number;
  requested_source: string;
  mapped_source: string;
  session_dir: string;
  dataset_ids: string[];
}

export interface ClearImportSourceResponse {
  cleared_count: number;
  requested_source?: string | null;
  mapped_source?: string | null;
  dataset_ids: string[];
}

export interface CancelBackgroundJobsResponse {
  cancelled_sources: string[];
}

export interface FullCatalogImportProgressResponse {
  source: string;
  requested_source: string;
  status: "idle" | "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  fetched_count: number;
  normalized_count: number;
  total_count?: number | null;
  current_page?: number | null;
  current_offset?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  last_error?: string | null;
  raw_snapshot_count: number;
  normalized_cache_path: string;
  manifest_path: string;
  is_stale: boolean;
  cache_updated_at?: string | null;
}

const CLIENT_THEME_KEYWORDS: Record<string, string[]> = {
  accessibility_proximity: [
    "accessibility",
    "access",
    "proximity",
    "service area",
    "service areas",
    "catchment",
    "catchment area",
    "catchment areas",
    "walking distance",
    "walking time",
    "travel time",
    "15 minute",
    "15-minute",
    "10 minute",
    "10-minute",
    "5 minute",
    "5-minute",
    "walkability",
    "nearby",
    "distance",
    "within walking",
    "near schools",
    "near parks",
    "near clinics",
  ],
  transport_networks: [
    "transport",
    "bus",
    "metro",
    "rail",
    "traffic",
    "mobility",
    "cycling",
    "cyclist",
    "bicycle",
    "bicycles",
    "bike",
    "bike lane",
    "bike lanes",
    "cycle lane",
    "cycle lanes",
    "carril bici",
    "pedestrian",
    "sidewalk",
    "sidewalks",
    "transit",
    "tram",
    "station",
    "stations",
  ],
  population: [
    "population",
    "resident",
    "residents",
    "people",
    "inhabitants",
    "households",
    "older adults",
    "older adult",
    "seniors",
    "senior citizens",
    "elderly",
  ],
  geographic_boundaries: [
    "administrative boundary",
    "administrative boundaries",
    "district boundary",
    "district boundaries",
    "neighborhood boundary",
    "neighborhood boundaries",
    "boundary",
    "boundaries",
    "polygon",
    "polygons",
    "shapefile",
    "census section",
    "census tract",
  ],
  housing_affordability: [
    "housing",
    "residential",
    "rent",
    "affordability",
    "homes",
    "households",
  ],
  green_space: [
    "green space",
    "green spaces",
    "green area",
    "green areas",
    "parks",
    "park",
    "public park",
    "open space",
    "tree canopy",
    "canopy cover",
    "shade",
    "shaded",
    "vegetation",
    "urban forest",
    "playground",
    "playgrounds",
    "garden",
    "gardens",
    "zonas verdes",
    "zona verde",
    "parques",
    "parque",
    "jardines",
    "arbolado",
    "sombra",
  ],
  water_management: [
    "water management",
    "water",
    "stormwater",
    "storm water",
    "wastewater",
    "waste water",
    "drainage",
    "sewer",
    "sewers",
    "sewerage",
    "irrigation",
    "flood",
    "flooding",
    "flood risk",
    "reservoir",
    "drinking water",
    "agua",
    "gestion del agua",
    "gestión del agua",
    "saneamiento",
    "alcantarillado",
    "drenaje",
    "riego",
    "inundacion",
    "inundación",
  ],
  air_quality: [
    "air quality",
    "pollution",
    "emission",
    "emissions",
    "low-emission",
    "low emission",
    "pm2.5",
    "no2",
    "nitrogen dioxide",
  ],
  heat_exposure: [
    "heat",
    "urban heat",
    "heat island",
    "urban heat island",
    "heat exposure",
    "extreme heat",
    "temperature",
    "surface temperature",
    "thermal comfort",
    "cooling",
    "calor",
    "isla de calor",
    "temperatura",
  ],
  land_use: [
    "land use",
    "zoning",
    "parcel",
    "parcels",
    "cadastre",
    "cadastral",
    "building footprint",
    "building footprints",
    "urban form",
    "built environment",
    "impervious",
    "impervious surface",
    "sealed surface",
    "building density",
    "floor area",
  ],
  socioeconomic_context: [
    "socioeconomic",
    "socio-economic",
    "income",
    "deprivation",
    "vulnerability",
    "poverty",
    "equity",
    "inequality",
    "deprivation",
    "heat vulnerability",
    "climate vulnerability",
  ],
  employment: ["employment", "jobs", "unemployment", "labor", "workforce"],
  health: [
    "health",
    "healthcare",
    "health care",
    "hospital",
    "hospitals",
    "clinic",
    "clinics",
    "primary care",
    "health center",
    "health centre",
    "centro de salud",
    "wellbeing",
  ],
  education: [
    "education",
    "school",
    "schools",
    "student",
    "students",
    "teacher",
    "university",
    "kindergarten",
    "daycare",
    "childcare",
    "nursery",
    "colegio",
    "colegios",
    "escuela",
    "escuelas",
    "centro educativo",
    "centros educativos",
  ],
};

const CLIENT_POPULATION_KEYWORDS: Array<{ label: string; keywords: string[] }> = [
  {
    label: "Older adults",
    keywords: ["older adult", "older adults", "senior", "seniors", "senior citizens", "elderly"],
  },
  {
    label: "Residents",
    keywords: ["resident", "residents", "inhabitant", "inhabitants"],
  },
  {
    label: "People",
    keywords: ["people", "persons"],
  },
  {
    label: "Population",
    keywords: ["population"],
  },
  {
    label: "Households",
    keywords: ["household", "households"],
  },
  {
    label: "Workers",
    keywords: ["worker", "workers", "employees", "workforce"],
  },
  {
    label: "Businesses",
    keywords: ["business", "businesses"],
  },
];

const CLIENT_RELATIVE_TIME_PATTERN =
  /\b(?:for|over|during|within|in)?\s*(?:the\s+)?(?:last|past|previous)\s+(\d{1,2})\s+(day|days|week|weeks|month|months|year|years)\b/i;
const CLIENT_EXPLICIT_YEAR_PATTERN =
  /\b((?:19|20)\d{2})(?:\s*(?:-|\u2013|\u2014|to|through|until)\s*((?:19|20)\d{2}))?\b/i;

// =============================================================================
// API Client Functions
// =============================================================================

/**
 * Analyze an indicator description and extract themes
 * 
 * POST /analyze
 */
export async function analyzeIndicator(
  indicatorText: string,
  options: { signal?: AbortSignal } = {}
): Promise<AnalyzeResponse> {
  const url = `${API_BASE_URL}/analyze`;
  const controller = new AbortController();
  const start = performance.now();
  let didTimeout = false;

  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, ANALYZE_TIMEOUT_MS);

  const handleCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", handleCallerAbort, { once: true });

  logApiDebug("POST /analyze start", { url, timeoutMs: ANALYZE_TIMEOUT_MS });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        indicator_text: indicatorText,
      }),
    });
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - start);
    if (err instanceof Error && err.name === "AbortError") {
      const detail = didTimeout
        ? "Analysis took longer than 30 seconds. The local API may be reloading or busy; please try again in a moment."
        : "Analysis was canceled.";
      logApiDebug("POST /analyze aborted", { url, elapsedMs, didTimeout });
      throw new Error(detail);
    }

    logApiDebug("POST /analyze failed", { url, elapsedMs, error: String(err) });
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", handleCallerAbort);
  }

  if (!response.ok) {
    const detail = await safeReadError(response);
    logApiDebug("POST /analyze failed", {
      url,
      status: response.status,
      elapsedMs: Math.round(performance.now() - start),
      detail,
    });
    throw new Error(detail || "Failed to analyze planning question");
  }

  const payload = await response.json();
  logApiDebug("POST /analyze success", {
    url,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
  });

  return payload;
}

/**
 * Get dataset recommendations for an indicator
 * 
 * POST /recommend
 */
export async function getRecommendations(
  indicatorText: string,
  extractedThemes?: string[],
  options: { signal?: AbortSignal } = {}
): Promise<RecommendResponse> {
  const response = await fetch(`${API_BASE_URL}/recommend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      indicator_text: indicatorText,
      extracted_themes: extractedThemes,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to get recommendations");
  }

  return response.json();
}

/**
 * Suggest topics for an indicator description
 *
 * POST /topics/suggest
 */
export async function suggestTopics(indicatorText: string): Promise<TopicSuggestResponse> {
  const response = await fetch(`${API_BASE_URL}/topics/suggest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      indicator_text: indicatorText,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to suggest topics");
  }

  return response.json();
}

/**
 * Get the full dataset catalog, optionally including API-imported datasets
 * @param includeApis - Include API-sourced datasets. Default: false
 * @param sourceFilter - Optional filter to return only datasets from a specific source
 */
export async function getFullCatalog(includeApis = false, sourceFilter?: string): Promise<DatasetCatalogResponse> {
  let url = `${API_BASE_URL}/datasets?include_apis=${includeApis ? "true" : "false"}`;
  if (sourceFilter) {
    url += `&source=${encodeURIComponent(sourceFilter)}`;
  }
  const start = performance.now();
  logApiDebug("GET /datasets start", { includeApis, sourceFilter, url });

  const response = await fetch(
    url,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    logApiDebug("GET /datasets failed", {
      includeApis,
      sourceFilter,
      url,
      status: response.status,
      elapsedMs: Math.round(performance.now() - start),
      detail,
    });
    throw new Error(detail || "Failed to fetch full catalog");
  }

  const payload = (await response.json()) as DatasetCatalogResponse;
  const sourceDistribution: Record<string, number> = {};
  for (const dataset of payload.datasets || []) {
    const source = dataset.source || "missing";
    sourceDistribution[source] = (sourceDistribution[source] || 0) + 1;
  }

  logApiDebug("GET /datasets success", {
    includeApis,
    sourceFilter,
    url,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    datasetCount: payload.datasets?.length || 0,
    totalCount: payload.total_count,
    sourceDistribution,
  });

  return payload;
}

/**
 * Trigger server-side import of a named API source.
 */
export async function importApiSource(
  source: string,
  options: { signal?: AbortSignal } = {}
): Promise<ImportSourceResponse> {
  const url = `${API_BASE_URL}/import/${encodeURIComponent(source)}`;
  const start = performance.now();
  logApiDebug("POST /import start", { source, url });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    logApiDebug("POST /import failed", {
      source,
      url,
      status: response.status,
      elapsedMs: Math.round(performance.now() - start),
      detail,
    });
    throw new Error(detail || "Failed to import API source");
  }

  const payload = await response.json();
  logApiDebug("POST /import success", {
    source,
    url,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    importedCount: payload?.imported_count,
    requestedSource: payload?.requested_source,
    mappedSource: payload?.mapped_source,
  });
  return payload;
}

/**
 * Clear imported datasets for one source from the active backend runtime catalog.
 */
export async function clearImportedSource(source: string): Promise<ClearImportSourceResponse> {
  const url = `${API_BASE_URL}/import/${encodeURIComponent(source)}`;
  const start = performance.now();
  logApiDebug("DELETE /import start", { source, url });

  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    logApiDebug("DELETE /import failed", {
      source,
      url,
      status: response.status,
      elapsedMs: Math.round(performance.now() - start),
      detail,
    });
    throw new Error(detail || "Failed to clear imported source");
  }

  const payload = (await response.json()) as ClearImportSourceResponse;
  logApiDebug("DELETE /import success", {
    source,
    url,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    clearedCount: payload.cleared_count,
  });
  return payload;
}

/**
 * Start or refresh a background full-catalog import for one source.
 */
export async function cancelActiveBackgroundJobs(): Promise<CancelBackgroundJobsResponse> {
  const url = `${API_BASE_URL}/import/full/cancel-active`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || "Failed to cancel background import jobs");
  }

  return response.json();
}

export async function startFullCatalogImport(
  source: string,
  options: { signal?: AbortSignal } = {}
): Promise<FullCatalogImportProgressResponse> {
  const url = `${API_BASE_URL}/import/${encodeURIComponent(source)}/full`;
  const start = performance.now();
  logApiDebug("POST /import/full start", { source, url });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    logApiDebug("POST /import/full failed", {
      source,
      url,
      status: response.status,
      elapsedMs: Math.round(performance.now() - start),
      detail,
    });
    throw new Error(detail || "Failed to start full catalog import");
  }

  const payload = (await response.json()) as FullCatalogImportProgressResponse;
  logApiDebug("POST /import/full success", {
    source,
    url,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    importStatus: payload.status,
    fetchedCount: payload.fetched_count,
    normalizedCount: payload.normalized_count,
  });
  return payload;
}

/**
 * Rebuild the normalized full-catalog local data from existing raw snapshots.
 */
export async function rebuildFullCatalogCache(
  source: string,
  options: { signal?: AbortSignal } = {}
): Promise<FullCatalogImportProgressResponse> {
  const url = `${API_BASE_URL}/import/${encodeURIComponent(source)}/full/rebuild`;
  const start = performance.now();
  logApiDebug("POST /import/full/rebuild start", { source, url });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    logApiDebug("POST /import/full/rebuild failed", {
      source,
      url,
      status: response.status,
      elapsedMs: Math.round(performance.now() - start),
      detail,
    });
    throw new Error(detail || "Failed to rebuild full catalog local data");
  }

  const payload = (await response.json()) as FullCatalogImportProgressResponse;
  logApiDebug("POST /import/full/rebuild success", {
    source,
    url,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    importStatus: payload.status,
    normalizedCount: payload.normalized_count,
  });
  return payload;
}

/**
 * Read background full-catalog import progress for one source.
 */
export async function getFullCatalogImportProgress(
  source: string,
  options: { signal?: AbortSignal } = {}
): Promise<FullCatalogImportProgressResponse> {
  const url = `${API_BASE_URL}/import/${encodeURIComponent(source)}/full/progress`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || "Failed to get full catalog import progress");
  }

  return response.json();
}

/**
 * Fetch a lazy schema and row preview for one dataset.
 */
export async function getDatasetPreview(datasetId: string, rows = 5): Promise<DatasetPreviewResponse> {
  const response = await fetch(
    `${API_BASE_URL}/datasets/${encodeURIComponent(datasetId)}/preview?rows=${rows}`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || "Failed to fetch dataset preview");
  }

  return translateDatasetPreview(await response.json());
}

/**
 * Analyze selected datasets against the indicator using metadata, schema, and preview rows.
 */
export async function analyzeSelectedDatasetFit(
  request: DatasetFitAnalysisRequest
): Promise<DatasetFitAnalysis> {
  const start = performance.now();
  const body = JSON.stringify(request);
  logApiDebug("POST /datasets/analyze-fit start", {
    datasetCount: request.dataset_ids?.length || 0,
    snapshotCount: request.dataset_snapshots?.length || 0,
    requestBytes: body.length,
  });

  const response = await fetch(`${API_BASE_URL}/datasets/analyze-fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    logApiDebug("POST /datasets/analyze-fit failed", {
      status: response.status,
      elapsedMs: Math.round(performance.now() - start),
      detail,
    });
    throw new Error(detail || "Failed to analyze selected datasets");
  }

  const payload = await response.json();
  logApiDebug("POST /datasets/analyze-fit success", {
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    datasetCount: payload.datasets?.length || 0,
  });
  return payload;
}

/**
 * Create a downloadable dataset package (zip)
 *
 * POST /package/create
 */
export async function createDatasetPackage(request: PackageCreateRequest): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/package/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to create dataset package");
  }

  return response.blob();
}

/**
 * Create the same JSON manifest that is bundled inside the package zip.
 */
export async function createDatasetPackageManifest(
  request: PackageCreateRequest
): Promise<PackageManifestResponse> {
  const response = await fetch(`${API_BASE_URL}/package/manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || "Failed to create package manifest");
  }

  return response.json();
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert the backend dataset contract into the UI Dataset type.
 *
 * This is the one place where backend snake_case fields, numeric quality
 * values, translated catalog text, and display labels become frontend state.
 */
export function convertApiDatasetToReactDataset(
  apiDataset: DatasetItemFromAPI
): Dataset {
  const sourceCategoryMap: Record<string, string> = {
    madrid_ckan: "Madrid CKAN",
    datos_gob_es: "datos.gob.es",
  };

  const fallbackCategory = sourceCategoryMap[apiDataset.source || ""] || "Uncategorized";
  const completeness = normalizeCompletenessPercent(apiDataset.quality.completeness);
  const titleOriginal = apiDataset.title_original || apiDataset.title;
  const titleEn = apiDataset.title_en || apiDataset.title || translateCatalogText(titleOriginal);
  const descriptionOriginal = apiDataset.description_original || apiDataset.description;
  const descriptionEn = apiDataset.description_en || apiDataset.description || translateCatalogText(descriptionOriginal);

  return {
    id: apiDataset.dataset_id,
    name: titleEn,
    nameOriginal: titleOriginal,
    nameEn: titleEn,
    provider: translateCatalogText(apiDataset.provider),
    source: apiDataset.source || "",
    apiUrl: apiDataset.api_url || "",
    formats: formatFileTypeLabels(apiDataset.formats || []),
    resources: normalizeDatasetResources(apiDataset.resources || []),
    provenance: apiDataset.provenance || inferClientProvenance(apiDataset),
    dataTypes: apiDataset.data_types?.length
      ? apiDataset.data_types
      : inferClientDataTypes(apiDataset),
    spatialCoverage: translateCatalogText(apiDataset.spatial_coverage),
    spatialResolution: formatSpatialResolution(
      translateCatalogText(apiDataset.spatial_coverage),
      translateCatalogText(apiDataset.spatial_resolution)
    ),
    updateFrequency: translateCatalogText(apiDataset.update_frequency),
    lastUpdate: normalizeDisplayDate(apiDataset.last_updated),
    publicationDate: normalizeDisplayDate(apiDataset.publication_date),
    accessType: apiDataset.access_type,
    theme: apiDataset.themes[0] || "general",
    themes: apiDataset.themes || [],
    matchingThemes: apiDataset.matching_themes || [],
    focusedMatchingThemes: apiDataset.focused_matching_themes || [],
    category: apiDataset.primary_category || fallbackCategory,
    categories: apiDataset.categories || [],
    categoryConfidence: apiDataset.category_confidence,
    categoryMethod: apiDataset.category_method,
    schemaFields: translateSchemaFields(apiDataset.schema_fields || []),
    previewAvailable: !!apiDataset.preview_available,
    essential: apiDataset.is_essential ?? (apiDataset.relevance_score ?? 0) > 0.7,
    relevanceScore: apiDataset.relevance_score,
    compatibilityScore: apiDataset.compatibility_score,
    compatibilityReason: apiDataset.compatibility_reason,
    semanticScore: apiDataset.semantic_score,
    compatibilityBand: apiDataset.compatibility_band,
    compatibilityEvidence: apiDataset.compatibility_evidence,
    quality: {
      completeness,
      timeliness: normalizeTimeliness(apiDataset.quality.timeliness),
      consistency: normalizeConsistency(apiDataset.quality.consistency),
      documentation: normalizeDocumentation(apiDataset.quality.documentation),
    },
    description: descriptionEn,
    descriptionOriginal,
    descriptionEn,
    usageExplanation: translateCatalogText(apiDataset.reason_recommended || "Relevant to your indicator"),
  };
}

function normalizeDatasetResources(resources: DatasetResourceFromAPI[]) {
  const seen = new Set<string>();
  return resources
    .map((resource) => ({
      id: resource.id || "",
      name: resource.name || "Source file",
      description: resource.description || "",
      format: formatFileTypeLabel(resource.format),
      url: resource.url || "",
    }))
    .filter((resource) => {
      if (!resource.url || seen.has(resource.url)) return false;
      seen.add(resource.url);
      return true;
    });
}

function inferClientProvenance(apiDataset: DatasetItemFromAPI): string {
  if (apiDataset.source === "madrid_ckan" || apiDataset.source === "datos_gob_es") {
    return "Official Government";
  }
  const text = [
    apiDataset.source,
    apiDataset.provider,
    apiDataset.title,
    apiDataset.description,
    ...(apiDataset.themes || []),
  ].join(" ").toLowerCase();
  if (/\b(crowd|crowdsourced|openstreetmap|osm)\b/.test(text)) return "Community-Generated";
  if (/\b(participatory|participacion|participación)\b/.test(text)) return "Participatory Data";
  if (/\b(ngo|non[- ]?profit|foundation|fundaci[oó]n|asociaci[oó]n)\b/.test(text)) return "Non-Profit / NGO";
  if (/\b(research|university|universidad|institute|instituto|observatory|observatorio)\b/.test(text)) return "Research Organization";
  return "Catalog Metadata";
}

function inferClientDataTypes(apiDataset: DatasetItemFromAPI): string[] {
  const formats = new Set(formatFileTypeLabels(apiDataset.formats || []));
  const text = [
    apiDataset.provider,
    apiDataset.title,
    apiDataset.description,
    apiDataset.primary_category,
    ...(apiDataset.themes || []),
    ...(apiDataset.formats || []),
  ].join(" ").toLowerCase();
  const tags: string[] = [];
  const hasQualitative = /\b(qualitative|interviews?|perception|comments?|satisfaction|narrative|complaint)\b/.test(text);
  const hasQuantitative =
    ["CSV", "TSV", "XLS", "XLSX", "JSON", "GEOJSON", "SHP", "KML"].some((format) => formats.has(format)) ||
    Boolean(apiDataset.schema_fields?.length);

  if (/\b(surveys?|encuestas?)\b/.test(text)) tags.push("Survey Data");
  if (/\b(crowd|crowdsourced|openstreetmap|osm)\b/.test(text)) tags.push("Crowdsourced");
  if (/\b(participatory|participacion|participación)\b/.test(text)) tags.push("Participatory Data");
  tags.unshift(hasQualitative && hasQuantitative ? "Mixed Methods" : hasQualitative ? "Qualitative" : "Quantitative");

  return Array.from(new Set(tags));
}

function translateDatasetPreview(payload: DatasetPreviewResponse): DatasetPreviewResponse {
  return {
    ...payload,
    resource_name: translateCatalogText(payload.resource_name),
    resource_format: formatFileTypeLabel(payload.resource_format),
    columns: translateSchemaFields(payload.columns || []),
  };
}

function translateSchemaFields<T extends { name: string; inferred_type: string; description: string }>(
  fields: T[]
): T[] {
  return fields.map((field) => ({
    ...field,
    name: translateCatalogText(field.name),
    description: translateCatalogText(field.description),
  }));
}

function normalizeDisplayDate(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "Unknown";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}-${month}-${year}`;
  }

  const monthLookup: Record<string, string> = {
    ene: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    sep: "09",
    sept: "09",
    oct: "10",
    nov: "11",
    dic: "12",
  };
  const localizedMatch = raw.match(/\b(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d{4})\b/);
  if (localizedMatch) {
    const [, day, monthLabel, year] = localizedMatch;
    const normalizedMonth = monthLookup[monthLabel.slice(0, 4).toLowerCase()] || monthLookup[monthLabel.slice(0, 3).toLowerCase()];
    if (normalizedMonth) {
      return `${day.padStart(2, "0")}-${normalizedMonth}-${year}`;
    }
  }

  return raw;
}

export function extractYearFromDate(dateStr: string | undefined): string {
  const normalized = normalizeDisplayDate(dateStr);
  if (normalized === "Unknown") return "Unknown";
  
  const parts = normalized.split('-');
  if (parts.length >= 3) {
    return parts[2]; // DD-MM-YYYY format, year is at index 2
  }
  
  const isoMatch = (dateStr || '').trim().match(/^(\d{4})/);
  return isoMatch ? isoMatch[1] : normalized;
}

function normalizeCompletenessPercent(value: number | string | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.round(Math.max(0, Math.min(100, percent)));
}

function normalizeQualityNumber(value: number | string | undefined, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric <= 1 ? numeric : numeric / 100;
}

function normalizeTimeliness(value: number | string | undefined): Dataset["quality"]["timeliness"] {
  if (typeof value === "string" && ["recent", "moderate", "outdated"].includes(value.toLowerCase())) {
    return value.toLowerCase() as Dataset["quality"]["timeliness"];
  }
  const score = normalizeQualityNumber(value, 0.7);
  if (score >= 0.7) return "recent";
  if (score >= 0.45) return "moderate";
  return "outdated";
}

function normalizeConsistency(value: number | string | undefined): Dataset["quality"]["consistency"] {
  if (typeof value === "string" && ["high", "medium", "low"].includes(value.toLowerCase())) {
    return value.toLowerCase() as Dataset["quality"]["consistency"];
  }
  const score = normalizeQualityNumber(value, 0.7);
  if (score >= 0.82) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function normalizeDocumentation(value: number | string | undefined): Dataset["quality"]["documentation"] {
  if (typeof value === "string" && ["excellent", "good", "limited"].includes(value.toLowerCase())) {
    return value.toLowerCase() as Dataset["quality"]["documentation"];
  }
  const score = normalizeQualityNumber(value, 0.7);
  if (score >= 0.88) return "excellent";
  if (score >= 0.68) return "good";
  return "limited";
}

/**
 * Convert API response to IndicatorRequest for store
 */
export function convertApiResponseToIndicatorRequest(
  indicatorText: string,
  analyzeResponse: AnalyzeResponse
): IndicatorRequest {
  // The backend is authoritative, but these client-side inferences fill small
  // UI gaps immediately for phrases that users keep testing manually.
  const inferredThemes = inferClientThemesFromIndicator(indicatorText);
  const inferredPopulation = inferClientPopulationFromIndicator(indicatorText);
  const inferredTimeFrame = inferClientTimeFrameFromIndicator(indicatorText);
  const attributes = mergeThemeIds(
    analyzeResponse.parsed_indicator.attributes,
    analyzeResponse.extracted_themes,
    inferredThemes
  );

  return {
    description: indicatorText,
    geographicLevel: formatGeographicLevel(analyzeResponse.parsed_indicator.geographic_level),
    timeFrame: normalizeTimeFrame(analyzeResponse.parsed_indicator.time_frame, inferredTimeFrame),
    population: analyzeResponse.parsed_indicator.population || inferredPopulation,
    attributes,
  };
}

export function normalizeAnalyzeResponse(
  indicatorText: string,
  analyzeResponse: AnalyzeResponse
): AnalyzeResponse {
  // Merge backend extraction with lightweight client inference so the overview
  // and recommendation steps share the same selected-theme vocabulary.
  const inferredThemes = inferClientThemesFromIndicator(indicatorText);
  const inferredPopulation = inferClientPopulationFromIndicator(indicatorText);
  const inferredTimeFrame = inferClientTimeFrameFromIndicator(indicatorText);
  const extractedThemes = mergeThemeIds(
    analyzeResponse.extracted_themes,
    analyzeResponse.parsed_indicator.attributes,
    inferredThemes
  );
  const attributes = mergeThemeIds(
    analyzeResponse.parsed_indicator.attributes,
    extractedThemes
  );
  const themeConfidence = { ...analyzeResponse.theme_confidence };

  extractedThemes.forEach((themeId) => {
    if (themeConfidence[themeId] === undefined) {
      themeConfidence[themeId] = 0.55;
    }
  });

  return {
    ...analyzeResponse,
    extracted_themes: extractedThemes,
    theme_confidence: themeConfidence,
    parsed_indicator: {
      ...analyzeResponse.parsed_indicator,
      geographic_level: formatGeographicLevel(analyzeResponse.parsed_indicator.geographic_level),
      time_frame: normalizeTimeFrame(analyzeResponse.parsed_indicator.time_frame, inferredTimeFrame),
      population: analyzeResponse.parsed_indicator.population || inferredPopulation,
      attributes,
    },
  };
}

export function mergeThemeIds(...themeLists: Array<Array<string | undefined> | undefined>) {
  const result: string[] = [];
  const seen = new Set<string>();

  themeLists.flatMap((list) => list || []).forEach((themeId) => {
    const normalized = normalizeThemeId(themeId || "");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

export function inferClientThemesFromIndicator(indicatorText: string) {
  const normalizedText = indicatorText.toLowerCase();
  const matches: string[] = [];

  Object.entries(CLIENT_THEME_KEYWORDS).forEach(([themeId, keywords]) => {
    const hasMatch = keywords.some((keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      if (normalizedKeyword.includes(" ")) {
        return normalizedText.includes(normalizedKeyword);
      }
      return new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`).test(normalizedText);
    });

    if (hasMatch) {
      matches.push(themeId);
    }
  });

  return matches;
}

export function inferClientPopulationFromIndicator(indicatorText: string) {
  const normalizedText = indicatorText.toLowerCase();
  const match = CLIENT_POPULATION_KEYWORDS.find(({ keywords }) => {
    return keywords.some((keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      return new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`).test(normalizedText);
    });
  });

  return match?.label || "";
}

export function inferClientTimeFrameFromIndicator(indicatorText: string) {
  const relativeMatch = CLIENT_RELATIVE_TIME_PATTERN.exec(indicatorText);
  if (relativeMatch) {
    const amount = relativeMatch[1];
    const unit = relativeMatch[2].toLowerCase().replace(/s$/, "");
    const plural = amount === "1" ? "" : "s";
    return `Last ${amount} ${unit}${plural}`;
  }

  const yearMatch = CLIENT_EXPLICIT_YEAR_PATTERN.exec(indicatorText);
  if (!yearMatch) return "";

  const startYear = yearMatch[1];
  const endYear = yearMatch[2];
  if (endYear && endYear !== startYear) {
    return `${startYear}-${endYear}`;
  }
  return startYear;
}

function normalizeTimeFrame(timeFrame: string, fallback: string) {
  const trimmed = (timeFrame || "").trim();
  if (!trimmed || ["unknown", "not specified", "n/a"].includes(trimmed.toLowerCase())) {
    return fallback || trimmed;
  }

  const rangeMatch = /^((?:19|20)\d{2})\s*(?:-|\u2013|\u2014|to|through|until)\s*((?:19|20)\d{2})$/i.exec(trimmed);
  if (rangeMatch) {
    return `${rangeMatch[1]}-${rangeMatch[2]}`;
  }

  const yearMatch = /^((?:19|20)\d{2})$/.exec(trimmed);
  if (yearMatch) {
    return yearMatch[1];
  }

  const match = /^last\s+(\d{1,2})\s+(day|week|month|year)s?$/i.exec(trimmed);
  if (match) {
    const amount = match[1];
    const unit = match[2].toLowerCase();
    const plural = amount === "1" ? "" : "s";
    return `Last ${amount} ${unit}${plural}`;
  }

  return trimmed;
}

function normalizeThemeId(themeId: string) {
  return themeId.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
