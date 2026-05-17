import { useEffect } from "react";
import { createBrowserRouter, Outlet, useLocation } from "react-router";
import { InputScreen } from "./components/InputScreen";
import { StructuredOverview } from "./components/StructuredOverview";
import { DatasetResults } from "./components/DatasetResults";
import { DatasetFitReview } from "./components/DatasetFitReview";
import { FinalOverview } from "./components/FinalOverview";
import { ImportedApiDatasets } from "./components/ImportedApiDatasets";

function ScrollToTopLayout() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    Component: ScrollToTopLayout,
    children: [
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
    ],
  },
]);
