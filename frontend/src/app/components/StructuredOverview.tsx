import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ArrowLeft, ArrowRight, MapPin, Calendar, Users, Check, Plus } from "lucide-react";
import { appStore } from "../store";
import { IndicatorRequest, DataTheme } from "../types";
import { formatGeographicLevel } from "../geographyDisplay";
import {
  inferClientPopulationFromIndicator,
  inferClientTimeFrameFromIndicator,
  inferClientThemesFromIndicator,
  mergeThemeIds,
} from "../api";

export function StructuredOverview() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<IndicatorRequest | null>(null);
  const [allThemes, setAllThemes] = useState<DataTheme[]>([]);
  const [selectedThemeNames, setSelectedThemeNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Build the review screen from the backend parse plus lightweight client
    // inferences, then pre-select the themes that are required for the query.
    const indicatorRequest = appStore.getIndicatorRequest();
    if (!indicatorRequest) {
      navigate("/");
      return;
    }
    setRequest(indicatorRequest);
    const extractedThemes = appStore.getExtractedThemes();
    const confidence = appStore.getThemeConfidence();
    const inferredThemes = inferClientThemesFromIndicator(indicatorRequest.description);
    const sourceThemes = mergeThemeIds(
      extractedThemes,
      indicatorRequest.attributes,
      inferredThemes
    );
    const detectedThemes = sourceThemes.map((themeId) => {
      const confidenceScore = confidence[themeId] ?? 0.6;
      return {
        name: themeId,
        datasets: [],
        explanation: getThemeHelpDescription(themeId, indicatorRequest),
        recommended: confidenceScore >= 0.5,
      };
    });
    const supportThemes = getOptionalSupportThemes(indicatorRequest, sourceThemes);
    const themes = [...detectedThemes, ...supportThemes];
    setAllThemes(themes);
    const recommended = new Set(
      themes.filter((t) => t.recommended).map((t) => t.name)
    );
    setSelectedThemeNames(recommended);
  }, [navigate]);

  const toggleTheme = (themeName: string) => {
    setSelectedThemeNames((prev) => {
      const next = new Set(prev);
      if (next.has(themeName)) {
        next.delete(themeName);
      } else {
        next.add(themeName);
      }
      return next;
    });
  };

  const recommendedThemes = allThemes.filter((t) => t.recommended);
  const optionalThemes = allThemes.filter((t) => !t.recommended);
  const displayedPopulation = request
    ? request.population || inferClientPopulationFromIndicator(request.description) || "Not specified"
    : "";
  const displayedTimeFrame = request ? getDisplayTimeFrame(request) : "";

  const handleContinue = () => {
    appStore.setExtractedThemes(Array.from(selectedThemeNames));
    navigate("/results");
  };

  if (!request) return null;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <h1 className="text-2xl mb-2">Structured Overview</h1>
          <p className="text-neutral-600">
            Your indicator has been analyzed and broken down into required components.
          </p>
        </div>

        {/* Original Request */}
        <Card>
          <CardHeader>
            <CardTitle>Your Indicator</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-neutral-700 italic">"{request.description}"</p>
          </CardContent>
        </Card>

        {/* Parsed Components */}
        <Card>
          <CardHeader>
            <CardTitle>Required Components</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex gap-3">
                <MapPin className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-neutral-500">Geographic Level</p>
                  <p className="font-medium">{formatGeographicLevel(request.geographicLevel)}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Calendar className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-neutral-500">Time Frame</p>
                  <p className="font-medium">{formatTimeFrameDisplay(displayedTimeFrame)}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Users className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-neutral-500">Population</p>
                  <p className="font-medium">{formatDisplayName(displayedPopulation)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Themes */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>Data themes</CardTitle>
              <span className="text-sm text-neutral-600">
                {selectedThemeNames.size} selected
              </span>
            </div>
            <p className="text-sm text-neutral-600">
              Recommended themes are pre-selected. Click to add or remove.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Recommended Themes */}
            <div className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-neutral-500 font-medium">
                Recommended
              </h3>
              <div className="space-y-2">
                {recommendedThemes.map((theme, idx) => (
                  <div
                    key={idx}
                    className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${
                      selectedThemeNames.has(theme.name)
                        ? "border-blue-600 bg-blue-50"
                        : "border-neutral-200 hover:border-blue-400 bg-white"
                    }`}
                    onClick={() => toggleTheme(theme.name)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          selectedThemeNames.has(theme.name)
                            ? "bg-blue-600 border-blue-600"
                            : "border-neutral-300"
                        }`}
                      >
                        {selectedThemeNames.has(theme.name) && (
                          <Check className="w-2.5 h-2.5 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{formatThemeName(theme.name)}</p>
                        <p className="text-xs text-neutral-600 mt-0.5">
                          {theme.explanation}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Optional Themes */}
            {optionalThemes.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-neutral-500 font-medium">
                  Optional
                </h3>
                <div className="space-y-2">
                  {optionalThemes.map((theme, idx) => (
                    <div
                      key={idx}
                      className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${
                        selectedThemeNames.has(theme.name)
                          ? "border-blue-600 bg-blue-50"
                          : "border-neutral-200 hover:border-neutral-300 bg-white"
                      }`}
                      onClick={() => toggleTheme(theme.name)}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            selectedThemeNames.has(theme.name)
                              ? "bg-blue-600 border-blue-600"
                              : "border-neutral-300"
                          }`}
                        >
                          {selectedThemeNames.has(theme.name) ? (
                            <Check className="w-2.5 h-2.5 text-white" />
                          ) : (
                            <Plus className="w-2.5 h-2.5 text-neutral-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{formatThemeName(theme.name)}</p>
                          <p className="text-xs text-neutral-600 mt-0.5">
                            {theme.explanation}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button
            onClick={() => navigate("/")}
            variant="outline"
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Button
            onClick={handleContinue}
            className="flex-1 gap-2"
            disabled={selectedThemeNames.size === 0}
          >
            Search for Datasets
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>

        {selectedThemeNames.size === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            Please select at least one data theme to continue.
          </div>
        )}

        <div className="text-center text-sm text-neutral-500">
          Step 2 of 5: Review components and data themes
        </div>
      </div>
    </div>
  );
}

function formatThemeName(themeId: string): string {
  return formatDisplayName(themeId);
}

function getOptionalSupportThemes(
  request: IndicatorRequest,
  requiredThemeIds: string[]
): DataTheme[] {
  // Optional themes are supporting layers that commonly help urban indicators
  // but are not required by the detected measure itself.
  const required = new Set(requiredThemeIds);
  const optionalIds: string[] = [];

  const geographicLevel = request.geographicLevel.trim().toLowerCase();
  const hints = getIndicatorTopicHints(request.description.toLowerCase());
  if (geographicLevel && geographicLevel !== "unknown") {
    optionalIds.push("geographic_boundaries");
  }

  if (required.has("heat_exposure") && hints.mentionsHeat) {
    optionalIds.push("green_space");
  }

  if (
    hasAnyTheme(required, [
      "air_quality",
      "heat_exposure",
      "water_management",
      "green_space",
      "housing_affordability",
      "transport_networks",
      "accessibility_proximity",
    ])
  ) {
    optionalIds.push("land_use");
  }

  if (
    hasAnyTheme(required, [
      "population",
      "transport_networks",
      "green_space",
      "water_management",
      "air_quality",
      "heat_exposure",
      "health",
      "education",
      "employment",
    ])
  ) {
    optionalIds.push("socioeconomic_context");
  }

  return mergeThemeIds(optionalIds)
    .filter((themeId) => !required.has(themeId))
    .map((themeId) => ({
      name: themeId,
      datasets: [],
      explanation: getThemeHelpDescription(themeId, request),
      recommended: false,
    }));
}

function hasAnyTheme(themeIds: Set<string>, candidates: string[]) {
  return candidates.some((themeId) => themeIds.has(themeId));
}

function getThemeHelpDescription(themeId: string, request: IndicatorRequest): string {
  // Descriptions use the user's indicator context so theme guidance reads like
  // a recommendation for this analysis, not a generic catalog definition.
  const description = request.description.toLowerCase();
  const population = getContextLabel(
    request.population || inferClientPopulationFromIndicator(request.description),
    "the target population"
  );
  const displayTimeFrame = getDisplayTimeFrame(request);
  const timeFrame = isUnknownValue(displayTimeFrame) ? "" : formatTimeFrameDisplay(displayTimeFrame);
  const timeClause = timeFrame ? ` during ${timeFrame}` : "";
  const hints = getIndicatorTopicHints(description);
  const isPerPersonMeasure = /\bper\s+(resident|capita|person|inhabitant)|por\s+(residente|habitante|persona)\b/.test(description);

  switch (themeId) {
    case "accessibility_proximity":
      if (hints.mentionsSchool) {
        return "Helps test whether schools or education facilities are close enough.";
      }
      if (hints.mentionsPark) {
        return "Helps show whether parks or green space are nearby.";
      }
      if (hints.mentionsHealthcare) {
        return "Helps show whether clinics, hospitals, or primary care are nearby.";
      }
      return hints.mentionsWalkingAccess
        ? "Helps use the walking time or distance named in the indicator."
        : "Helps find public facilities and services people may need nearby.";
    case "transport_networks":
      return hints.mentionsCycling
        ? "Provides bike lanes and cycling routes."
        : "Provides transit stops and routes.";
    case "population":
      return isPerPersonMeasure
        ? `Uses ${population} counts to make the per-person comparison.`
        : `Adds ${population} counts so results can be compared fairly.`;
    case "geographic_boundaries":
      return "Provides district, neighborhood, or small-area boundaries so results can be grouped and compared.";
    case "housing_affordability":
      return "Adds housing, rent, or homes data to compare residential pressure.";
    case "green_space":
      if (hints.mentionsHeat) {
        return "Adds parks, green spaces, trees, shade, and vegetation that can help explain where heat is worse.";
      }
      return isPerPersonMeasure
        ? "Provides the amount of park or green-space area."
        : "Locates parks, green spaces, trees, and open spaces.";
    case "water_management":
      return "Adds water, drainage, irrigation, flood, or wastewater data.";
    case "air_quality":
      return hints.mentionsLowEmissionZone
        ? `Identifies low-emission zones so results can match the zones in the indicator.`
        : `Adds pollution or emissions data for comparison${timeClause}.`;
    case "heat_exposure":
      return `Adds heat and temperature data for comparison${timeClause}.`;
    case "land_use":
      return hints.mentionsHeat
        ? "Adds buildings, paved surfaces, and city layout details that can explain heat patterns."
        : "Adds land use, buildings, and parcel details to explain why patterns differ.";
    case "socioeconomic_context":
      return hints.mentionsHeat
        ? "Adds age, income, and other context to show who may be most affected by heat."
        : "Adds income, age, and equity context to compare who benefits.";
    case "employment":
      return "Adds jobs or workforce data for labor-market and commuting-related comparisons.";
    case "health":
      return hints.mentionsHealthcare
        ? "Adds clinic, hospital, or primary-care locations."
        : "Adds clinics, hospitals, or health data.";
    case "education":
      return hints.mentionsSchool
        ? "Adds school locations, areas served by schools, or student counts."
        : "Adds schools, students, or education facilities.";
    default:
      return `Helps find datasets related to ${formatThemeName(themeId).toLowerCase()} for this indicator.`;
  }
}

function getContextLabel(value: string, fallback: string): string {
  if (isUnknownValue(value)) return fallback;
  const geographicLabel = formatGeographicLevel(value);
  if (geographicLabel !== value || geographicLabel.toLowerCase().startsWith("madrid city")) {
    return lowerFirst(geographicLabel);
  }
  return lowerFirst(formatDisplayName(value));
}

function isUnknownValue(value: string): boolean {
  return ["", "unknown", "not specified", "n/a"].includes(value.trim().toLowerCase());
}

function getDisplayTimeFrame(request: IndicatorRequest): string {
  if (!isUnknownValue(request.timeFrame)) return request.timeFrame;
  return inferClientTimeFrameFromIndicator(request.description) || request.timeFrame;
}

function lowerFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function getIndicatorTopicHints(description: string) {
  return {
    mentionsLowEmissionZone: /\b(low[-\s]?emission|lez|zbe|zona[s]? de bajas emisiones)\b/.test(description),
    mentionsWalkingAccess: /\b(walk|walking|minutes?|proximity|distance|nearby|catchment|service area)\b/.test(description),
    mentionsSchool: /\b(school|schools|education|student|students|childcare|daycare|kindergarten|nursery|colegio[s]?|escuela[s]?|centro[s]? educativo[s]?)\b/.test(description),
    mentionsPark: /\b(park|parks|green spaces?|open spaces?|tree canopy|canopy cover|canopy|shade|shaded|playground[s]?|garden[s]?|vegetation|zona[s]? verde[s]?|parque[s]?|jard[ií]n(?:es)?|arbolado|sombra)\b/.test(description),
    mentionsHeat: /\b(heat|urban heat|heat island|urban heat island|heat exposure|extreme heat|temperature|surface temperature|thermal|cooling|calor|isla de calor|temperatura)\b/.test(description),
    mentionsCycling: /\b(cycling|cyclist|bike|bikes|bicycle[s]?|bike lane[s]?|cycle lane[s]?|carril bici|ciclov[ií]a[s]?)\b/.test(description),
    mentionsHealthcare: /\b(healthcare|health care|hospital[s]?|clinic[s]?|primary care|health cent(?:er|re)[s]?|centro[s]? de salud)\b/.test(description),
  };
}

function formatDisplayName(value: string): string {
  const knownLabels: Record<string, string> = {
    accessibility: "Public Facilities and Services",
    "accessibility_proximity": "Public Facilities and Services",
    density: "Density",
    "geographic_boundaries": "Geographic Boundaries",
    "green_space": "Parks, Trees, and Green Spaces",
    "water_management": "Water Management",
    "land_use": "Buildings and Land Use",
    proximity: "Nearby Distance",
    "socioeconomic_context": "Income, Age, and Equity",
    "bus_stop_accessibility": "How Close Bus Stops Are",
    "public_transport_stops": "Public Transport Stops",
    "population_distribution": "Population Counts",
    "walking_distance": "Walking Distance",
    "transport_networks": "Transit, Bike Routes, and Streets",
    population: "Population Counts",
    "housing_affordability": "Housing and Rent",
    "air_quality": "Air Quality and Pollution",
    "heat_exposure": "Heat and Temperature",
    employment: "Jobs and Workers",
    health: "Healthcare and Health",
    education: "Schools and Education",
    schools: "Schools",
    school: "School Locations",
    "school_access": "School Access",
    "school_accessibility": "How Close Schools Are",
    "school_locations": "School Locations",
    "school_catchments": "Areas Served by Schools",
    "school_catchment_areas": "Areas Served by Schools",
    "education_facilities": "Education Facilities",
    childcare: "Childcare Facilities",
    daycare: "Daycare Facilities",
    "park_access": "How Close Parks Are",
    "park_accessibility": "How Close Parks Are",
    "park_locations": "Park Locations",
    parks: "Parks",
    "public_parks": "Public Parks",
    "green_area": "Green Area",
    "green_areas": "Green Areas",
    "open_space": "Open Space",
    "tree_canopy": "Tree Canopy",
    "canopy_cover": "Canopy Cover",
    "urban_forest": "Urban Forest",
    vegetation: "Vegetation",
    shade: "Shade",
    heat: "Heat",
    "urban_heat": "Urban Heat",
    "urban_heat_island": "Urban Heat Island",
    "extreme_heat": "Very Hot Areas",
    temperature: "Temperature",
    "surface_temperature": "Surface Heat",
    "thermal_comfort": "Outdoor Comfort",
    cooling: "Cooling",
    "healthcare_access": "How Close Healthcare Is",
    "health_facilities": "Hospitals and Clinics",
    "primary_care": "Primary Care",
    clinics: "Clinics",
    hospitals: "Hospitals",
    "cycling_network": "Bike Routes",
    "bike_lanes": "Bike Lanes",
    "cycle_lanes": "Cycle Lanes",
    "protected_cycling_lanes": "Protected Cycling Lanes",
    "cycling_access": "How Close Bike Routes Are",
    "public_facilities": "Public Facilities",
    "community_facilities": "Community Facilities",
    "public_services": "Public Services",
    facilities: "Facilities",
    "low_emission_zones": "Low-Emission Zones",
    emissions: "Emissions",
    "air_pollution": "Air Pollution",
    "pedestrian_network": "Pedestrian Network",
    walkability: "Walkability",
  };
  const normalizedKey = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (knownLabels[normalizedKey]) {
    return knownLabels[normalizedKey];
  }

  return value
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

function formatTimeFrameDisplay(value: string): string {
  if (isUnknownValue(value)) return "Not specified";

  const normalized = value.trim();
  const yearRangeMatch = /^((?:19|20)\d{2})\s*(?:-|\u2013|\u2014|to|through|until)\s*((?:19|20)\d{2})$/i.exec(normalized);
  if (yearRangeMatch) {
    return `${yearRangeMatch[1]}-${yearRangeMatch[2]}`;
  }

  const yearMatch = /^((?:19|20)\d{2})$/.exec(normalized);
  if (yearMatch) {
    return yearMatch[1];
  }

  const rollingMatch = /^rolling\s+last\s+(\d{1,2})\s+(day|week|month|year)s?$/i.exec(normalized);
  if (rollingMatch) {
    const amount = rollingMatch[1];
    const unit = rollingMatch[2].toLowerCase();
    const plural = amount === "1" ? "" : "s";
    return `Last ${amount} ${unit}${plural}`;
  }

  const lastMatch = /^last\s+(\d{1,2})\s+(day|week|month|year)s?$/i.exec(normalized);
  if (lastMatch) {
    const amount = lastMatch[1];
    const unit = lastMatch[2].toLowerCase();
    const plural = amount === "1" ? "" : "s";
    return `Last ${amount} ${unit}${plural}`;
  }

  return formatDisplayName(value);
}
