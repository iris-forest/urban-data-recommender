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

export interface DatasetResource {
  id?: string;
  name: string;
  description?: string;
  format?: string;
  url: string;
}

export type CompatibilityBand = "strong" | "partial" | "weak";

export interface CompatibilityEvidence {
  matched_concepts: string[];
  missing_concepts: string[];
  geography: string;
  time: string;
  summary: string;
}

export interface CompatibilitySignal {
  id: string;
  label: string;
  score: number; // 0.0 - 1.0
  percentage: number; // 0 - 100
  weight: number; // 0.0 - 1.0
  contribution: number; // 0.0 - 1.0 (score * weight)
}

export interface CompatibilityBreakdown {
  weights: Record<string, number>;
  signals: CompatibilitySignal[];
  final_score: number; // 0.0 - 1.0
  final_percentage: number; // 0 - 100
  final_adjustment: number; // signed 0.0 - 1.0 residual to the final score
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
  resources?: DatasetResource[];
  provenance?: string;
  dataTypes?: string[];
  spatialCoverage: string;
  spatialResolution: string;
  updateFrequency: string;
  lastUpdate: string;
  publicationDate: string;
  accessType: "open" | "restricted" | "request";
  theme: string;
  themes?: string[];
  matchingThemes?: string[];
  focusedMatchingThemes?: string[];
  category: string;
  categories?: Array<Record<string, number>>;
  categoryConfidence?: number;
  categoryMethod?: string;
  schemaFields?: Array<{ name: string; inferred_type: string; description: string }>;
  previewAvailable?: boolean;
  essential: boolean;
  relevanceScore?: number;
  compatibilityScore?: number;
  compatibilityReason?: string;
  semanticScore?: number;
  compatibilityBand?: CompatibilityBand;
  compatibilityEvidence?: CompatibilityEvidence;
  compatibilityBreakdown?: CompatibilityBreakdown;
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

export interface EdaCheckItem {
  id: string;
  status: "good" | "check" | "caution" | "unknown" | string;
  message: string;
}

export interface EdaColumnProfile {
  name: string;
  inferred_type: string;
  missing_count: number;
  missing_pct: number;
  placeholder_count: number;
  distinct_count: number;
  sample_values: string[];
  flags: string[];
}

export interface PreviewSample {
  columns: Array<Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
  source_url: string;
  preview_source: string;
}

export interface EdaProfile {
  rows_analyzed: number;
  columns_analyzed: number;
  preview_rows_requested: number;
  metadata_only: boolean;
  preview_source?: string;
  preview_stats: Record<string, unknown>;
  column_profiles?: EdaColumnProfile[];
  profile_notes: string[];
}

export interface EdaFit {
  roles_found: string[];
  roles_missing: string[];
  join_keys: string[];
  time_fields: string[];
  geo_fields: string[];
}

export interface EdaInterpretation {
  readiness_band: string;
  quality_checks: EdaCheckItem[];
  synthesis: string;
}

export interface DatasetFitInsight {
  dataset_id: string;
  title: string;
  provider: string;
  formats?: string[];
  source_url?: string;
  fit_score: number;
  quality_score: number;
  quality_band: string;
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
  eda_profile?: EdaProfile;
  eda_fit?: EdaFit;
  eda_interpretation?: EdaInterpretation;
  preview_sample?: PreviewSample | null;
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

export type DatasetNotes = Record<string, string>;
