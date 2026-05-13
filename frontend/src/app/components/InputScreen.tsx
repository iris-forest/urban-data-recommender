import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Lightbulb,
  AlertCircle,
  Download,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  CalendarClock,
  Layers3,
  Loader,
  RefreshCw,
  Shuffle,
} from "lucide-react";
import { appStore } from "../store";
import {
  analyzeIndicator,
  convertApiResponseToIndicatorRequest,
  clearImportedSource,
  FullCatalogImportProgressResponse,
  getFullCatalogImportProgress,
  importApiSource,
  normalizeAnalyzeResponse,
  rebuildFullCatalogCache,
  startFullCatalogImport,
} from "../api";
import { Switch } from "./ui/switch";
import { Progress } from "./ui/progress";

const AVAILABLE_APIS = [
  {
    id: "madrid-ckan",
    name: "Madrid CKAN Data Portal",
    description:
      "Official Madrid city datasets including transport, population, housing, and urban planning data",
    url: "https://datos.madrid.es",
    datasetsCount: "500+",
    categories: ["Transport", "Population", "Housing", "Urban Planning"],
  },
  {
    id: "datos-gob-es",
    name: "Datos.gob.es",
    description:
      "Spanish national open data portal with regional and local datasets",
    url: "https://datos.gob.es",
    datasetsCount: "10,000+",
    categories: ["National Data", "Regional Data", "Census"],
  },
  {
    id: "geoportal",
    name: "IGN Geoportal",
    description:
      "Geographic and cartographic data from Spain's National Geographic Institute",
    url: "https://www.ign.es",
    datasetsCount: "1,000+",
    categories: ["Maps", "Boundaries", "Geographic"],
  },
];

// Example generation is deterministic: each click advances the counter against
// a fixed seed so the same sequence can be reused for manual self-testing.
const EXAMPLE_RANDOM_SEED = 20260510;

const EXAMPLE_SUBJECTS = [
  "Share of residents",
  "Percentage of households",
  "Number of schools",
  "Average walking distance for older adults",
  "Green space area per resident",
  "Density of public facilities",
  "Share of residential buildings",
  "Cycling network coverage",
];

const EXAMPLE_CONDITIONS = [
  "within 5 minutes walking distance from a bus stop",
  "within 300 meters of a public park",
  "served by protected cycling lanes within 250 meters",
  "located in areas with high summer heat exposure",
  "within 10 minutes walking distance of primary care facilities",
  "near streets with high traffic collision rates",
  "within low-emission zones",
  "with access to metro or commuter rail stations within 800 meters",
];

const EXAMPLE_GEOGRAPHIES = [
  "by neighborhood",
  "by district",
  "by census tract",
  "around school catchment areas",
  "along major transit corridors",
  "for each administrative district",
];

const EXAMPLE_TIME_FRAMES = [
  "using the latest available data",
  "for the current year",
  "for the 2024 baseline",
  "for the last 12 months",
  "compared with the previous year",
];

