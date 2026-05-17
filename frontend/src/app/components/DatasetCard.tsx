import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";
import { 
  CheckCircle2, 
  Circle, 
  MapPin, 
  Clock, 
  RefreshCw, 
  Lock, 
  Unlock,
  AlertCircle,
  Info
} from "lucide-react";
import { Dataset } from "../types";
import {
  compatibilityBadgeClass,
  compatibilityBandLabel,
  formatCompatibilityScore,
  formatCompatibilityTooltip,
  getDatasetCompatibilityScore,
} from "../compatibilityDisplay";
import { formatFileTypeLabels } from "../fileFormats";
import { formatThemeName, getDatasetCategoryDisplay } from "../themeTaxonomy";

interface DatasetCardProps {
  dataset: Dataset;
  isSelected: boolean;
  preferredThemeIds?: string[];
  onToggle: (dataset: Dataset) => void;
  onViewDetails: (dataset: Dataset) => void;
}

export function DatasetCard({ 
  dataset, 
  isSelected, 
  preferredThemeIds = [],
  onToggle, 
  onViewDetails 
}: DatasetCardProps) {
  const categoryDisplay = getDatasetCategoryDisplay(dataset, preferredThemeIds);
  const compatibilityScore = getDatasetCompatibilityScore(dataset);

  const getAccessIcon = () => {
    switch (dataset.accessType) {
      case "open":
        return <Unlock className="w-4 h-4 text-green-600" />;
      case "restricted":
        return <Lock className="w-4 h-4 text-orange-600" />;
      case "request":
        return <AlertCircle className="w-4 h-4 text-amber-600" />;
    }
  };

  const getAccessLabel = () => {
    switch (dataset.accessType) {
      case "open":
        return "Open Access";
      case "restricted":
        return "Restricted";
      case "request":
        return "Request Needed";
    }
  };

  return (
    <Card className={`${isSelected ? "border-blue-500 border-2" : ""}`}>
      <CardContent className="p-5">
        <div className="space-y-4">
          {/* Header with selection */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {dataset.essential && (
                  <Badge variant="default" className="bg-blue-600">
                    Recommended
                  </Badge>
                )}
                <InfoBadge
                  label={`${compatibilityBandLabel(dataset)} ${formatCompatibilityScore(compatibilityScore)}`}
                  description={formatCompatibilityTooltip(dataset)}
                  className={compatibilityBadgeClass(dataset)}
                />
                <Badge variant="secondary" className="text-xs">
                  {categoryDisplay.primary.label}
                </Badge>
                {categoryDisplay.secondaryThemeIds.slice(0, 2).map((themeId) => (
                  <Badge key={themeId} variant="outline" className="text-xs">
                    {formatThemeName(themeId)}
                  </Badge>
                ))}
                {categoryDisplay.secondaryThemeIds.length > 2 || categoryDisplay.overflowCount > 0 ? (
                  <Badge variant="outline" className="text-xs">
                    +{Math.max(0, categoryDisplay.secondaryThemeIds.length - 2) + categoryDisplay.overflowCount} secondary
                  </Badge>
                ) : null}
                {dataset.dataTypes?.map((tag) => (
                  <InfoBadge key={tag} label={tag} description="Data type inferred from metadata and file formats." variant="outline" />
                ))}
              </div>
              <h3 className="font-semibold leading-snug mb-1">{dataset.name}</h3>
              <p className="text-sm text-neutral-500">{dataset.provider}</p>
            </div>
            <button
              onClick={() => onToggle(dataset)}
              className="flex-shrink-0 mt-1"
            >
              {isSelected ? (
                <CheckCircle2 className="w-6 h-6 text-blue-600" />
              ) : (
                <Circle className="w-6 h-6 text-neutral-300" />
              )}
            </button>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex gap-2">
              <MapPin className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-neutral-500">Coverage</p>
                <p className="font-medium">{dataset.spatialCoverage}</p>
                <p className="text-xs text-neutral-400">{dataset.spatialResolution}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Clock className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-neutral-500">Last Update</p>
                <p className="font-medium">{dataset.lastUpdate}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <RefreshCw className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-neutral-500">Update Frequency</p>
                <p className="font-medium">{dataset.updateFrequency}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {getAccessIcon()}
              <div>
                <p className="text-neutral-500">Access</p>
                <p className="font-medium">{getAccessLabel()}</p>
              </div>
            </div>
          </div>

          {dataset.formats?.length ? (
            <div className="flex flex-wrap gap-2">
              {formatFileTypeLabels(dataset.formats).map((format) => (
                <Badge key={format} variant="outline" className="text-xs">{format}</Badge>
              ))}
            </div>
          ) : null}

          {/* View details button */}
          <Button
            onClick={() => onViewDetails(dataset)}
            variant="outline"
            size="sm"
            className="w-full gap-2"
          >
            <Info className="w-4 h-4" />
            View Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoBadge({
  label,
  description,
  variant = "secondary",
  className,
}: {
  label: string;
  description: string;
  variant?: "secondary" | "outline";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className={`text-xs ${className || ""}`}>
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}
