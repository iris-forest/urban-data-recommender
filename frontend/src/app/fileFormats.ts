const MIME_TYPE_LABELS: Record<string, string> = {
  "application/csv": "CSV",
  "application/geo+json": "GEOJSON",
  "application/json": "JSON",
  "application/pdf": "PDF",
  "application/vnd.geo+json": "GEOJSON",
  "application/vnd.google-earth.kml+xml": "KML",
  "application/vnd.google-earth.kmz": "KMZ",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.oasis.opendocument.spreadsheet": "ODS",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/xml": "XML",
  "application/zip": "ZIP",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "text/csv": "CSV",
  "text/html": "HTML",
  "text/plain": "TXT",
  "text/tab-separated-values": "TSV",
  "text/xml": "XML",
};

const EXTENSION_LABELS: Record<string, string> = {
  EXCEL: "XLSX",
  GEOJSON: "GEOJSON",
  JSONLD: "JSON-LD",
  KML: "KML",
  KMZ: "KMZ",
  OCTETSTREAM: "BIN",
  OCTET_STREAM: "BIN",
  SHAPEFILE: "SHP",
  SPREADSHEET: "XLSX",
  XLSX: "XLSX",
};

export function formatFileTypeLabel(value?: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";

  const mimeType = raw.toLowerCase().split(";")[0].trim();
  const mappedMime = MIME_TYPE_LABELS[mimeType];
  if (mappedMime) return mappedMime;

  if (mimeType.includes("spreadsheetml.sheet")) return "XLSX";
  if (mimeType.includes("wordprocessingml.document")) return "DOCX";
  if (mimeType.includes("presentationml.presentation")) return "PPTX";
  if (mimeType.includes("ms-excel")) return "XLS";
  if (mimeType.includes("geo+json")) return "GEOJSON";
  if (mimeType.includes("csv")) return "CSV";
  if (mimeType.includes("json")) return "JSON";
  if (mimeType.includes("xml")) return "XML";
  if (mimeType.includes("zip")) return "ZIP";

  if (mimeType.includes("/")) {
    const subtype = mimeType.split("/").pop() || "";
    const compactSubtype = subtype
      .replace(/^vnd\./, "")
      .replace(/^x-/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const upperSubtype = compactSubtype.toUpperCase();
    return EXTENSION_LABELS[upperSubtype] || (upperSubtype.length <= 12 ? upperSubtype : "FILE");
  }

  const compact = raw
    .replace(/^\./, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return EXTENSION_LABELS[compact] || compact;
}

export function formatFileTypeLabels(values?: string[]): string[] {
  const labels = (values || []).map(formatFileTypeLabel).filter(Boolean);
  return Array.from(new Set(labels));
}