export function InputScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [description, setDescription] = useState("");
  const [exampleGenerationCount, setExampleGenerationCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(() => getTabFromSearch(location.search));
  const [importedApis, setImportedApis] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState<string | null>(null);
  const [isStartingFullImport, setIsStartingFullImport] = useState<string | null>(null);
  const [isRebuildingFullImport, setIsRebuildingFullImport] = useState<string | null>(null);
  const [expandedApis, setExpandedApis] = useState<Set<string>>(new Set());
  const [sourceLastUpdated, setSourceLastUpdated] = useState<Record<string, string>>({});
  const [fullImportProgress, setFullImportProgress] = useState<
    Record<string, FullCatalogImportProgressResponse>
  >({});
  const [sourceImportStatus, setSourceImportStatus] = useState<
    Record<string, { state: "idle" | "success" | "error"; message: string; count?: number }>
  >({});
  const [activeApiSources, setActiveApiSources] = useState<Set<string>>(() => {
    const saved = appStore.getActiveApiSources();
    if (saved.length > 0) return new Set(saved);
    return new Set(AVAILABLE_APIS.filter((api) => api.id !== "geoportal").map((api) => api.id));
  });

  // First-run source defaults keep supported catalogs active while clearly
  // leaving unsupported sources disabled.
  useEffect(() => {
    if (appStore.getActiveApiSources().length === 0) {
      AVAILABLE_APIS.forEach((api) => appStore.setApiSourceActive(api.id, api.id !== "geoportal"));
    }
  }, []);

  useEffect(() => {
    setActiveTab(getTabFromSearch(location.search));
  }, [location.search]);

  const isApiSupportedForImport = (apiId: string) => {
    return apiId === "madrid-ckan" || apiId === "datos-gob-es";
  };

  const isFullImportRunning = (apiId: string) => {
    const status = fullImportProgress[apiId]?.status;
    return status === "queued" || status === "running";
  };

  const getFullImportProgressValue = (progress?: FullCatalogImportProgressResponse) => {
    if (!progress) return 0;
    if (progress.status === "completed") return 100;
    if (progress.total_count && progress.total_count > 0) {
      return Math.min(99, Math.round((progress.fetched_count / progress.total_count) * 100));
    }
    if (progress.status === "queued") return 2;
    if (progress.status === "running") {
      return Math.min(95, Math.max(8, progress.raw_snapshot_count * 4));
    }
    return 0;
  };

  const getFullImportStatusLabel = (progress?: FullCatalogImportProgressResponse) => {
    if (!progress || progress.status === "idle") return "Not saved locally";
    if (progress.status === "queued") return "Queued";
    if (progress.status === "running") return "Importing";
    if (progress.status === "completed") return progress.is_stale ? "Saved locally, update recommended" : "Saved locally";
    if (progress.status === "failed") return "Failed";
    return progress.status;
  };

  const isFullCatalogImported = (progress?: FullCatalogImportProgressResponse) => {
    return progress?.status === "completed" && (progress.normalized_count ?? 0) > 0;
  };

  const getProgressDateLabel = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  };

  const getLocalCatalogUpdatedLabel = (progress?: FullCatalogImportProgressResponse) => {
    return getProgressDateLabel(progress?.cache_updated_at || progress?.finished_at);
  };

  const getSourceLastUpdatedLabel = (
    apiId: string,
    progress?: FullCatalogImportProgressResponse
  ) => {
    if (sourceLastUpdated[apiId]) return sourceLastUpdated[apiId];
    if (progress?.status === "completed") {
      return getLocalCatalogUpdatedLabel(progress) || "Saved locally";
    }
    if (progress?.status === "queued" || progress?.status === "running") return "Import in progress";
    if (progress?.status === "failed") return "Import failed";
    return "Not synced yet";
  };

  const refreshFullImportProgress = async (apiId: string) => {
    if (!isApiSupportedForImport(apiId)) return;
    const progress = await getFullCatalogImportProgress(apiId);
    setFullImportProgress((prev) => ({ ...prev, [apiId]: progress }));

    if (progress.status === "completed" && progress.normalized_count > 0) {
      setImportedApis((prev) => new Set([...prev, apiId]));
      appStore.setApiSourceActive(apiId, true);
      setActiveApiSources((prev) => new Set([...prev, apiId]));
      setSourceLastUpdated((prev) => ({
        ...prev,
        [apiId]: getLocalCatalogUpdatedLabel(progress) || "Saved locally",
      }));
    }
  };

  useEffect(() => {
    // The import tab refreshes background full-catalog job status on entry so
    // users can tell whether each source is already saved locally.
    if (activeTab !== "import") return;
    let cancelled = false;

    const loadProgress = async () => {
      const supported = AVAILABLE_APIS.filter((api) => isApiSupportedForImport(api.id));
      const results = await Promise.allSettled(
        supported.map(async (api) => [api.id, await getFullCatalogImportProgress(api.id)] as const)
      );

      if (cancelled) return;

      setFullImportProgress((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (result.status === "fulfilled") {
            const [apiId, progress] = result.value;
            next[apiId] = progress;
          }
        }
        return next;
      });

      const completed = results
        .filter((result): result is PromiseFulfilledResult<readonly [string, FullCatalogImportProgressResponse]> => {
          return result.status === "fulfilled" && isFullCatalogImported(result.value[1]);
        })
        .map((result) => result.value);

      if (completed.length > 0) {
        setImportedApis((prev) => {
          const next = new Set(prev);
          completed.forEach(([apiId]) => next.add(apiId));
          return next;
        });
        completed.forEach(([apiId]) => appStore.setApiSourceActive(apiId, true));
        setActiveApiSources((prev) => {
          const next = new Set(prev);
          completed.forEach(([apiId]) => next.add(apiId));
          return next;
        });
        setSourceLastUpdated((prev) => {
          const next = { ...prev };
          completed.forEach(([apiId, progress]) => {
            next[apiId] = progress.finished_at
              ? getLocalCatalogUpdatedLabel(progress) || new Date(progress.finished_at).toLocaleString()
              : getLocalCatalogUpdatedLabel(progress) || "Saved locally";
          });
          return next;
        });
      }
    };

    loadProgress().catch((err) => {
      console.debug("[InputScreen.FullImport] Progress refresh skipped", err);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    // Running imports are polled lightly until they finish or fail.
    const runningApiIds = Object.entries(fullImportProgress)
      .filter(([, progress]) => progress.status === "queued" || progress.status === "running")
      .map(([apiId]) => apiId);

    if (runningApiIds.length === 0) return;

    const interval = window.setInterval(() => {
      runningApiIds.forEach((apiId) => {
        refreshFullImportProgress(apiId).catch((err) => {
          console.debug("[InputScreen.FullImport] Poll failed", { apiId, err });
        });
      });
    }, 2500);

    return () => window.clearInterval(interval);
  }, [fullImportProgress]);

  const handleImportApi = async (apiId: string) => {
    if (!isApiSupportedForImport(apiId)) {
      console.warn("[InputScreen.ImportApi] Source is not supported yet", { apiId });
      setSourceLastUpdated((prev) => ({
        ...prev,
        [apiId]: "Not supported yet",
      }));
      return;
    }

    setIsImporting(apiId);
    try {
      // Call backend to import and persist datasets from this source
      const response = await importApiSource(apiId);
      const importedCount = Number(response?.imported_count ?? 0);

      console.debug("[InputScreen.ImportApi] Completed", {
        apiId,
        importedCount,
        requestedSource: response?.requested_source,
        mappedSource: response?.mapped_source,
      });

      if (importedCount > 0) {
        setImportedApis((prev) => new Set([...prev, apiId]));
        appStore.setApiSourceActive(apiId, true);
        setActiveApiSources((prev) => new Set([...prev, apiId]));
      } else {
        console.warn("[InputScreen.ImportApi] Import completed with zero datasets", {
          apiId,
        });
      }

      setSourceLastUpdated((prev) => ({
        ...prev,
        [apiId]: new Date().toLocaleString(),
      }));
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: {
          state: importedCount > 0 ? "success" : "error",
          message:
            importedCount > 0
              ? `${importedCount} datasets imported and ready for recommendations.`
              : "No datasets were imported from this source.",
          count: importedCount,
        },
      }));
    } catch (err) {
      console.error("Error importing API:", err);
      const message = err instanceof Error ? err.message : "Import failed";
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: {
          state: "error",
          message,
        },
      }));
    } finally {
      setIsImporting(null);
    }
  };

  const handleFullImportApi = async (apiId: string) => {
    if (!isApiSupportedForImport(apiId)) return;

    setIsStartingFullImport(apiId);
    try {
      const progress = await startFullCatalogImport(apiId);
      setFullImportProgress((prev) => ({ ...prev, [apiId]: progress }));
      appStore.setApiSourceActive(apiId, true);
      setActiveApiSources((prev) => new Set([...prev, apiId]));
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: {
          state: "success",
          message: "Full catalog import started. You can leave this screen and check progress later.",
          count: progress.normalized_count,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Full catalog import failed to start";
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: { state: "error", message },
      }));
    } finally {
      setIsStartingFullImport(null);
    }
  };

  const handleRebuildFullCache = async (apiId: string) => {
    if (!isApiSupportedForImport(apiId)) return;

    setIsRebuildingFullImport(apiId);
    try {
      const progress = await rebuildFullCatalogCache(apiId);
      setFullImportProgress((prev) => ({ ...prev, [apiId]: progress }));
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: {
          state: "success",
          message: "Rebuilding the local catalog from saved source files.",
          count: progress.normalized_count,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Local catalog rebuild failed to start";
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: { state: "error", message },
      }));
    } finally {
      setIsRebuildingFullImport(null);
    }
  };

  const handleClearApi = async (apiId: string) => {
    if (!isApiSupportedForImport(apiId)) return;

    setIsImporting(apiId);
    try {
      const response = await clearImportedSource(apiId);
      setImportedApis((prev) => {
        const next = new Set(prev);
        next.delete(apiId);
        return next;
      });
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: {
          state: "success",
          message: `${response.cleared_count} imported datasets cleared from recommendations.`,
          count: response.cleared_count,
        },
      }));
      setSourceLastUpdated((prev) => ({
        ...prev,
        [apiId]: "Cleared",
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Clear failed";
      setSourceImportStatus((prev) => ({
        ...prev,
        [apiId]: { state: "error", message },
      }));
    } finally {
      setIsImporting(null);
    }
  };

  const handleToggleApiActive = (apiId: string, isActive: boolean) => {
    setActiveApiSources((prev) => {
      const next = new Set(prev);

      if (isActive) {
        next.add(apiId);
      } else {
        next.delete(apiId);
      }

      appStore.setApiSourceActive(apiId, isActive);
      return next;
    });
  };

  const toggleExpandedApi = (apiId: string) => {
    setExpandedApis((prev) => {
      const next = new Set(prev);

      if (next.has(apiId)) {
        next.delete(apiId);
      } else {
        next.add(apiId);
      }

      return next;
    });
  };

  const handleSubmit = async () => {
    if (!description.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      // The backend parses the free-text indicator and the client normalizes
      // the response into the shared workflow store for later steps.
      const analyzeResponse = normalizeAnalyzeResponse(
        description,
        await analyzeIndicator(description)
      );

      const indicatorRequest = convertApiResponseToIndicatorRequest(
        description,
        analyzeResponse
      );

      appStore.setIndicatorRequest(indicatorRequest);

      appStore.setExtractedThemes(analyzeResponse.extracted_themes);
      appStore.setThemeConfidence(analyzeResponse.theme_confidence);

      navigate("/overview");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to analyze indicator";
      setError(message);
      console.error("Error analyzing indicator:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateExample = () => {
    // Keep generated examples varied but reproducible by deriving each field
    // from the seed plus click count.
    setDescription(generateExampleIndicator(exampleGenerationCount));
    setExampleGenerationCount((current) => current + 1);
  };

  const importedSourceCount = AVAILABLE_APIS.filter((api) => {
    return (
      isApiSupportedForImport(api.id) &&
      (importedApis.has(api.id) || isFullCatalogImported(fullImportProgress[api.id]))
    );
  }).length;

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-8">
          <div className="mb-6">
            <h1 className="text-2xl mb-2">Madrid Urban Planning Data Assistant</h1>
            <p className="text-neutral-600">
              Describe your indicator or explore available datasets.
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="analyze">Analyze Indicator</TabsTrigger>
              <TabsTrigger value="import">Import Data Sources</TabsTrigger>
            </TabsList>

            {/* Tab 1: Analyze Indicator */}
            <TabsContent value="analyze" className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="indicator-description">Indicator Description</Label>
                <Textarea
                  id="indicator-description"
                  placeholder="Example: Share of residents within 5 minutes walking distance from a bus stop in a given neighborhood."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-32 resize-none"
                  disabled={isLoading}
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-900 text-sm">{error}</p>
                    <p className="text-red-800 text-xs mt-1">
                      Make sure the backend API is running on port 8000
                    </p>
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                <Lightbulb className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-blue-900 mb-2">
                    <strong>Tip:</strong> Describe your indicator clearly, including:
                  </p>
                  <ul className="text-blue-800 space-y-1 list-disc list-inside">
                    <li>What you want to measure (e.g., accessibility, density, proximity)</li>
                    <li>The geographic area or level (e.g., neighborhood, district)</li>
                    <li>Any specific thresholds (e.g., 5 minutes, 500 meters)</li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleGenerateExample}
                  variant="outline"
                  className="flex-1"
                  disabled={isLoading}
                  title={`Seed ${EXAMPLE_RANDOM_SEED}`}
                >
                  <Shuffle className="w-4 h-4 mr-2" />
                  Generate Example
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!description.trim() || isLoading}
                  className="flex-1"
                >
                  {isLoading ? "Analyzing..." : "Continue"}
                </Button>
              </div>
            </TabsContent>

            {/* Tab 2: Import Data Sources */}
            <TabsContent value="import" className="space-y-6">
              <div className="space-y-2">
                <Label>Available Data Sources</Label>
                <p className="text-sm text-neutral-600">
                  Import datasets from external APIs and data portals to expand the available catalog.
                </p>
              </div>

              <div className="grid gap-4">
                {AVAILABLE_APIS.map((api) => {
                  const fullProgress = fullImportProgress[api.id];
                  const isActive = activeApiSources.has(api.id);
                  const isConnected = importedApis.has(api.id) || isFullCatalogImported(fullProgress);
                  const isExpanded = expandedApis.has(api.id);
                  const isImportSupported = isApiSupportedForImport(api.id);
                  const updatedLabel = getSourceLastUpdatedLabel(api.id, fullProgress);
                  const importStatus = sourceImportStatus[api.id];
                  const fullRunning = isFullImportRunning(api.id);
                  const fullRebuilding = isRebuildingFullImport === api.id;
                  const fullCanRebuild = (fullProgress?.raw_snapshot_count ?? 0) > 0;
                  const fullProgressValue = getFullImportProgressValue(fullProgress);
                  const localCatalogUpdatedLabel = getLocalCatalogUpdatedLabel(fullProgress);

                  return (
                  <Card key={api.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => toggleExpandedApi(api.id)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                          aria-expanded={isExpanded}
                          aria-controls={`data-source-${api.id}`}
                        >
                          <div className="mt-1 rounded-full bg-neutral-100 p-2 text-neutral-600">
                            <Layers3 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <CardTitle className="text-base">{api.name}</CardTitle>
                              <Badge variant={isActive ? "default" : "secondary"}>
                                {isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
                              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                              <a
                                href={api.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="truncate hover:underline"
                              >
                                {api.url}
                              </a>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-600">
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarClock className="h-3.5 w-3.5" />
                                Last updated: {updatedLabel}
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                {api.datasetsCount} datasets available
                              </span>
                            </div>
                          </div>
                          <ChevronDown
                            className={`mt-1 h-4 w-4 flex-shrink-0 text-neutral-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </button>

                        <div className="flex-shrink-0 flex items-center gap-2 pt-1">
                          <Switch
                            checked={isActive}
                            disabled={!isImportSupported}
                            onCheckedChange={(checked) => handleToggleApiActive(api.id, checked)}
                            aria-label={`${api.name} active toggle`}
                          />
                        </div>
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent id={`data-source-${api.id}`} className="space-y-4 pt-0">
                        <p className="text-sm text-neutral-700 leading-6">{api.description}</p>

                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Categories
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {api.categories.map((cat, idx) => (
                              <Badge key={`${api.id}-${idx}`} variant="outline" className="text-xs">
                                {cat}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <div className="pt-2">
                          {!isImportSupported ? (
                            <Button disabled className="w-full" variant="secondary">
                              Not supported yet
                            </Button>
                          ) : isConnected ? (
                            <Button
                              onClick={() => handleImportApi(api.id)}
                              disabled={isImporting === api.id}
                              className="w-full"
                              variant="outline"
                            >
                              {isImporting === api.id ? (
                                <>
                                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                                  Syncing...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="w-4 h-4 mr-2" />
                                  Connected (Sync Again)
                                </>
                              )}
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleImportApi(api.id)}
                              disabled={isImporting === api.id}
                              className="w-full"
                              variant="default"
                            >
                              {isImporting === api.id ? (
                                <>
                                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                                  Importing...
                                </>
                              ) : (
                                <>
                                  <Download className="w-4 h-4 mr-2" />
                                  Connect Source
                                </>
                              )}
                            </Button>
                          )}
                          {isImportSupported && (
                            <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-medium text-neutral-700">Local catalog</p>
                                  <p className="text-xs text-neutral-500">
                                    {getFullImportStatusLabel(fullProgress)}
                                    {fullProgress?.normalized_count
                                      ? ` - ${fullProgress.normalized_count.toLocaleString()} datasets`
                                      : ""}
                                  </p>
                                  {localCatalogUpdatedLabel && (
                                    <p className="text-xs text-neutral-500">
                                      Updated {localCatalogUpdatedLabel}
                                    </p>
                                  )}
                                </div>
                                <Badge variant={fullProgress?.status === "failed" ? "destructive" : "secondary"}>
                                  {getFullImportStatusLabel(fullProgress)}
                                </Badge>
                              </div>
                              <Progress value={fullProgressValue} className="mb-3" />
                              <div className="grid grid-cols-2 gap-2 text-xs text-neutral-600">
                                <span>Source records: {fullProgress?.fetched_count?.toLocaleString() ?? 0}</span>
                                <span>Saved pages: {fullProgress?.raw_snapshot_count?.toLocaleString() ?? 0}</span>
                                <span>Source total: {fullProgress?.total_count?.toLocaleString() ?? "Unknown"}</span>
                                <span>Current offset: {fullProgress?.current_offset ?? "n/a"}</span>
                              </div>
                              {fullProgress?.last_error && (
                                <p className="mt-2 text-xs text-red-700">{fullProgress.last_error}</p>
                              )}
                              <Button
                                variant={fullProgress?.status === "completed" ? "outline" : "secondary"}
                                onClick={() => handleFullImportApi(api.id)}
                                disabled={isStartingFullImport === api.id || fullRunning || fullRebuilding}
                                className="mt-3 w-full"
                              >
                                {isStartingFullImport === api.id || fullRunning ? (
                                  <>
                                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                                    Importing full catalog...
                                  </>
                                ) : fullProgress?.status === "completed" ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Refresh local catalog
                                  </>
                                ) : fullProgress?.status === "failed" ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Retry full catalog
                                  </>
                                ) : (
                                  <>
                                    <Download className="w-4 h-4 mr-2" />
                                    Import full catalog
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => handleRebuildFullCache(api.id)}
                                disabled={!fullCanRebuild || fullRunning || fullRebuilding || isStartingFullImport === api.id}
                                className="mt-2 w-full"
                              >
                                {fullRebuilding ? (
                                  <>
                                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                                    Rebuilding local catalog...
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Rebuild from saved source files
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                          {isImportSupported && (
                            <Button
                              variant="ghost"
                              onClick={() => handleClearApi(api.id)}
                              disabled={isImporting === api.id}
                              className="mt-2 w-full"
                            >
                              Clear imported data
                            </Button>
                          )}
                          <div className="mt-2">
                            <Button
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/imported?source=${api.id}`);
                              }}
                              className="w-full"
                            >
                              View imported datasets
                            </Button>
                          </div>
                          <p className="text-xs text-neutral-500 mt-2">
                            Last synced: {updatedLabel}
                          </p>
                          {importStatus && (
                            <div
                              className={`mt-2 rounded-md border p-3 text-xs ${
                                importStatus.state === "error"
                                  ? "border-red-200 bg-red-50 text-red-800"
                                  : "border-green-200 bg-green-50 text-green-800"
                              }`}
                            >
                              {importStatus.message}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                  );
                })}
              </div>

              {importedSourceCount > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-900">
                    <strong>{importedSourceCount}</strong> data source{importedSourceCount !== 1 ? 's' : ''} imported.
                    The dataset catalog has been expanded with new datasets from these sources.
                  </p>
                </div>
              )}

              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
                <p className="text-xs text-neutral-600 mb-2">
                  <strong>Info:</strong> Importing a data source will fetch and integrate datasets from that API into your catalog. You can then search for and select them when analyzing indicators.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-6 text-center text-sm text-neutral-500">
          Step 1 of 5: {activeTab === "analyze" ? "Describe your indicator" : "Import data sources"}
        </div>
      </div>
    </div>
  );
}

function getTabFromSearch(search: string) {
  const tab = new URLSearchParams(search).get("tab");
  return tab === "import" ? "import" : "analyze";
}

function generateExampleIndicator(step: number) {
  const random = createSeededRandom(EXAMPLE_RANDOM_SEED + step * 0x9e3779b9);
  const subject = pickDeterministic(EXAMPLE_SUBJECTS, random);
  const condition = pickDeterministic(EXAMPLE_CONDITIONS, random);
  const geography = pickDeterministic(EXAMPLE_GEOGRAPHIES, random);
  const timeFrame = pickDeterministic(EXAMPLE_TIME_FRAMES, random);

  return `${subject} ${condition} ${geography}, ${timeFrame}.`;
}

function pickDeterministic<T>(items: T[], random: () => number) {
  return items[Math.floor(random() * items.length)];
}

function createSeededRandom(seed: number) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
