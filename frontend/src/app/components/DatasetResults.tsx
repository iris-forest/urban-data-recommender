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
  LayoutDashboard,
  List,
  Loader,
  X,
} from "lucide-react";
import { DatasetCard } from "./DatasetCard";
import { DatasetDetailContent, DatasetDetailPanel } from "./DatasetDetailPanel";
import { appStore } from "../store";
import { Dataset } from "../types";
import {
  getRecommendations,
  convertApiDatasetToReactDataset,
  extractYearFromDate,
} from "../api";
import { formatThemeName, getCatalogMainCategoryLabels, getDatasetCategoryDisplay } from "../themeTaxonomy";
import {
  getDatasetCoverageSummary,
  uniqueThemeIds,
} from "../datasetCoverage";
import {
  compatibilityBadgeClass as datasetCompatibilityBadgeClass,
  compatibilityScoreClass as datasetCompatibilityScoreClass,
  formatCompatibilityScore as formatDatasetCompatibilityScore,
  formatCompatibilityTooltip,
  getDatasetCompatibilityScore,
} from "../compatibilityDisplay";

type DatasetViewMode = "board" | "cards" | "table";

const RECOMMENDATION_LOADING_STATUSES = [
  "Reading your selected data themes...",
  "Searching imported and cached catalogs...",
  "Matching datasets to the planning question...",
  "Ranking datasets by fit to your question...",
  "Applying evidence and geography checks...",
  "Preparing the dataset list...",
];
const LOADING_STATUS_ROTATION_MS = 3600;
const ROLE_SECTION_PREVIEW_LIMIT = 4;

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

  return a.name.localeCompare(b.name);
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
  const [viewMode, setViewMode] = useState<DatasetViewMode>("board");
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
  const visibleDatasets =
    viewMode === "board"
      ? filteredDatasets
      : filteredDatasets.slice(pageStart, pageStart + pageSize);

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
        `You have not selected ${missingRecommended.length} preselected high-fit dataset(s). Continue to data quality review anyway?`
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
            Review datasets by the role they can play in answering your planning question. Match scores show role usefulness, not whether one dataset answers the whole indicator alone.
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

        {/* Selection quality warning before continuing to data quality review */}
        {missingRecommended.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-amber-900 font-medium mb-1">
                Some Preselected High-Fit Datasets Are Not Selected
              </p>
              <p className="text-amber-800">
                You have not selected {missingRecommended.length} preselected high-fit dataset(s).
                This may leave useful evidence out of the data quality review.
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

        {viewMode !== "board" && filteredDatasets.length > pageSize && (
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
            Continue to Data Quality Review
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

  if (viewMode === "board") {
    return (
      <DatasetRoleBoard
        datasets={datasets}
        selectedDatasets={selectedDatasets}
        onToggle={onToggle}
        onViewDetails={onViewDetails}
      />
    );
  }

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
                  Match
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3.5 h-3.5 text-neutral-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Role usefulness for the planning question. A high score can mean this dataset is a strong input, not a complete answer by itself.
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
          <ToggleGroupItem value="board" aria-label="Role board" className="px-3">
            <LayoutDashboard className="w-4 h-4" />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>Role board</TooltipContent>
      </Tooltip>
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

function DatasetRoleBoard({
  datasets,
  selectedDatasets,
  onToggle,
  onViewDetails,
}: {
  datasets: Dataset[];
  selectedDatasets: Set<string>;
  onToggle: (dataset: Dataset) => void;
  onViewDetails: (dataset: Dataset) => void;
}) {
  const requiredThemeIds = uniqueThemeIds(appStore.getExtractedThemes());
  const [pickerSection, setPickerSection] = useState<{
    id: string;
    title: string;
    datasets: Dataset[];
  } | null>(null);

  if (requiredThemeIds.length === 0) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {datasets.map((dataset: Dataset) => (
          <DatasetCard
            key={dataset.id}
            dataset={dataset}
            isSelected={selectedDatasets.has(dataset.id)}
            onToggle={onToggle}
            onViewDetails={onViewDetails}
          />
        ))}
      </div>
    );
  }

  const summaries = new Map(
    datasets.map((dataset) => [dataset.id, getDatasetCoverageSummary(dataset, requiredThemeIds)])
  );
  const assignedDatasetIds = new Set<string>();
  const roleSections = requiredThemeIds.map((themeId) => {
    const sectionDatasets = datasets.filter((dataset) => summaries.get(dataset.id)?.bestRoleThemeId === themeId);
    sectionDatasets.forEach((dataset) => assignedDatasetIds.add(dataset.id));
    return {
      id: themeId,
      label: formatThemeName(themeId),
      datasets: sectionDatasets,
    };
  });
  const otherDatasets = datasets.filter((dataset) => !assignedDatasetIds.has(dataset.id));
  const sections = otherDatasets.length > 0
    ? [
        ...roleSections,
        {
          id: "other-useful-datasets",
          label: "Other useful datasets",
          datasets: otherDatasets,
        },
      ]
    : roleSections;

  return (
    <div className="space-y-4">
      <div className="relative -mx-6 overflow-hidden pl-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-neutral-50 to-transparent"
        />
        <div className="flex snap-x gap-4 overflow-x-auto pb-3 pr-16">
          {sections.map((section) => (
            <RoleBoardSection
              key={section.id}
              id={section.id}
              title={section.label}
              datasets={section.datasets}
              selectedDatasets={selectedDatasets}
              onOpenPicker={setPickerSection}
              onToggleDataset={onToggle}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      </div>

      {pickerSection && (
        <RoleDatasetPickerModal
          title={pickerSection.title}
          datasets={pickerSection.datasets}
          preferredThemeIds={requiredThemeIds}
          selectedDatasets={selectedDatasets}
          onToggleDataset={onToggle}
          onClose={() => setPickerSection(null)}
        />
      )}
    </div>
  );
}

function RoleBoardSection({
  id,
  title,
  datasets,
  selectedDatasets,
  onOpenPicker,
  onToggleDataset,
  onViewDetails,
}: {
  id: string;
  title: string;
  datasets: Dataset[];
  selectedDatasets: Set<string>;
  onOpenPicker: (section: { id: string; title: string; datasets: Dataset[] }) => void;
  onToggleDataset: (dataset: Dataset) => void;
  onViewDetails: (dataset: Dataset) => void;
}) {
  const visibleDatasets = datasets.slice(0, ROLE_SECTION_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, datasets.length - visibleDatasets.length);

  return (
    <section className="flex min-h-0 w-[21rem] shrink-0 snap-start flex-col rounded-lg border border-neutral-200 bg-neutral-100/70 md:w-[23rem] xl:w-[25rem]">
      <div className="flex flex-col gap-2 border-b border-neutral-200 px-3 py-3">
        <div>
          <h3 className="font-semibold text-neutral-900">{title}</h3>
          <p className="text-sm text-neutral-500">
            {datasets.length > 0
              ? `${datasets.length} dataset${datasets.length === 1 ? "" : "s"} can help with this role`
              : "No datasets in the current filters are assigned to this role"}
          </p>
        </div>
        {datasets.length > ROLE_SECTION_PREVIEW_LIMIT && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit px-0 text-blue-700 hover:bg-transparent"
            onClick={() => onOpenPicker({ id, title, datasets })}
          >
            Add datasets
          </Button>
        )}
      </div>

      {visibleDatasets.length > 0 ? (
        <div className="flex flex-col gap-3 p-3">
          {visibleDatasets.map((dataset) => (
            <RoleDatasetCard
              key={dataset.id}
              dataset={dataset}
              isSelected={selectedDatasets.has(dataset.id)}
              onToggle={onToggleDataset}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      ) : (
        <div className="p-3 text-sm text-neutral-500">
          Try clearing filters or use the list view to inspect broader candidates.
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500">
          Showing top {ROLE_SECTION_PREVIEW_LIMIT}; {hiddenCount} more hidden.
        </div>
      )}
    </section>
  );
}

function RoleDatasetPickerModal({
  title,
  datasets,
  preferredThemeIds,
  selectedDatasets,
  onToggleDataset,
  onClose,
}: {
  title: string;
  datasets: Dataset[];
  preferredThemeIds: string[];
  selectedDatasets: Set<string>;
  onToggleDataset: (dataset: Dataset) => void;
  onClose: () => void;
}) {
  const selectedCount = datasets.filter((dataset) => selectedDatasets.has(dataset.id)).length;
  const [detailDataset, setDetailDataset] = useState<Dataset | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={detailDataset ? `${detailDataset.name} details` : `Add datasets for ${title}`}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 p-5">
          <div className="min-w-0">
            {detailDataset ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-2 gap-2 px-0 text-blue-700 hover:bg-transparent"
                onClick={() => setDetailDataset(null)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to datasets
              </Button>
            ) : null}
            <h3 className="text-lg font-semibold text-neutral-950">
              {detailDataset ? detailDataset.name : `Add datasets for ${title}`}
            </h3>
            {!detailDataset && (
              <p className="mt-1 text-sm text-neutral-600">
                Select datasets for this indicator role. {selectedCount} of {datasets.length} selected.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 hover:bg-neutral-100"
            aria-label="Close dataset picker"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {detailDataset ? (
          <div className="min-h-0 overflow-y-auto">
            <DatasetDetailContent dataset={detailDataset} preferredThemeIds={preferredThemeIds} />
          </div>
        ) : (
          <>
            <div className="min-h-0 overflow-y-auto p-3">
              <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {datasets.map((dataset) => (
                  <RoleDatasetPickerRow
                    key={dataset.id}
                    dataset={dataset}
                    isSelected={selectedDatasets.has(dataset.id)}
                    onToggle={onToggleDataset}
                    onViewDetails={setDetailDataset}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end border-t border-neutral-200 p-4">
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RoleDatasetPickerRow({
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
  const compatibilityScore = getDatasetCompatibilityScore(dataset);
  const publishedYear = extractYearFromDate(dataset.publicationDate);

  return (
    <div className={`flex items-start gap-3 p-3 ${isSelected ? "bg-blue-50/60" : "bg-white"}`}>
      <button
        type="button"
        onClick={() => onToggle(dataset)}
        aria-label={isSelected ? "Deselect dataset" : "Select dataset"}
        className="mt-1 shrink-0"
      >
        {isSelected ? (
          <CheckCircle2 className="h-5 w-5 text-blue-600" />
        ) : (
          <Circle className="h-5 w-5 text-neutral-300" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug text-neutral-950">{dataset.name}</p>
        <p className="mt-1 text-xs text-neutral-500">
          {dataset.provider}
          {publishedYear !== "Unknown" ? ` · ${publishedYear}` : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <MatchScoreBadge dataset={dataset} score={compatibilityScore} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => onViewDetails(dataset)}
        >
          <Eye className="h-4 w-4" />
          Details
        </Button>
      </div>
    </div>
  );
}

function RoleDatasetCard({
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
  const compatibilityScore = getDatasetCompatibilityScore(dataset);
  const publishedYear = extractYearFromDate(dataset.publicationDate);

  return (
    <article className={`rounded-md border bg-white p-3 shadow-sm ${isSelected ? "border-blue-500 ring-1 ring-blue-500" : "border-neutral-200"}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggle(dataset)}
          aria-label={isSelected ? "Deselect dataset" : "Select dataset"}
          className="mt-1 shrink-0"
        >
          {isSelected ? (
            <CheckCircle2 className="w-5 h-5 text-blue-600" />
          ) : (
            <Circle className="w-5 h-5 text-neutral-300" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <MatchScoreBadge dataset={dataset} score={compatibilityScore} />
          </div>
          <h4 className="font-semibold leading-snug text-neutral-950">{dataset.name}</h4>
          <p className="mt-1 text-xs text-neutral-500">
            {dataset.provider}
            {publishedYear !== "Unknown" ? ` · ${publishedYear}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => onViewDetails(dataset)}>
          <Eye className="w-4 h-4" />
          Details
        </Button>
      </div>
    </article>
  );
}

function MatchScoreBadge({
  dataset,
  score,
}: {
  dataset: Dataset;
  score: number | undefined;
}) {
  return (
    <span className={`inline-flex shrink-0 items-baseline gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold shadow-sm ${datasetCompatibilityBadgeClass(dataset)}`}>
      <span>Match</span>
      <span className="text-sm leading-none">{formatDatasetCompatibilityScore(score)}</span>
    </span>
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
