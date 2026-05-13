import { IndicatorRequest, Dataset, DatasetFitAnalysis } from "./types";

/**
 * Small in-memory workflow store shared by route components.
 *
 * The app does not have authentication or persisted user sessions yet, so this
 * store keeps only the current indicator, selected datasets, source choices,
 * and cached fit analysis for the active browser session.
 */
class AppStore {
  // Indicator analysis state collected in steps 1 and 2.
  private indicatorRequest: IndicatorRequest | null = null;
  private extractedThemes: string[] = [];
  private themeConfidence: Record<string, number> = {};

  // Dataset selection and source state used in steps 3 through 5.
  private selectedDatasets: Map<string, Dataset> = new Map();
  private activeApiSources: Set<string> = new Set();

  // Cached review result; any selection or indicator change invalidates it.
  private datasetFitAnalysis: DatasetFitAnalysis | null = null;

  setIndicatorRequest(request: IndicatorRequest) {
    this.indicatorRequest = request;
    this.selectedDatasets.clear();
    this.datasetFitAnalysis = null;
  }

  getIndicatorRequest(): IndicatorRequest | null {
    return this.indicatorRequest;
  }

  setExtractedThemes(themes: string[]) {
    this.extractedThemes = themes;
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
    this.datasetFitAnalysis = null;
  }

  setDatasetSelected(dataset: Dataset, isSelected: boolean) {
    if (isSelected) {
      this.selectedDatasets.set(dataset.id, dataset);
    } else {
      this.selectedDatasets.delete(dataset.id);
    }
    this.datasetFitAnalysis = null;
  }

  isDatasetSelected(datasetId: string): boolean {
    return this.selectedDatasets.has(datasetId);
  }

  getSelectedDatasets(): Dataset[] {
    return Array.from(this.selectedDatasets.values());
  }

  clearSelectedDatasets() {
    this.selectedDatasets.clear();
    this.datasetFitAnalysis = null;
  }

  setDatasetFitAnalysis(analysis: DatasetFitAnalysis | null) {
    this.datasetFitAnalysis = analysis;
  }

  getDatasetFitAnalysis(): DatasetFitAnalysis | null {
    return this.datasetFitAnalysis;
  }

  reset() {
    this.indicatorRequest = null;
    this.selectedDatasets.clear();
    this.extractedThemes = [];
    this.themeConfidence = {};
    this.activeApiSources.clear();
    this.datasetFitAnalysis = null;
  }
}

export const appStore = new AppStore();
