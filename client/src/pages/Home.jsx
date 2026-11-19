import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useCreateSessionMutation } from "../lib/api.js";

const HOW_IT_WORKS = [
  { step: 1, title: "Upload", desc: "Upload daily demand CSV with automatic delimiter and date sniffing." },
  { step: 2, title: "Validate", desc: "Scan records, exclude negative returns, and zero-fill missing days." },
  { step: 3, title: "Forecast", desc: "Fit AutoETS and Seasonal Naive models with residual bootstrap intervals." },
  { step: 4, title: "Assumptions", desc: "Configure cost structures, lead times, and target cycle service levels." },
  { step: 5, title: "Optimize", desc: "Compare EOQ and normal vs uncertainty-aware reorder points." },
  { step: 6, title: "Simulate", desc: "Monte Carlo daily-review simulations over common random demand." },
];

export default function Home() {
  const navigate = useNavigate();
  const [createSession, { isLoading }] = useCreateSessionMutation();

  const handleGetStarted = async () => {
    try {
      const res = await createSession({}).unwrap();
      navigate(`/sessions/${res.id}/upload`);
    } catch (err) {
      console.error("Failed to create session", err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0f14] text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-white/[0.08] bg-[#13151c]/60 backdrop-blur-md px-8 py-5 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <span className="w-3 h-3 rounded-full bg-indigo-500 shadow-lg shadow-indigo-500/50" />
          <span className="text-base font-bold text-white tracking-tight">StockPilot AI</span>
        </div>

        <nav className="flex items-center gap-4">
          <Link
            to="/sessions"
            className="text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            View prior sessions
          </Link>
          <button
            type="button"
            disabled={isLoading}
            onClick={handleGetStarted}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 transition-all cursor-pointer disabled:opacity-60"
          >
            <span>Get Started</span>
            <ArrowRight size={13} />
          </button>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="flex-1 max-w-5xl w-full mx-auto px-6 py-20 flex flex-col items-center justify-center text-center gap-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
          <Sparkles size={13} />
          <span>Intelligent Inventory Optimization & Decision Support</span>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight max-w-3xl leading-tight">
          Uncertainty-Aware Safety Stocks & Inventory Simulation
        </h1>

        <p className="text-sm md:text-base text-slate-400 max-w-2xl leading-relaxed">
          Move beyond standard normal approximations. Forecast daily sales with AutoETS, bootstrap empirical prediction intervals, and simulate $(s, S)$ inventory control to protect your fill rates.
        </p>

        <div className="flex items-center gap-4 mt-4">
          <button
            type="button"
            disabled={isLoading}
            onClick={handleGetStarted}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-2xl text-white shadow-xl shadow-indigo-700/30 transition-all cursor-pointer disabled:opacity-60"
          >
            <span>Get Started</span>
            <ArrowRight size={16} />
          </button>

          <Link
            to="/sessions"
            className="px-5 py-3 bg-[#13151c] hover:bg-slate-800 border border-white/[0.08] text-sm font-semibold rounded-2xl text-slate-200 transition-colors"
          >
            View prior sessions
          </Link>
        </div>

        {/* How it works strip */}
        <div className="w-full mt-16 pt-12 border-t border-white/[0.06] flex flex-col gap-8 text-left">
          <div className="text-center">
            <h2 className="text-lg font-bold text-slate-200">How StockPilot AI Works</h2>
            <p className="text-xs text-slate-500 mt-1">A rigorous 6-step numerical pipeline from raw transaction rows to policy comparisons</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {HOW_IT_WORKS.map((item) => (
              <div
                key={item.step}
                className="bg-[#13151c] border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-2 hover:border-white/[0.12] transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center text-xs font-bold font-mono">
                  {item.step}
                </div>
                <h3 className="text-sm font-semibold text-slate-200">{item.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
