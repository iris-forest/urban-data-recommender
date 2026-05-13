import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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
import { getCompletenessColorClass } from "../qualityDisplay";

interface DatasetCardProps {
  dataset: Dataset;
  isSelected: boolean;
  onToggle: (dataset: Dataset) => void;
  onViewDetails: (dataset: Dataset) => void;
}

export function DatasetCard({ 
  dataset, 
  isSelected, 
  onToggle, 
  onViewDetails 
}: DatasetCardProps) {
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
                    Essential
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {dataset.category || "Uncategorized"}
                </Badge>
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

          {/* Quality indicators */}
          <div className="bg-neutral-50 rounded p-3 border border-neutral-200">
            <p className="text-xs text-neutral-500 mb-2">Quality Screening</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-600">Completeness</span>
                <span className={`font-medium ${getCompletenessColorClass(dataset.quality.completeness)}`}>
                  {dataset.quality.completeness}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">Consistency</span>
                <span className="font-medium capitalize">{dataset.quality.consistency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">Documentation</span>
                <span className="font-medium capitalize">{dataset.quality.documentation}</span>
              </div>
            </div>
          </div>

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
