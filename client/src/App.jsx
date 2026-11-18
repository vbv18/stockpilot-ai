import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import Login from "./pages/LoginPage.jsx";
import Home from "./pages/Home.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  const { userData } = useSelector((state) => state.user);

  return (
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

        {/* Fallback 404 Route for deep links and unhandled URLs */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
