import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { useSelector } from "react-redux";
import Login from "./pages/LoginPage.jsx";
import Home from "./pages/Home.jsx";
import NotFound from "./pages/NotFound.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

// Features & Pages
import SessionsPage from "./features/sessions/SessionsPage.jsx";
import SessionLayout from "./features/sessions/SessionLayout.jsx";
import OverviewPage from "./features/sessions/OverviewPage.jsx";
import UploadPage from "./features/dataset/UploadPage.jsx";
import ValidationPage from "./features/dataset/ValidationPage.jsx";
import AssumptionsPage from "./features/assumptions/AssumptionsPage.jsx";

const ForecastPage = lazy(() => import("./features/forecast/ForecastPage.jsx"));
const OptimizationPage = lazy(() =>
  import("./features/optimization/OptimizationPage.jsx")
);
const SimulationPage = lazy(() =>
  import("./features/simulation/SimulationPage.jsx")
);
const PortfolioPage = lazy(() =>
  import("./features/portfolio/PortfolioPage.jsx")
);
const AskAiPage = lazy(() => import("./features/ai/AskAiPage.jsx"));

import { useGetSessionQuery } from "./lib/api.js";
import { currentStep } from "./features/sessions/steps.js";

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-slate-400">
      <div className="text-sm">Loading...</div>
    </div>
  );
}

function SessionIndexRedirect() {
  const { sessionId } = useParams();
  const { data: session, isLoading, isError } = useGetSessionQuery(sessionId);

  if (isLoading) {
    return <div className="p-8 text-slate-400">Loading session...</div>;
  }
  if (isError || !session) {
    return <Navigate to={`/sessions/${sessionId}/overview`} replace />;
  }
  const targetStep = currentStep(session.status);
  return <Navigate to={`/sessions/${sessionId}/${targetStep}`} replace />;
}

export default function App() {
  const { userData } = useSelector((state) => state.user);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={userData ? <Navigate to="/" replace /> : <Login />}
          />

          <Route
            path="/"
            element={userData ? <Home /> : <Navigate to="/login" replace />}
          />

          <Route
            path="/sessions"
            element={
              userData ? <SessionsPage /> : <Navigate to="/login" replace />
            }
          />

          <Route
            path="/sessions/:sessionId"
            element={
              userData ? <SessionLayout /> : <Navigate to="/login" replace />
            }
          >
            <Route index element={<SessionIndexRedirect />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="validation" element={<ValidationPage />} />
            <Route
              path="forecast"
              element={
                <Suspense fallback={<PageLoader />}>
                  <ForecastPage />
                </Suspense>
              }
            />
            <Route path="assumptions" element={<AssumptionsPage />} />
            <Route
              path="optimization"
              element={
                <Suspense fallback={<PageLoader />}>
                  <OptimizationPage />
                </Suspense>
              }
            />
            <Route
              path="simulation"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SimulationPage />
                </Suspense>
              }
            />
            <Route
              path="portfolio"
              element={
                <Suspense fallback={<PageLoader />}>
                  <PortfolioPage />
                </Suspense>
              }
            />
          </Route>

          <Route
            path="/ask-ai"
            element={
              userData ? (
                <Suspense fallback={<PageLoader />}>
                  <AskAiPage />
                </Suspense>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/ask-ai/:conversationId"
            element={
              userData ? (
                <Suspense fallback={<PageLoader />}>
                  <AskAiPage />
                </Suspense>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Fallback 404 Route for deep links and unhandled URLs */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
