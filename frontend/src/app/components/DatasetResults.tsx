import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { 
  ArrowLeft, 
  ArrowRight, 
  Search, 
  Filter,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Circle,
  Eye,
  HelpCircle,
  LayoutGrid,
  List,
  Loader,
} from "lucide-react";
import { DatasetCard } from "./DatasetCard";
import { DatasetDetailPanel } from "./DatasetDetailPanel";
import { appStore } from "../store";
import { Dataset } from "../types";
import {
  getRecommendations,
  convertApiDatasetToReactDataset,
  extractYearFromDate,
} from "../api";
import {
  technicalQualityScore,
} from "../qualityDisplay";
import { formatThemeName, getCatalogMainCategoryLabels, getDatasetCategoryDisplay } from "../themeTaxonomy";
import {
  compatibilityScoreClass as datasetCompatibilityScoreClass,
  formatCompatibilityScore as formatDatasetCompatibilityScore,
  formatCompatibilityTooltip,
  getDatasetCompatibilityScore,
} from "../compatibilityDisplay";

type DatasetViewMode = "cards" | "table";

const RECOMMENDATION_LOADING_STATUSES = [
  "Reading your selected data themes...",
  "Searching imported and cached catalogs...",
  "Matching datasets to the planning question...",
  "Ranking datasets by fit to your question...",
  "Applying evidence and geography checks...",
  "Preparing the dataset list...",
];
const LOADING_STATUS_ROTATION_MS = 3600;

function datasetCompatibilityValue(dataset: Dataset): number {
  const score = getDatasetCompatibilityScore(dataset);
  if (typeof score !== "number") return 0;
  return score > 1 ? score / 100 : score;
}

function sortDatasetsByCompatibility(datasets: Dataset[]): Dataset[] {
  return [...datasets].sort(compareDatasetStrength);
}

function categoryDisplayForDataset(dataset: Dataset) {
  return getDatasetCategoryDisplay(dataset, appStore.getExtractedThemes());
}

function compareDatasetStrength(a: Dataset, b: Dataset): number {
  if (a.essential !== b.essential) return a.essential ? -1 : 1;

  const compatibilityA = datasetCompatibilityValue(a);
  const compatibilityB = datasetCompatibilityValue(b);
  if (compatibilityA !== compatibilityB) return compatibilityB - compatibilityA;

  const scoreA = a.relevanceScore ?? 0;
  const scoreB = b.relevanceScore ?? 0;
  if (scoreA !== scoreB) return scoreB - scoreA;

  const qualityA = datasetQualityScore(a);
  const qualityB = datasetQualityScore(b);
  if (qualityA !== qualityB) return qualityB - qualityA;

  return a.name.localeCompare(b.name);
}

function datasetQualityScore(dataset: Dataset): number {
  return technicalQualityScore(dataset);
}

