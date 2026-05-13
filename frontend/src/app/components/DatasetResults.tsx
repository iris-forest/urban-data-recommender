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
  LayoutGrid,
  List,
  Loader
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
import { getCompletenessColorClass } from "../qualityDisplay";

type DatasetViewMode = "cards" | "table";

const RECOMMENDATION_LOADING_STATUSES = [
  "Reading your selected data themes...",
  "Searching imported and cached catalogs...",
  "Matching datasets to the indicator text...",
  "Scoring relevance and data quality...",
  "Pre-selecting essential datasets...",
  "Preparing the dataset list...",
];
const LOADING_STATUS_ROTATION_MS = 3600;

// Recommendation results can miss an essential flag for a selected theme when
// external metadata is thin. This pass ensures each selected theme has at least
// one strong pre-selected candidate when a matching dataset is available.
function applySelectedThemeEssentials(
  datasets: Dataset[],
  selectedThemes: string[]
): Dataset[] {
  const selectedThemeIds = selectedThemes.map(normalizeThemeId).filter(Boolean);
  if (selectedThemeIds.length === 0) return datasets;

  const nextDatasets = datasets.map((dataset) => ({ ...dataset }));

  selectedThemeIds.forEach((themeId) => {
    const alreadyEssential = nextDatasets.some(
      (dataset) => dataset.essential && datasetMatchesTheme(dataset, themeId)
    );
    if (alreadyEssential) return;

    const bestMatch = nextDatasets
      .filter((dataset) => datasetMatchesTheme(dataset, themeId))
      .sort(compareDatasetStrength)[0];

    if (bestMatch) {
      bestMatch.essential = true;
    }
  });

  return nextDatasets;
}

function prioritizeSelectedEssentials(
  datasets: Dataset[],
  selectedDatasetIds: Set<string>
): Dataset[] {
  // Selected essentials are kept at the top so users can immediately see the
  // datasets that will carry into the fit-review step.
  return [...datasets].sort((a, b) => {
    const aSelectedEssential = a.essential && selectedDatasetIds.has(a.id);
    const bSelectedEssential = b.essential && selectedDatasetIds.has(b.id);
    if (aSelectedEssential !== bSelectedEssential) {
      return aSelectedEssential ? -1 : 1;
    }
    if (a.essential !== b.essential) return a.essential ? -1 : 1;
    return compareDatasetStrength(a, b);
  });
}

function datasetMatchesTheme(dataset: Dataset, themeId: string): boolean {
  const datasetThemes = [
    dataset.theme,
    ...(dataset.themes || []),
    ...(dataset.matchingThemes || []),
  ].map(normalizeThemeId);

  return datasetThemes.includes(themeId);
}

function compareDatasetStrength(a: Dataset, b: Dataset): number {
  const scoreA = a.relevanceScore ?? 0;
  const scoreB = b.relevanceScore ?? 0;
  if (scoreA !== scoreB) return scoreB - scoreA;

  const qualityA = datasetQualityScore(a);
  const qualityB = datasetQualityScore(b);
  if (qualityA !== qualityB) return qualityB - qualityA;

  return a.name.localeCompare(b.name);
}

function datasetQualityScore(dataset: Dataset): number {
  const freshness = { recent: 1, moderate: 0.65, outdated: 0.25 }[dataset.quality.timeliness];
  const consistency = { high: 1, medium: 0.65, low: 0.25 }[dataset.quality.consistency];
  const documentation = { excellent: 1, good: 0.75, limited: 0.35 }[dataset.quality.documentation];

  return (
    dataset.quality.completeness / 100 +
    freshness +
    consistency +
    documentation
  ) / 4;
}

