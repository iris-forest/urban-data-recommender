import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Card, CardHeader, CardContent, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Filter, Search } from "lucide-react";
import { clearImportedSource, DatasetItemFromAPI, getFullCatalog, importApiSource } from "../api";
import { DatasetCategoryDisplay, formatThemeName, getDatasetCategoryDisplay } from "../themeTaxonomy";

function mapFrontendIdToBackendSource(id: string) {
  if (!id) return "";
  const m: Record<string, string> = {
    "madrid-ckan": "madrid_ckan",
    "datos-gob": "datos_gob_es",
    "datos-gob-es": "datos_gob_es",
    geoportal: "geoportal",
  };
  return m[id] ?? id;
}

export function ImportedApiDatasets() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const sourceParam = params.get("source") ?? "";

  const [datasets, setDatasets] = useState<DatasetItemFromAPI[]>([]);
  const [loading, setLoading] = useState(false);
  const [emptyReason, setEmptyReason] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");

  const mappedSource = mapFrontendIdToBackendSource(sourceParam);
  const importSupported =
    sourceParam === "madrid-ckan" ||
    sourceParam === "datos-gob-es" ||
    sourceParam === "datos-gob";

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setEmptyReason("");
      setStatusMessage("");

      console.debug("[ImportedApiDatasets] Load start", {
        sourceParam,
        mappedSource,
      });

      try {
        if (sourceParam && importSupported) {
          try {
            const importResp = await importApiSource(sourceParam);
            console.debug("[ImportedApiDatasets] Auto-import completed", {
              sourceParam,
              mappedSource,
              importedCount: importResp?.imported_count,
              requestedSource: importResp?.requested_source,
              mappedSourceFromApi: importResp?.mapped_source,
            });
            setStatusMessage(`${importResp?.imported_count ?? 0} datasets imported from ${sourceParam}.`);
          } catch (importErr) {
            console.error("[ImportedApiDatasets] Auto-import failed", {
              sourceParam,
              mappedSource,
              error: importErr,
            });
            setStatusMessage(importErr instanceof Error ? importErr.message : "Import failed.");
          }
        } else if (sourceParam === "geoportal") {
          console.warn("[ImportedApiDatasets] Source is not supported yet", {
            sourceParam,
          });
        }

        const resp = await getFullCatalog(true, mappedSource);
        const items = resp.datasets || [];

        const responseSources: Record<string, number> = {};
        for (const item of items) {
          const key = item.source || "missing";
          responseSources[key] = (responseSources[key] || 0) + 1;
        }

        console.debug("[ImportedApiDatasets] Catalog response", {
          totalItems: items.length,
          sourceParam,
          mappedSource,
          sourceDistribution: responseSources,
        });

        // Backend now filters by source, so we use items directly without additional filtering
        let reason = "";
        if (sourceParam === "geoportal") {
          reason = "Geoportal import is not supported yet.";
        } else if (items.length === 0 && mappedSource) {
          reason = `No datasets found for source ${mappedSource}.`;
        } else if (items.length === 0) {
          reason = "No imported datasets detected.";
        }

        console.debug("[ImportedApiDatasets] Filter summary", {
          sourceParam,
          mappedSource,
          count: items.length,
          reason: reason || "matched",
        });

        setDatasets(items);
        setEmptyReason(reason);
      } catch (err) {
        console.error("[ImportedApiDatasets] Failed to load catalog", {
          sourceParam,
          mappedSource,
          error: err,
        });
        setDatasets([]);
        setEmptyReason("Failed to load datasets from backend.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [sourceParam, mappedSource, importSupported]);

  const handleClear = async () => {
    if (!sourceParam || !importSupported) return;

    setLoading(true);
    setStatusMessage("");
    try {
      const response = await clearImportedSource(sourceParam);
      setDatasets([]);
      setSearchTerm("");
      setFilterCategory("all");
      setEmptyReason(`Cleared ${response.cleared_count} imported datasets from ${mappedSource}.`);
      setStatusMessage(`${response.cleared_count} imported datasets cleared.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Clear failed.");
    } finally {
      setLoading(false);
    }
  };

  const displayedDatasets = useMemo(() => {
    return datasets.map((dataset) => {
      const categoryDisplay = getImportedDatasetCategoryDisplay(dataset);
      return {
        dataset,
        categoryDisplay,
        categoryLabels: getImportedDatasetCategoryLabels(categoryDisplay),
        searchText: getImportedDatasetSearchText(dataset, categoryDisplay),
      };
    });
  }, [datasets]);

  const categoryOptions = useMemo(() => {
    const labels = new Set<string>();
    displayedDatasets.forEach(({ categoryLabels }) => {
      categoryLabels.forEach((label) => labels.add(label));
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [displayedDatasets]);

  const filteredDatasets = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return displayedDatasets.filter(({ categoryLabels, searchText }) => {
      const matchesSearch = !normalizedSearch || searchText.includes(normalizedSearch);
      const matchesCategory = filterCategory === "all" || categoryLabels.includes(filterCategory);
      return matchesSearch && matchesCategory;
    });
  }, [displayedDatasets, filterCategory, searchTerm]);

  const resetFilters = () => {
    setSearchTerm("");
    setFilterCategory("all");
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl">Imported Datasets</h2>
          <div>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Back
            </Button>
            {importSupported && (
              <Button variant="ghost" onClick={handleClear} className="ml-2">
                Clear
              </Button>
            )}
          </div>
        </div>

        {statusMessage && (
          <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            {statusMessage}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-neutral-600">Loading...</p>
        ) : datasets.length === 0 ? (
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-6">
            <p className="text-sm text-neutral-700">No imported datasets found for this source.</p>
            {emptyReason ? <p className="text-xs text-neutral-500 mt-2">Reason: {emptyReason}</p> : null}
            <p className="text-xs text-neutral-500 mt-2">Try connecting the source first from Import Data Sources.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <Filter className="h-4 w-4 text-neutral-500" />
                <h3 className="text-sm font-semibold text-neutral-900">Search and Filter</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_240px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <Input
                    placeholder="Search imported datasets..."
                    value={searchTerm}
                    onChange={(event: any) => setSearchTerm(event.target.value)}
                    className="pl-9"
                  />
                </div>
                <select
                  value={filterCategory}
                  onChange={(event) => setFilterCategory(event.target.value)}
                  className="rounded-md border border-neutral-200 px-3 py-2 text-sm"
                >
                  <option value="all">All Categories</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
                <span>Showing {filteredDatasets.length} of {datasets.length} datasets</span>
                <span>•</span>
                <button type="button" className="text-blue-700 hover:underline" onClick={resetFilters}>
                  Reset filters
                </button>
              </div>
            </div>

            {filteredDatasets.length === 0 ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
                <p className="text-sm text-neutral-700">No imported datasets match these filters.</p>
                <button type="button" className="mt-2 text-sm text-blue-700 hover:underline" onClick={resetFilters}>
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {filteredDatasets.map(({ dataset: ds, categoryDisplay }) => (
                <Card key={ds.dataset_id} className="overflow-hidden">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <CardTitle className="text-base">{ds.title}</CardTitle>
                        <p className="text-xs text-neutral-600">{ds.provider}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Badge variant="secondary">{categoryDisplay.primary.label}</Badge>
                        <Badge variant="outline">{ds.source || "unknown"}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {categoryDisplay.secondaryThemeIds.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {categoryDisplay.secondaryThemeIds.map((themeId) => (
                          <Badge key={themeId} variant="outline" className="text-xs">
                            {formatThemeName(themeId)}
                          </Badge>
                        ))}
                        {categoryDisplay.overflowCount > 0 && (
                          <Badge variant="outline" className="text-xs">
                            +{categoryDisplay.overflowCount} secondary
                          </Badge>
                        )}
                      </div>
                    )}
                    <p className="text-sm text-neutral-700 truncate">{ds.description}</p>
                    <div className="mt-2 text-xs text-neutral-500">
                      {ds.spatial_coverage || "Unknown coverage"} - {ds.update_frequency || "unknown cadence"}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-block">
                            <Button
                              disabled
                              variant="outline"
                              className="border-neutral-300 bg-neutral-100 text-neutral-400 shadow-none hover:bg-neutral-100 hover:text-neutral-400"
                            >
                              View
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Future feature: open the selected dataset details here.</TooltipContent>
                      </Tooltip>
                      <Button variant="outline" onClick={() => window.open(ds.api_url || "", "_blank")}>Source</Button>
                    </div>
                  </CardContent>
                </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ImportedApiDatasets;

function getImportedDatasetCategoryDisplay(dataset: DatasetItemFromAPI): DatasetCategoryDisplay {
  return getDatasetCategoryDisplay({
    name: dataset.title,
    description: dataset.description,
    category: dataset.primary_category || "Uncategorized",
    themes: dataset.themes || [],
    matchingThemes: dataset.matching_themes || [],
  });
}

function getImportedDatasetCategoryLabels(categoryDisplay: DatasetCategoryDisplay): string[] {
  return [
    categoryDisplay.primary.label,
    ...categoryDisplay.secondaryThemeIds.map((themeId) => formatThemeName(themeId)),
  ];
}

function getImportedDatasetSearchText(
  dataset: DatasetItemFromAPI,
  categoryDisplay: DatasetCategoryDisplay
): string {
  return [
    dataset.title,
    dataset.description,
    dataset.provider,
    dataset.source,
    dataset.spatial_coverage,
    dataset.spatial_resolution,
    dataset.update_frequency,
    dataset.primary_category,
    ...(dataset.themes || []),
    ...(dataset.matching_themes || []),
    ...getImportedDatasetCategoryLabels(categoryDisplay),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
