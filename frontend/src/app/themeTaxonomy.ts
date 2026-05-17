export interface ThemeGroup {
  id: string;
  label: string;
  themeIds: string[];
}

export interface DatasetCategoryDisplay {
  primary: ThemeGroup;
  secondaryThemeIds: string[];
  overflowCount: number;
}

interface ThemeGroupDefinition {
  id: string;
  label: string;
  themeIds: string[];
}

const THEME_GROUPS: ThemeGroupDefinition[] = [
  {
    id: "mobility_access",
    label: "Mobility and Access",
    themeIds: ["transport_networks", "accessibility_proximity"],
  },
  {
    id: "people_services",
    label: "People and Services",
    themeIds: ["population", "socioeconomic_context", "employment", "health", "education"],
  },
  {
    id: "environment_climate",
    label: "Environment and Climate",
    themeIds: ["green_space", "water_management", "air_quality", "heat_exposure"],
  },
  {
    id: "urban_form",
    label: "Land Use, Buildings, and Boundaries",
    themeIds: ["geographic_boundaries", "land_use", "housing_affordability"],
  },
];

const THEME_LABELS: Record<string, string> = {
  accessibility: "Public Facilities and Services",
  accessibility_proximity: "Public Facilities and Services",
  density: "Density",
  geographic_boundaries: "Geographic Boundaries",
  green_space: "Parks, Trees, and Green Spaces",
  water_management: "Water Management",
  land_use: "Buildings and Land Use",
  proximity: "Nearby Distance",
  socioeconomic_context: "Income, Age, and Equity",
  bus_stop_accessibility: "How Close Bus Stops Are",
  public_transport_stops: "Public Transport Stops",
  population_distribution: "Population Counts",
  walking_distance: "Walking Distance",
  transport_networks: "Transit, Bike Routes, and Streets",
  population: "Population Counts",
  housing_affordability: "Housing and Rent",
  air_quality: "Air Quality and Pollution",
  heat_exposure: "Heat and Temperature",
  employment: "Jobs and Workers",
  health: "Healthcare and Health",
  education: "Schools and Education",
  schools: "Schools",
  school: "School Locations",
  school_access: "School Access",
  school_accessibility: "How Close Schools Are",
  school_locations: "School Locations",
  school_catchments: "Areas Served by Schools",
  school_catchment_areas: "Areas Served by Schools",
  education_facilities: "Education Facilities",
  childcare: "Childcare Facilities",
  daycare: "Daycare Facilities",
  park_access: "How Close Parks Are",
  park_accessibility: "How Close Parks Are",
  park_locations: "Park Locations",
  parks: "Parks",
  public_parks: "Public Parks",
  green_area: "Green Area",
  green_areas: "Green Areas",
  open_space: "Open Space",
  tree_canopy: "Tree Canopy",
  canopy_cover: "Canopy Cover",
  urban_forest: "Urban Forest",
  vegetation: "Vegetation",
  shade: "Shade",
  heat: "Heat",
  urban_heat: "Urban Heat",
  urban_heat_island: "Urban Heat Island",
  extreme_heat: "Very Hot Areas",
  temperature: "Temperature",
  surface_temperature: "Surface Heat",
  thermal_comfort: "Outdoor Comfort",
  cooling: "Cooling",
  healthcare_access: "How Close Healthcare Is",
  health_facilities: "Hospitals and Clinics",
  primary_care: "Primary Care",
  clinics: "Clinics",
  hospitals: "Hospitals",
  cycling_network: "Bike Routes",
  bike_lanes: "Bike Lanes",
  cycle_lanes: "Cycle Lanes",
  protected_cycling_lanes: "Protected Cycling Lanes",
  cycling_access: "How Close Bike Routes Are",
  public_facilities: "Public Facilities",
  community_facilities: "Community Facilities",
  public_services: "Public Services",
  facilities: "Facilities",
  low_emission_zones: "Low-Emission Zones",
  emissions: "Emissions",
  air_pollution: "Air Pollution",
  pedestrian_network: "Pedestrian Network",
  walkability: "Walkability",
};

const IGNORED_THEME_IDS = new Set(["", "general", "other", "uncategorized", "unknown"]);

const THEME_TO_GROUP = THEME_GROUPS.reduce<Record<string, ThemeGroupDefinition>>((acc, group) => {
  group.themeIds.forEach((themeId) => {
    acc[themeId] = group;
  });
  return acc;
}, {});

