import { createBrowserRouter } from "react-router";
import { InputScreen } from "./components/InputScreen";
import { StructuredOverview } from "./components/StructuredOverview";
import { DatasetResults } from "./components/DatasetResults";
import { DatasetFitReview } from "./components/DatasetFitReview";
import { FinalOverview } from "./components/FinalOverview";
import { ImportedApiDatasets } from "./components/ImportedApiDatasets";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: InputScreen,
  },
  {
    path: "/overview",
    Component: StructuredOverview,
  },
  {
    path: "/results",
    Component: DatasetResults,
  },
  {
    path: "/dataset-fit",
    Component: DatasetFitReview,
  },
  {
    path: "/imported",
    Component: ImportedApiDatasets,
  },
  {
    path: "/summary",
    Component: FinalOverview,
  },
]);
