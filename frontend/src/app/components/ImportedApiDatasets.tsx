import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Card, CardHeader, CardContent, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { clearImportedSource, DatasetItemFromAPI, getFullCatalog, importApiSource } from "../api";

function mapFrontendIdToBackendSource(id: string) {
  if (!id) return "";
  const m: Record<string, string> = {
    "madrid-ckan": "madrid_ckan",
    "datos-gob": "datos_gob_es",
    "datos-gob-es": "datos_gob_es",
    geoportal: "geoportal",
  };
  return m[id] ?? id;
}

export function ImportedApiDatasets() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const sourceParam = params.get("source") ?? "";

  const [datasets, setDatasets] = useState<DatasetItemFromAPI[]>([]);
  const [loading, setLoading] = useState(false);
  const [emptyReason, setEmptyReason] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const mappedSource = mapFrontendIdToBackendSource(sourceParam);
  const importSupported =
    sourceParam === "madrid-ckan" ||
    sourceParam === "datos-gob-es" ||
    sourceParam === "datos-gob";

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setEmptyReason("");
      setStatusMessage("");

      console.debug("[ImportedApiDatasets] Load start", {
        sourceParam,
        mappedSource,
      });

      try {
        if (sourceParam && importSupported) {
          try {
            const importResp = await importApiSource(sourceParam);
            console.debug("[ImportedApiDatasets] Auto-import completed", {
              sourceParam,
              mappedSource,
              importedCount: importResp?.imported_count,
              requestedSource: importResp?.requested_source,
              mappedSourceFromApi: importResp?.mapped_source,
            });
            setStatusMessage(`${importResp?.imported_count ?? 0} datasets imported from ${sourceParam}.`);
          } catch (importErr) {
            console.error("[ImportedApiDatasets] Auto-import failed", {
              sourceParam,
              mappedSource,
              error: importErr,
            });
            setStatusMessage(importErr instanceof Error ? importErr.message : "Import failed.");
          }
        } else if (sourceParam === "geoportal") {
          console.warn("[ImportedApiDatasets] Source is not supported yet", {
            sourceParam,
          });
        }

        const resp = await getFullCatalog(true, mappedSource);
        const items = resp.datasets || [];

        const responseSources: Record<string, number> = {};
        for (const item of items) {
          const key = item.source || "missing";
          responseSources[key] = (responseSources[key] || 0) + 1;
        }

        console.debug("[ImportedApiDatasets] Catalog response", {
          totalItems: items.length,
          sourceParam,
          mappedSource,
          sourceDistribution: responseSources,
        });

        // Backend now filters by source, so we use items directly without additional filtering
        let reason = "";
        if (sourceParam === "geoportal") {
          reason = "Geoportal import is not supported yet.";
        } else if (items.length === 0 && mappedSource) {
          reason = `No datasets found for source ${mappedSource}.`;
        } else if (items.length === 0) {
          reason = "No imported datasets detected.";
        }

        console.debug("[ImportedApiDatasets] Filter summary", {
          sourceParam,
          mappedSource,
          count: items.length,
          reason: reason || "matched",
        });

        setDatasets(items);
        setEmptyReason(reason);
      } catch (err) {
        console.error("[ImportedApiDatasets] Failed to load catalog", {
          sourceParam,
          mappedSource,
          error: err,
        });
        setDatasets([]);
        setEmptyReason("Failed to load datasets from backend.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [sourceParam, mappedSource, importSupported]);

  const handleClear = async () => {
    if (!sourceParam || !importSupported) return;

    setLoading(true);
    setStatusMessage("");
    try {
      const response = await clearImportedSource(sourceParam);
      setDatasets([]);
      setEmptyReason(`Cleared ${response.cleared_count} imported datasets from ${mappedSource}.`);
      setStatusMessage(`${response.cleared_count} imported datasets cleared.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Clear failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl">Imported Datasets</h2>
          <div>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Back
            </Button>
            {importSupported && (
              <Button variant="ghost" onClick={handleClear} className="ml-2">
                Clear
              </Button>
            )}
          </div>
        </div>

        {statusMessage && (
          <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            {statusMessage}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-neutral-600">Loading...</p>
        ) : datasets.length === 0 ? (
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-6">
            <p className="text-sm text-neutral-700">No imported datasets found for this source.</p>
            {emptyReason ? <p className="text-xs text-neutral-500 mt-2">Reason: {emptyReason}</p> : null}
            <p className="text-xs text-neutral-500 mt-2">Try connecting the source first from Import Data Sources.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {datasets.map((ds) => (
              <Card key={ds.dataset_id} className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">{ds.title}</CardTitle>
                      <p className="text-xs text-neutral-600">{ds.provider}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{ds.primary_category || "Uncategorized"}</Badge>
                      <Badge variant="outline">{ds.source || "unknown"}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-neutral-700 truncate">{ds.description}</p>
                  <div className="mt-2 text-xs text-neutral-500">
                    {ds.spatial_coverage || "Unknown coverage"} - {ds.update_frequency || "unknown cadence"}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-block">
                          <Button
                            disabled
                            variant="outline"
                            className="border-neutral-300 bg-neutral-100 text-neutral-400 shadow-none hover:bg-neutral-100 hover:text-neutral-400"
                          >
                            View
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Future feature: open the selected dataset details here.</TooltipContent>
                    </Tooltip>
                    <Button variant="outline" onClick={() => window.open(ds.api_url || "", "_blank")}>Source</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportedApiDatasets;
