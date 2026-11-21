import { Component } from "react";
import { Link } from "react-router-dom";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d0f14] text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md bg-[#13151c] border border-rose-500/20 rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-rose-300">
              Something went wrong
            </h2>
            <p className="text-xs text-slate-400">
              {this.state.error?.message ||
                "An unexpected error occurred in the application."}
            </p>
            <div className="flex gap-3 justify-center mt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs rounded-xl font-medium"
              >
                Reload Page
              </button>
              <Link
                to="/sessions"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs rounded-xl font-medium text-white"
              >
                Go to Sessions
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
