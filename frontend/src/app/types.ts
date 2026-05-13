export interface IndicatorRequest {
  description: string;
  geographicLevel: string;
  timeFrame: string;
  population: string;
  attributes: string[];
}

export interface DataTheme {
  name: string;
  datasets: string[];
  explanation: string;
  recommended?: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  nameOriginal?: string;
  nameEn?: string;
  provider: string;
  source?: string;
  apiUrl?: string;
  formats?: string[];
  spatialCoverage: string;
  spatialResolution: string;
  updateFrequency: string;
  lastUpdate: string;
  publicationDate: string;
  accessType: "open" | "restricted" | "request";
  theme: string;
  themes?: string[];
  matchingThemes?: string[];
  category: string;
  categories?: Array<Record<string, number>>;
  categoryConfidence?: number;
  categoryMethod?: string;
  schemaFields?: Array<{ name: string; inferred_type: string; description: string }>;
  previewAvailable?: boolean;
  essential: boolean;
  relevanceScore?: number;
  quality: {
    completeness: number;
    timeliness: "recent" | "moderate" | "outdated";
    consistency: "high" | "medium" | "low";
    documentation: "excellent" | "good" | "limited";
  };
  description: string;
  descriptionOriginal?: string;
  descriptionEn?: string;
  usageExplanation: string;
}

export interface DatasetFitColumnInsight {
  name: string;
  inferred_type: string;
  semantic_role: string;
  sample_values: string[];
  confidence: number;
  notes: string;
}

export interface DatasetFitInsight {
  dataset_id: string;
  title: string;
  provider: string;
  formats?: string[];
  source_url?: string;
  fit_score: number;
  recommended_role: string;
  fit_summary: string;
  useful_columns: DatasetFitColumnInsight[];
  limitations: string[];
  missing_requirements: string[];
  join_keys: string[];
  time_fields: string[];
  geo_fields: string[];
  quality_risks: string[];
  recommended_next_action: string;
}

export interface CrossDatasetFitSummary {
  summary: string;
  join_strategy: string[];
  gaps: string[];
  recommended_workflow: string[];
}

export interface DatasetFitAnalysis {
  insight_source: string;
  datasets: DatasetFitInsight[];
  recommended_dataset_ids: string[];
  cross_dataset_summary: CrossDatasetFitSummary;
  warnings: string[];
}

export interface DatasetFitAnalysisRequest {
  indicator_text: string;
  selected_themes: string[];
  dataset_ids: string[];
  dataset_snapshots?: Dataset[];
  parsed_indicator: Record<string, unknown>;
  preview_rows?: number;
}