function normalizeThemeId(themeId: string): string {
  return themeId.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function DatasetResults() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [filteredDatasets, setFilteredDatasets] = useState<Dataset[]>([]);
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set());
  const [detailDataset, setDetailDataset] = useState<Dataset | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAccess, setFilterAccess] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
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

  useEffect(() => {
    const request = appStore.getIndicatorRequest();
    if (!request) {
      navigate("/");
      return;
    }

    // Load recommendations once for the current indicator, then reconcile them
    // with active source filters and any selection stored from prior navigation.
    const loadDatasets = async () => {
      try {
        setIsLoading(true);
        setLoadingStatusStep(0);
        setError(null);

        const response = await getRecommendations(
          request.description,
          appStore.getExtractedThemes()
        );

        const convertedDatasets = response.recommendations.map((apiDataset) =>
          convertApiDatasetToReactDataset(apiDataset)
        );

        const selectedThemes = appStore.getExtractedThemes();
        const withThemeEssentials = applySelectedThemeEssentials(
          filterByActiveSources(convertedDatasets),
          selectedThemes
        );

        const visibleIds = new Set(withThemeEssentials.map((d) => d.id));
        const persistedSelection = appStore
          .getSelectedDatasets()
          .filter((dataset) => visibleIds.has(dataset.id))
          .map((dataset) => dataset.id);
        const essentialDatasets = withThemeEssentials.filter((d) => d.essential);
        const nextSelectedIds = new Set([
          ...persistedSelection,
          ...essentialDatasets.map((dataset) => dataset.id),
        ]);
        const prioritizedDatasets = prioritizeSelectedEssentials(
          withThemeEssentials,
          nextSelectedIds
        );

        setDatasets(prioritizedDatasets);
        setFilteredDatasets(prioritizedDatasets);

        appStore.clearSelectedDatasets();
        prioritizedDatasets.forEach((dataset) => {
          appStore.setDatasetSelected(dataset, nextSelectedIds.has(dataset.id));
        });
        setSelectedDatasets(nextSelectedIds);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load datasets";
        setError(message);
        console.error("Error loading datasets:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadDatasets();
  }, [navigate]);

  useEffect(() => {
    // Search and filter are local-only so the user can change views without
    // waiting for another recommendation request.
    let filtered = datasets;

    if (searchTerm) {
      const normalizedSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (d: Dataset) =>
          d.name.toLowerCase().includes(normalizedSearch) ||
          d.provider.toLowerCase().includes(normalizedSearch) ||
          d.category.toLowerCase().includes(normalizedSearch) ||
          (d.source || "").toLowerCase().includes(normalizedSearch)
      );
    }

    if (filterAccess !== "all") {
      filtered = filtered.filter((d: Dataset) => d.accessType === filterAccess);
    }

    if (filterCategory !== "all") {
      filtered = filtered.filter((d: Dataset) => d.category === filterCategory);
    }

    setFilteredDatasets(filtered);
  }, [searchTerm, filterAccess, filterCategory, datasets]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterAccess, filterCategory, datasets.length]);

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

  const categories: string[] = Array.from(
    new Set(datasets.map((d: Dataset) => d.category || "Uncategorized"))
  ).sort((a, b) => a.localeCompare(b));
  const missingEssential = datasets.filter(
    (d: Dataset) => d.essential && !selectedDatasets.has(d.id)
  );

  const handleContinue = () => {
    if (missingEssential.length > 0) {
      const confirmed = window.confirm(
        `You haven't selected ${missingEssential.length} essential dataset(s). Are you sure you want to continue?`
      );
      if (!confirmed) return;
    }
    navigate("/dataset-fit");
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
                  Make sure the backend API is running on port 8000. Run: cd backend && ../.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
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
        {/* Page header and recommendation context */}
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <div>
            <h1 className="text-2xl mb-2">Available Datasets for Madrid</h1>
            <p className="text-neutral-600">
              Review and select datasets that match your indicator requirements. Essential datasets for your selected themes are pre-selected and shown first.
            </p>
          </div>
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
              value={filterAccess}
              onChange={(e) => setFilterAccess(e.target.value)}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm"
            >
              <option value="all">All Access Types</option>
              <option value="open">Open Access</option>
              <option value="restricted">Restricted</option>
              <option value="request">Request Needed</option>
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm text-neutral-600">
            <span>Showing {filteredDatasets.length} of {datasets.length} datasets</span>
            <span>•</span>
            <span>{selectedDatasets.size} selected</span>
          </div>
        </div>

        {/* Selection quality warning before continuing to fit review */}
        {missingEssential.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-amber-900 font-medium mb-1">
                Warning: Missing Essential Datasets
              </p>
              <p className="text-amber-800">
                You have not selected {missingEssential.length} essential dataset(s).
                This may limit the accuracy of your indicator.
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

        <div className="text-center text-sm text-neutral-500">
          Step 3 of 5: Select datasets
        </div>
      </div>

      {/* Lazy dataset detail panel */}
      {detailDataset && (
        <DatasetDetailPanel
          dataset={detailDataset}
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
  if (viewMode === "table") {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Select</TableHead>
              <TableHead>Dataset</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead>Quality</TableHead>
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
  return (
    <TableRow data-state={isSelected ? "selected" : undefined}>
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
        <div className="flex flex-wrap gap-2 mb-1">
          {dataset.essential && <Badge className="bg-blue-600">Essential</Badge>}
        </div>
        <p className="font-medium leading-snug">{dataset.name}</p>
        <p className="text-xs text-neutral-500">{dataset.provider}</p>
      </TableCell>
      <TableCell className="whitespace-normal">
        <Badge variant="secondary">{dataset.category || "Uncategorized"}</Badge>
      </TableCell>
      <TableCell className="whitespace-normal">
        <p className="font-medium">{dataset.spatialCoverage}</p>
        <p className="text-xs text-neutral-500">{dataset.spatialResolution}</p>
      </TableCell>
      <TableCell>
        <p className={`font-medium ${getCompletenessColorClass(dataset.quality.completeness)}`}>
          {dataset.quality.completeness}%
        </p>
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

function formatAccessLabel(accessType: Dataset["accessType"]): string {
  if (accessType === "open") return "Open";
  if (accessType === "restricted") return "Restricted";
  return "Request";
}