export function DatasetResults() {
  const navigate = useNavigate();
  const indicatorRequest = appStore.getIndicatorRequest();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [filteredDatasets, setFilteredDatasets] = useState<Dataset[]>([]);
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set());
  const [detailDataset, setDetailDataset] = useState<Dataset | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [viewMode, setViewMode] = useState<DatasetViewMode>("table");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatusStep, setLoadingStatusStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const sourceToFrontendId: Record<string, string> = {
    madrid_ckan: "madrid-ckan",
    datos_gob_es: "datos-gob-es",
  };

  const isDatasetFromInactiveApiSource = (dataset: Dataset) => {
    const activeSources = new Set(appStore.getActiveApiSources());
    if (activeSources.size === 0) return false;

    const backendSource = dataset.source || "unknown";
    const frontendSource = sourceToFrontendId[backendSource];
    return Boolean(frontendSource && !activeSources.has(frontendSource));
  };

  const filterByActiveSources = (list: Dataset[]) =>
    list.filter((dataset) => !isDatasetFromInactiveApiSource(dataset));

  useEffect(() => {
    if (!isLoading) return;

    setLoadingStatusStep(0);

    const intervalId = window.setInterval(() => {
      setLoadingStatusStep((statusStep) => statusStep + 1);
    }, LOADING_STATUS_ROTATION_MS);

    return () => window.clearInterval(intervalId);
  }, [isLoading]);

  const applyRecommendationDatasets = (withBackendRecommendations: Dataset[]) => {
    const visibleIds = new Set(withBackendRecommendations.map((dataset) => dataset.id));
    const persistedSelection = appStore
      .getSelectedDatasets()
      .filter((dataset) => visibleIds.has(dataset.id))
      .map((dataset) => dataset.id);
    const essentialDatasets = withBackendRecommendations.filter((dataset) => dataset.essential);
    const nextSelectedIds = new Set([
      ...persistedSelection,
      ...essentialDatasets.map((dataset) => dataset.id),
    ]);
    const prioritizedDatasets = sortDatasetsByCompatibility(withBackendRecommendations);

    setDatasets(prioritizedDatasets);
    setFilteredDatasets(prioritizedDatasets);

    appStore.clearSelectedDatasets();
    prioritizedDatasets.forEach((dataset) => {
      appStore.setDatasetSelected(dataset, nextSelectedIds.has(dataset.id));
    });
    setSelectedDatasets(nextSelectedIds);
  };

  useEffect(() => {
    const request = appStore.getIndicatorRequest();
    if (!request) {
      navigate("/");
      return;
    }

    const controller = new AbortController();
    let isCurrentRequest = true;
    const cacheKey = appStore.buildRecommendationCacheKey(
      request.description,
      appStore.getExtractedThemes(),
      appStore.getActiveApiSources()
    );
    const cachedDatasets = appStore.getRecommendationCache(cacheKey);

    if (cachedDatasets) {
      applyRecommendationDatasets(filterByActiveSources(cachedDatasets));
      setIsLoading(false);
      setError(null);
      return () => {
        isCurrentRequest = false;
      };
    }

    const loadDatasets = async () => {
      try {
        setIsLoading(true);
        setLoadingStatusStep(0);
        setError(null);

        const response = await getRecommendations(
          request.description,
          appStore.getExtractedThemes(),
          { signal: controller.signal }
        );
        if (!isCurrentRequest) return;

        const convertedDatasets = response.recommendations.map((apiDataset) =>
          convertApiDatasetToReactDataset(apiDataset)
        );
        const withBackendRecommendations = filterByActiveSources(convertedDatasets);
        const prioritizedDatasets = sortDatasetsByCompatibility(withBackendRecommendations);

        appStore.setRecommendationCache(cacheKey, prioritizedDatasets);
        applyRecommendationDatasets(withBackendRecommendations);
      } catch (err) {
        if (
          !isCurrentRequest ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load datasets";
        setError(message);
        console.error("Error loading datasets:", err);
      } finally {
        if (isCurrentRequest) {
          setIsLoading(false);
        }
      }
    };

    loadDatasets();
    return () => {
      isCurrentRequest = false;
      controller.abort();
    };
  }, [navigate]);

  useEffect(() => {
    // Search and filter are local-only so the user can change views without
    // waiting for another recommendation request.
    let filtered = datasets;

    if (searchTerm) {
      const normalizedSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (d: Dataset) => getDatasetSearchText(d).includes(normalizedSearch)
      );
    }

    if (filterCategory !== "all") {
      filtered = filtered.filter((d: Dataset) => getDatasetCategoryLabels(d).includes(filterCategory));
    }

    if (filterSource !== "all") {
      filtered = filtered.filter((d: Dataset) => (d.source || "unknown") === filterSource);
    }

    setFilteredDatasets(sortDatasetsByCompatibility(filtered));
  }, [searchTerm, filterCategory, filterSource, datasets]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterCategory, filterSource, datasets.length]);

  const totalPages = Math.max(1, Math.ceil(filteredDatasets.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const visibleDatasets = filteredDatasets.slice(pageStart, pageStart + pageSize);

  const handleToggleDataset = (dataset: Dataset) => {
    const newSelected = new Set(selectedDatasets);
    if (newSelected.has(dataset.id)) {
      newSelected.delete(dataset.id);
    } else {
      newSelected.add(dataset.id);
    }
    setSelectedDatasets(newSelected);
    appStore.setDatasetSelected(dataset, newSelected.has(dataset.id));
  };

  const datasetCategoryLabels = Array.from(
    new Set(datasets.flatMap((d: Dataset) => getDatasetCategoryLabels(d)))
  );
  const catalogCategoryLabels = getCatalogMainCategoryLabels();
  const extraCategoryLabels = datasetCategoryLabels
    .filter((category) => !catalogCategoryLabels.includes(category))
    .sort((a, b) => a.localeCompare(b));
  const categories: string[] = [...catalogCategoryLabels, ...extraCategoryLabels];
  const categoryAvailabilityPool = datasets.filter((dataset) => {
    const matchesSource = filterSource === "all" || (dataset.source || "unknown") === filterSource;
    const matchesSearch = !searchTerm || getDatasetSearchText(dataset).includes(searchTerm.toLowerCase());
    return matchesSource && matchesSearch;
  });
  const categoryCounts = categoryAvailabilityPool.reduce<Record<string, number>>((counts, dataset) => {
    getDatasetCategoryLabels(dataset).forEach((category) => {
      counts[category] = (counts[category] || 0) + 1;
    });
    return counts;
  }, {});
  const sources: string[] = Array.from(
    new Set(datasets.map((d: Dataset) => d.source || "unknown"))
  ).sort((a, b) => formatSourceLabel(a).localeCompare(formatSourceLabel(b)));
  const missingRecommended = datasets.filter(
    (d: Dataset) => d.essential && !selectedDatasets.has(d.id)
  );

  const handleContinue = () => {
    if (missingRecommended.length > 0) {
      const confirmed = window.confirm(
        `You have not selected ${missingRecommended.length} recommended dataset(s). Continue to fit review anyway?`
      );
      if (!confirmed) return;
    }
    navigate("/dataset-fit");
  };

  const resetFilters = () => {
    setSearchTerm("");
    setFilterCategory("all");
    setFilterSource("all");
  };

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const loadingStatusIndex = loadingStatusStep % RECOMMENDATION_LOADING_STATUSES.length;
  const currentLoadingMessage = RECOMMENDATION_LOADING_STATUSES[loadingStatusIndex];
  const previousLoadingMessage =
    loadingStatusStep > 0
      ? RECOMMENDATION_LOADING_STATUSES[
          (loadingStatusIndex - 1 + RECOMMENDATION_LOADING_STATUSES.length) %
            RECOMMENDATION_LOADING_STATUSES.length
        ]
      : null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="flex min-w-72 flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-blue-600 animate-spin" />
          <div className="loading-status-roll" aria-live="polite" aria-atomic="true">
            <span className="sr-only">{currentLoadingMessage}</span>
            {previousLoadingMessage && (
              <span
                key={`previous-${loadingStatusStep}`}
                className="loading-status-roll__item loading-status-roll__item--previous"
                aria-hidden="true"
              >
                {previousLoadingMessage}
              </span>
            )}
            <span
              key={`current-${loadingStatusStep}`}
              className="loading-status-roll__item loading-status-roll__item--current"
              aria-hidden="true"
            >
              {currentLoadingMessage}
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            Large catalogs can take a moment to rank.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
            <div className="flex gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
              <div>
                <h2 className="font-medium text-red-900">Error Loading Datasets</h2>
                <p className="text-red-700 text-sm mt-1">{error}</p>
                <p className="text-red-800 text-xs mt-2">
                  Make sure the configured backend API is running, then try again.
                </p>
              </div>
            </div>
            <Button onClick={() => navigate("/")} className="w-full">
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Page header */}
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <h1 className="text-2xl mb-2">Available Datasets for Madrid</h1>
          <p className="text-neutral-600 max-w-3xl">
            Review datasets sorted by semantic compatibility with your planning question. Recommended datasets are pre-selected only after the backend evidence gate passes.
          </p>
          {indicatorRequest?.description && (
            <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                Planning question
              </p>
              <p className="text-neutral-800">{indicatorRequest.description}</p>
            </div>
          )}
        </div>

        {/* Local search, filters, and view switcher */}
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-4">
          <div className="flex flex-col gap-3 mb-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Filter className="w-5 h-5 text-neutral-500" />
              <h3 className="font-semibold">Search and Filter</h3>
            </div>
            <DatasetViewToggle value={viewMode} onChange={setViewMode} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input
                placeholder="Search datasets..."
                value={searchTerm}
                onChange={(e: any) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm"
            >
              <option value="all">All Sources</option>
              {sources.map((source) => (
                <option key={source} value={source}>{formatSourceLabel(source)}</option>
              ))}
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category} value={category} disabled={!categoryCounts[category]}>
                  {categoryCounts[category] ? category : `${category} (no matches)`}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <span>Showing {filteredDatasets.length} of {datasets.length} datasets</span>
            <span>•</span>
            <span>{selectedDatasets.size} selected</span>
            <span>•</span>
            <button type="button" className="text-blue-700 hover:underline" onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        </div>

        {/* Selection quality warning before continuing to fit review */}
        {missingRecommended.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-amber-900 font-medium mb-1">
                Some Recommended Datasets Are Not Selected
              </p>
              <p className="text-amber-800">
                You have not selected {missingRecommended.length} recommended dataset(s).
                This may leave useful evidence out of the fit review.
              </p>
            </div>
          </div>
        )}

        <DatasetResultsView
          viewMode={viewMode}
          datasets={visibleDatasets}
          selectedDatasets={selectedDatasets}
          onToggle={handleToggleDataset}
          onViewDetails={setDetailDataset}
        />

        {filteredDatasets.length === 0 && (
          <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
            <p className="text-neutral-700 font-medium">No datasets match the current view</p>
            <p className="text-neutral-500 text-sm mt-2">
              Try broadening search, choosing another category, or activating an imported source.
            </p>
            <Button type="button" variant="outline" className="mt-4" onClick={resetFilters}>
              Reset filters
            </Button>
          </div>
        )}

        {filteredDatasets.length > pageSize && (
          <div className="bg-white rounded-lg border border-neutral-200 p-4 flex items-center justify-between gap-3">
            <div className="text-sm text-neutral-600">
              Showing {pageStart + 1}-{Math.min(pageStart + pageSize, filteredDatasets.length)} of {filteredDatasets.length} datasets
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(safeCurrentPage - 1)}
                disabled={safeCurrentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-neutral-600 min-w-24 text-center">
                Page {safeCurrentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(safeCurrentPage + 1)}
                disabled={safeCurrentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step navigation */}
        <div className="sticky bottom-0 z-20 -mx-6 border-t border-neutral-200 bg-neutral-50/95 p-4 backdrop-blur">
          <div className="flex gap-3">
          <Button
            onClick={() => navigate("/overview")}
            variant="outline"
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Button
            onClick={handleContinue}
            disabled={selectedDatasets.size === 0}
            className="flex-1 gap-2"
          >
            Continue to Fit Review
            <ArrowRight className="w-4 h-4" />
          </Button>
          </div>
        </div>

        <div className="text-center text-sm text-neutral-500">
          Step 3 of 5: Select datasets
        </div>
      </div>

      {/* Lazy dataset detail panel */}
      {detailDataset && (
        <DatasetDetailPanel
          dataset={detailDataset}
          preferredThemeIds={appStore.getExtractedThemes()}
          onClose={() => setDetailDataset(null)}
        />
      )}
    </div>
  );
}