export function normalizeThemeId(themeId: string): string {
  return themeId.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function formatThemeName(themeId: string): string {
  const normalizedKey = normalizeThemeId(themeId);

  if (THEME_LABELS[normalizedKey]) {
    return THEME_LABELS[normalizedKey];
  }

  return themeId
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z]{2,}$/.test(word)) return word;
      if (/^\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function datasetThemeIds(dataset: {
  theme?: string;
  themes?: string[];
  matchingThemes?: string[];
}): string[] {
  return uniqueThemeIds([
    dataset.theme || "",
    ...(dataset.themes || []),
    ...(dataset.matchingThemes || []),
  ]);
}

export function getThemeGroupsForThemes(themeIds: string[], fallbackLabel = "Uncategorized"): ThemeGroup[] {
  const grouped = new Map<string, ThemeGroup>();

  uniqueThemeIds(themeIds).forEach((themeId) => {
    if (IGNORED_THEME_IDS.has(themeId)) return;

    const group = THEME_TO_GROUP[themeId] || {
      id: "other",
      label: "Other",
      themeIds: [],
    };
    const current = grouped.get(group.id) || {
      id: group.id,
      label: group.label,
      themeIds: [],
    };
    current.themeIds.push(themeId);
    grouped.set(group.id, current);
  });

  const groups = Array.from(grouped.values()).sort((a, b) => groupSortIndex(a.id) - groupSortIndex(b.id));
  if (groups.length > 0) return groups;

  const fallbackId = normalizeThemeId(fallbackLabel || "Uncategorized") || "uncategorized";
  return [{
    id: fallbackId,
    label: fallbackLabel || "Uncategorized",
    themeIds: [],
  }];
}

export function getCatalogMainCategoryLabels(): string[] {
  return [...THEME_GROUPS.map((group) => group.label), "Other"];
}

export function getDatasetCategoryDisplay(
  dataset: {
    name?: string;
    description?: string;
    category?: string;
    theme?: string;
    themes?: string[];
    matchingThemes?: string[];
  },
  preferredThemeIds: string[] = []
): DatasetCategoryDisplay {
  const matchingThemeIds = uniqueThemeIds(dataset.matchingThemes || []);
  const allThemeIds = uniqueThemeIds([
    ...matchingThemeIds,
    dataset.theme || "",
    ...(dataset.themes || []),
  ]);
  const groups = getThemeGroupsForThemes(allThemeIds, dataset.category || "Uncategorized");
  const preferredSet = new Set(uniqueThemeIds(preferredThemeIds));
  const matchingSet = new Set(matchingThemeIds);
  const textBlob = normalizeThemeId([
    dataset.name || "",
    dataset.description || "",
    dataset.category || "",
  ].join(" "));

  const primary = [...groups].sort((a, b) => {
    const scoreDifference = categoryGroupScore(b, textBlob, dataset.category || "", preferredSet, matchingSet)
      - categoryGroupScore(a, textBlob, dataset.category || "", preferredSet, matchingSet);
    if (scoreDifference !== 0) return scoreDifference;
    return groupSortIndex(a.id) - groupSortIndex(b.id);
  })[0];

  const primaryThemeIds = sortSecondaryThemeIds(primary.themeIds, preferredSet, matchingSet);
  const otherThemeIds = sortSecondaryThemeIds(
    groups
      .filter((group) => group.id !== primary.id)
      .flatMap((group) => group.themeIds),
    preferredSet,
    matchingSet
  );
  const secondaryThemeIds = uniqueThemeIds([...primaryThemeIds, ...otherThemeIds]).slice(0, 3);
  const totalSecondaryCount = uniqueThemeIds([...primary.themeIds, ...otherThemeIds]).length;

  return {
    primary,
    secondaryThemeIds,
    overflowCount: Math.max(0, totalSecondaryCount - secondaryThemeIds.length),
  };
}

export function groupThemesByMainTheme<T>(
  items: T[],
  getThemeId: (item: T) => string
): Array<{ id: string; label: string; items: T[] }> {
  const grouped = new Map<string, { id: string; label: string; items: T[] }>();

  items.forEach((item) => {
    const themeId = normalizeThemeId(getThemeId(item));
    const group = THEME_TO_GROUP[themeId] || {
      id: "other",
      label: "Other",
      themeIds: [],
    };
    const current = grouped.get(group.id) || {
      id: group.id,
      label: group.label,
      items: [],
    };
    current.items.push(item);
    grouped.set(group.id, current);
  });

  return Array.from(grouped.values()).sort((a, b) => groupSortIndex(a.id) - groupSortIndex(b.id));
}

function uniqueThemeIds(themeIds: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  themeIds.forEach((themeId) => {
    const normalized = normalizeThemeId(themeId);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    unique.push(normalized);
  });

  return unique;
}

function categoryGroupScore(
  group: ThemeGroup,
  textBlob: string,
  datasetCategory: string,
  preferredSet: Set<string>,
  matchingSet: Set<string>
): number {
  const normalizedCategory = normalizeThemeId(datasetCategory);
  let score = 0;

  if (normalizedCategory === group.id || normalizeThemeId(group.label) === normalizedCategory) {
    score += 10;
  }
  if (normalizeThemeId(group.label).split("_").some((token) => token.length > 3 && textBlob.includes(token))) {
    score += 2;
  }

  group.themeIds.forEach((themeId) => {
    if (preferredSet.has(themeId)) score += 6;
    if (matchingSet.has(themeId)) score += 5;
    if (textBlob.includes(themeId)) score += 3;

    const labelTokens = normalizeThemeId(formatThemeName(themeId)).split("_");
    if (labelTokens.some((token) => token.length > 3 && textBlob.includes(token))) {
      score += 2;
    }
  });

  return score;
}

function sortSecondaryThemeIds(
  themeIds: string[],
  preferredSet: Set<string>,
  matchingSet: Set<string>
): string[] {
  return uniqueThemeIds(themeIds).sort((a, b) => {
    const aScore = (preferredSet.has(a) ? 2 : 0) + (matchingSet.has(a) ? 1 : 0);
    const bScore = (preferredSet.has(b) ? 2 : 0) + (matchingSet.has(b) ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;
    return formatThemeName(a).localeCompare(formatThemeName(b));
  });
}

function groupSortIndex(groupId: string): number {
  const index = THEME_GROUPS.findIndex((group) => group.id === groupId);
  return index === -1 ? THEME_GROUPS.length : index;
}
