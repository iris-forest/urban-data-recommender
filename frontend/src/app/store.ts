import { IndicatorRequest, Dataset, DatasetFitAnalysis, DatasetNotes } from "./types";

type RecommendationCache = {
  key: string;
  datasets: Dataset[];
};

type FitAnalysisCache = {
  key: string;
  analysis: DatasetFitAnalysis;
};

/**
 * Small in-memory workflow store shared by route components.
 */
class AppStore {
  private indicatorRequest: IndicatorRequest | null = null;
  private extractedThemes: string[] = [];
  private themeConfidence: Record<string, number> = {};

  private selectedDatasets: Map<string, Dataset> = new Map();
  private activeApiSources: Set<string> = new Set();

  private recommendationCache: RecommendationCache | null = null;
  private datasetFitAnalysisCache: FitAnalysisCache | null = null;
  private datasetNotes: DatasetNotes = {};

  buildRecommendationCacheKey(
    description: string,
    themes: string[],
    activeSources: string[] = this.getActiveApiSources()
  ): string {
    return JSON.stringify({
      description: description.trim(),
      themes: [...themes].sort(),
      activeSources: [...activeSources].sort(),
    });
  }

  buildFitAnalysisCacheKey(
    indicatorText: string,
    themes: string[],
    datasetIds: string[],
    previewRows = 5
  ): string {
    return JSON.stringify({
      indicatorText: indicatorText.trim(),
      themes: [...themes].sort(),
      datasetIds: [...datasetIds].sort(),
      previewRows,
    });
  }

  invalidateRecommendationCache() {
    this.recommendationCache = null;
  }

  getRecommendationCache(cacheKey: string): Dataset[] | null {
    if (!this.recommendationCache || this.recommendationCache.key !== cacheKey) {
      return null;
    }
    return this.recommendationCache.datasets;
  }

  setRecommendationCache(cacheKey: string, datasets: Dataset[]) {
    this.recommendationCache = { key: cacheKey, datasets };
  }

  invalidateFitAnalysisCache() {
    this.datasetFitAnalysisCache = null;
  }

  getFitAnalysisCache(cacheKey: string): DatasetFitAnalysis | null {
    if (!this.datasetFitAnalysisCache || this.datasetFitAnalysisCache.key !== cacheKey) {
      return null;
    }
    return this.datasetFitAnalysisCache.analysis;
  }

  setFitAnalysisCache(cacheKey: string, analysis: DatasetFitAnalysis) {
    this.datasetFitAnalysisCache = { key: cacheKey, analysis };
  }

  setIndicatorRequest(request: IndicatorRequest) {
    this.indicatorRequest = request;
    this.selectedDatasets.clear();
    this.invalidateRecommendationCache();
    this.invalidateFitAnalysisCache();
    this.datasetNotes = {};
  }

  getIndicatorRequest(): IndicatorRequest | null {
    return this.indicatorRequest;
  }

  setExtractedThemes(themes: string[]) {
    this.extractedThemes = themes;
    this.invalidateRecommendationCache();
  }

  getExtractedThemes(): string[] {
    return this.extractedThemes;
  }

  setThemeConfidence(confidence: Record<string, number>) {
    this.themeConfidence = confidence;
  }

  getThemeConfidence(): Record<string, number> {
    return this.themeConfidence;
  }

  setApiSourceActive(sourceId: string, isActive: boolean) {
    if (isActive) {
      this.activeApiSources.add(sourceId);
    } else {
      this.activeApiSources.delete(sourceId);
    }
    this.invalidateRecommendationCache();
  }

  getActiveApiSources(): string[] {
    return Array.from(this.activeApiSources);
  }

  toggleDataset(dataset: Dataset) {
    if (this.selectedDatasets.has(dataset.id)) {
      this.selectedDatasets.delete(dataset.id);
    } else {
      this.selectedDatasets.set(dataset.id, dataset);
    }
    this.invalidateFitAnalysisCache();
  }

  setDatasetSelected(dataset: Dataset, isSelected: boolean) {
    if (isSelected) {
      this.selectedDatasets.set(dataset.id, dataset);
    } else {
      this.selectedDatasets.delete(dataset.id);
    }
    this.invalidateFitAnalysisCache();
  }

  isDatasetSelected(datasetId: string): boolean {
    return this.selectedDatasets.has(datasetId);
  }

  getSelectedDatasets(): Dataset[] {
    return Array.from(this.selectedDatasets.values());
  }

  clearSelectedDatasets() {
    this.selectedDatasets.clear();
    this.invalidateFitAnalysisCache();
  }

  setDatasetNote(datasetId: string, note: string) {
    const trimmedNote = note.trim();
    if (trimmedNote) {
      this.datasetNotes[datasetId] = note;
    } else {
      delete this.datasetNotes[datasetId];
    }
  }

  getDatasetNote(datasetId: string): string {
    return this.datasetNotes[datasetId] || "";
  }

  getDatasetNotes(): DatasetNotes {
    return { ...this.datasetNotes };
  }

  setDatasetFitAnalysis(analysis: DatasetFitAnalysis | null) {
    if (!analysis) {
      this.invalidateFitAnalysisCache();
      return;
    }
    const request = this.indicatorRequest;
    const datasetIds = this.getSelectedDatasets().map((dataset) => dataset.id);
    if (!request || datasetIds.length === 0) {
      return;
    }
    const cacheKey = this.buildFitAnalysisCacheKey(
      request.description,
      this.extractedThemes,
      datasetIds
    );
    this.setFitAnalysisCache(cacheKey, analysis);
  }

  getDatasetFitAnalysis(): DatasetFitAnalysis | null {
    const request = this.indicatorRequest;
    const datasetIds = this.getSelectedDatasets().map((dataset) => dataset.id);
    if (!request || datasetIds.length === 0) {
      return null;
    }
    const cacheKey = this.buildFitAnalysisCacheKey(
      request.description,
      this.extractedThemes,
      datasetIds
    );
    return this.getFitAnalysisCache(cacheKey);
  }

  reset() {
    this.indicatorRequest = null;
    this.selectedDatasets.clear();
    this.extractedThemes = [];
    this.themeConfidence = {};
    this.activeApiSources.clear();
    this.recommendationCache = null;
    this.datasetFitAnalysisCache = null;
    this.datasetNotes = {};
  }
}

export const appStore = new AppStore();