interface DatasetResultsViewProps {
  viewMode: DatasetViewMode;
  datasets: Dataset[];
  selectedDatasets: Set<string>;
  onToggle: (dataset: Dataset) => void;
  onViewDetails: (dataset: Dataset) => void;
}

function DatasetResultsView({
  viewMode,
  datasets,
  selectedDatasets,
  onToggle,
  onViewDetails,
}: DatasetResultsViewProps) {
  const preferredThemeIds = appStore.getExtractedThemes();

  if (viewMode === "table") {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Select</TableHead>
              <TableHead>Dataset</TableHead>
              <TableHead>
                <div className="flex items-center gap-1">
                  Compatibility
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3.5 h-3.5 text-neutral-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Based on semantic similarity, focused evidence, geography, and time alignment with the planning question.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead>Published</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datasets.map((dataset) => (
              <DatasetTableRow
                key={dataset.id}
                dataset={dataset}
                isSelected={selectedDatasets.has(dataset.id)}
                onToggle={onToggle}
                onViewDetails={onViewDetails}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {datasets.map((dataset: Dataset) => (
        <DatasetCard
          key={dataset.id}
          dataset={dataset}
          isSelected={selectedDatasets.has(dataset.id)}
          preferredThemeIds={preferredThemeIds}
          onToggle={onToggle}
          onViewDetails={onViewDetails}
        />
      ))}
    </div>
  );
}

function DatasetViewToggle({
  value,
  onChange,
}: {
  value: DatasetViewMode;
  onChange: (value: DatasetViewMode) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onChange(nextValue as DatasetViewMode);
      }}
      variant="outline"
      size="sm"
      className="bg-white"
      aria-label="Dataset view"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem value="cards" aria-label="Card view" className="px-3">
            <LayoutGrid className="w-4 h-4" />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>Card view</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem value="table" aria-label="List view" className="px-3">
            <List className="w-4 h-4" />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>List view</TooltipContent>
      </Tooltip>
    </ToggleGroup>
  );
}

function DatasetTableRow({
  dataset,
  isSelected,
  onToggle,
  onViewDetails,
}: {
  dataset: Dataset;
  isSelected: boolean;
  onToggle: (dataset: Dataset) => void;
  onViewDetails: (dataset: Dataset) => void;
}) {
  const categoryLabels = getDatasetSubcategoryLabels(dataset);
  const compatibilityScore = getDatasetCompatibilityScore(dataset);
  const compatibilityReason = formatCompatibilityTooltip(dataset);

  return (
    <TableRow aria-selected={isSelected}>
      <TableCell>
        <button
          onClick={() => onToggle(dataset)}
          aria-label={isSelected ? "Deselect dataset" : "Select dataset"}
        >
          {isSelected ? (
            <CheckCircle2 className="w-5 h-5 text-blue-600" />
          ) : (
            <Circle className="w-5 h-5 text-neutral-300" />
          )}
        </button>
      </TableCell>
      <TableCell className="min-w-80 whitespace-normal">
        {dataset.essential && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            <Badge className="bg-blue-600">Recommended</Badge>
          </div>
        )}
        <p className="font-medium leading-snug">{dataset.name}</p>
        <p className="text-xs text-neutral-500">{dataset.provider}</p>
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`inline-flex text-sm font-semibold ${datasetCompatibilityScoreClass(dataset)}`}>
              {formatDatasetCompatibilityScore(compatibilityScore)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{compatibilityReason}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap gap-1.5">
          {categoryLabels.map((label) => (
            <Badge key={label} variant="secondary">
              {label}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <p className="font-medium">{dataset.spatialCoverage}</p>
        <p className="text-xs text-neutral-500">{dataset.spatialResolution}</p>
      </TableCell>
      <TableCell>
        <p className="text-sm text-neutral-600">{extractYearFromDate(dataset.publicationDate)}</p>
      </TableCell>
      <TableCell className="text-right">
        <Button
          onClick={() => onViewDetails(dataset)}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Eye className="w-4 h-4" />
          Details
        </Button>
      </TableCell>
    </TableRow>
  );
}

function getDatasetCategoryLabels(dataset: Dataset): string[] {
  return [categoryDisplayForDataset(dataset).primary.label];
}

function getDatasetSubcategoryLabels(dataset: Dataset): string[] {
  const categoryDisplay = categoryDisplayForDataset(dataset);
  const themeLabels = categoryDisplay.secondaryThemeIds.map(formatThemeName);
  const fallbackLabel = dataset.category || categoryDisplay.primary.label;
  return Array.from(new Set(themeLabels.length > 0 ? themeLabels : [fallbackLabel])).slice(0, 1);
}

function getDatasetSearchText(dataset: Dataset): string {
  const categoryDisplay = categoryDisplayForDataset(dataset);
  return [
    dataset.name,
    dataset.provider,
    dataset.category,
    dataset.source || "",
    categoryDisplay.primary.label,
    ...categoryDisplay.secondaryThemeIds.map(formatThemeName),
  ].join(" ").toLowerCase();
}

function formatSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    madrid_ckan: "Madrid CKAN",
    datos_gob_es: "datos.gob.es",
    unknown: "Unknown source",
  };
  return labels[source] || source;
}
