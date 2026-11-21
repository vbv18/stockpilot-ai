import { useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Brain,
  ChevronLeft,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import {
  useGetConversationQuery,
  useGetOptimizationQuery,
  useListMessagesQuery,
  useSendMessageMutation,
} from "../../lib/api.js";
import { AssistantMessageCard } from "./AssistantMessageCard.jsx";
import { COPY } from "../../lib/copy.js";

const ERROR_MAPPINGS = {
  SERVICE_UNAVAILABLE: "AI analysis is not configured on this server.",
  UPSTREAM_LLM_ERROR: "The AI provider is unavailable. Try again shortly.",
  AI_RESPONSE_INVALID:
    "The AI could not produce a valid answer. Try rephrasing.",
  RATE_LIMITED: "Too many questions. Wait a moment.",
  AI_SESSION_NOT_ELIGIBLE: "This session is not ready for AI analysis.",
  CONFLICT: "Still working on the previous question.",
};

export function ConversationPage() {
  const { conversationId } = useParams();
  const [content, setContent] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showNotice, setShowNotice] = useState(() => {
    return localStorage.getItem("sp:llmNoticeDismissed") !== "true";
  });

  const messagesEndRef = useRef(null);

  const {
    data: conv,
    isLoading: isLoadingConv,
    error: convError,
  } = useGetConversationQuery(conversationId);

  const { data: messages = [] } = useListMessagesQuery({ id: conversationId });

  // Optional optimization query to sniff first SKU for starter prompts
  const { data: optData } = useGetOptimizationQuery(conv?.sessionId, {
    skip: !conv?.sessionId,
  });

  const [sendMessage, { isLoading: isSending, error: sendError }] =
    useSendMessageMutation();

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  // Elapsed timer when sending
  useEffect(() => {
    let interval;
    if (isSending) {
      const start = Date.now();
      interval = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSending]);

  const handleDismissNotice = () => {
    setShowNotice(false);
    localStorage.setItem("sp:llmNoticeDismissed", "true");
  };

  const handleSend = async (textToSend) => {
    const text = (textToSend || content).trim();
    if (!text || isSending) return;

    setContent("");
    try {
      await sendMessage({ id: conversationId, content: text }).unwrap();
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoadingConv) {
    return (
      <div className="min-h-screen bg-[#0d0f14] text-white flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-500" size={32} />
      </div>
    );
  }

  if (convError || !conv) {
    return (
      <div className="min-h-screen bg-[#0d0f14] text-white p-8 flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-rose-400 font-medium">Conversation not found</p>
        <Link
          to="/ask-ai"
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs rounded-xl font-medium"
        >
          Back to Sessions
        </Link>
      </div>
    );
  }

  // Sniff first SKU id for custom starter prompt
  const firstSku = optData?.skus ? Object.keys(optData.skus)[0] : "SKU-001";

  const STARTER_PROMPTS = [
    {
      title: "Risk Prioritization",
      text: "Which SKUs have the highest stockout risk?",
    },
    {
      title: "ROP Explanation",
      text: `Why is the recommended reorder point for ${firstSku} what it is?`,
    },
    {
      title: "Cost Sensitivity",
      text: "What happens if holding cost increases from 5 to 8 per unit per day?",
    },
    {
      title: "Anomaly Diagnosis",
      text: `Why has ${firstSku} become risky recently?`,
    },
    {
      title: "Budget Optimization",
      text: "Which SKUs should I prioritize with a limited budget?",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0d0f14] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/[0.08] bg-[#13151c]/90 backdrop-blur sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/ask-ai"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-white">{conv.title}</h1>
              <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                Answers are limited to this session
              </span>
            </div>
            <Link
              to={`/sessions/${conv.sessionId}/overview`}
              className="text-xs text-slate-400 hover:text-indigo-400 inline-flex items-center gap-1 transition-colors mt-0.5"
            >
              <span>Session: {conv.sessionName}</span>
              <ExternalLink size={10} />
            </Link>
          </div>
        </div>
      </header>

      {/* LLM Notice banner */}
      {showNotice && (
        <div className="bg-indigo-950/40 border-b border-indigo-500/20 px-6 py-2.5 flex items-center justify-between text-xs text-indigo-200">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-indigo-400 shrink-0" />
            <span>{COPY.llmNotice}</span>
          </div>
          <button
            onClick={handleDismissNotice}
            className="text-indigo-400 hover:text-white transition-colors ml-4"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Message Stream */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-6 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="my-auto py-12 flex flex-col items-center text-center gap-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 flex items-center justify-center text-indigo-400">
              <Brain size={24} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Ask StockPilot AI
              </h2>
              <p className="text-xs text-slate-400 max-w-md mt-1">
                Explore forecasting models, policy differences, holdout
                accuracy, and what-if scenarios grounded in your session data.
              </p>
            </div>

            {/* Five Starter Prompts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl w-full text-left">
              {STARTER_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(p.text)}
                  className="p-3.5 rounded-xl bg-[#13151c] hover:bg-slate-800/80 border border-white/[0.08] text-xs flex flex-col gap-1 transition-all group"
                >
                  <span className="text-indigo-400 font-medium text-[11px] group-hover:text-indigo-300">
                    {p.title}
                  </span>
                  <span className="text-slate-300 leading-snug">{p.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              {m.role === "user" ? (
                <div className="max-w-xl bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-xs leading-relaxed shadow-lg">
                  {m.content}
                </div>
              ) : (
                <div className="w-full">
                  <AssistantMessageCard
                    message={m}
                    sessionId={conv.sessionId}
                    onSuggestionClick={(sug) => handleSend(sug)}
                  />
                </div>
              )}
            </div>
          ))
        )}

        {/* Sending Placeholder */}
        {isSending && (
          <div className="flex flex-col items-start w-full">
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 shadow-lg flex items-center gap-3 text-xs text-slate-400">
              <Loader2 size={16} className="animate-spin text-indigo-400" />
              <span>Analyzing session data... ({elapsedSeconds}s)</span>
            </div>
          </div>
        )}

        {/* Error message bubble if send failed */}
        {sendError && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
            <div>
              <div className="font-medium">
                {ERROR_MAPPINGS[sendError.data?.error?.code] ||
                  sendError.data?.error?.message ||
                  "Failed to send question"}
              </div>
              {sendError.data?.error?.requestId && (
                <div className="text-[10px] text-rose-400/80 font-mono mt-0.5">
                  Reference: {sendError.data.error.requestId}
                </div>
              )}
            </div>
            <button
              onClick={() => handleSend()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 font-medium text-xs text-white"
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Composer */}
      <footer className="border-t border-white/[0.08] bg-[#13151c] p-4 sticky bottom-0 z-30">
        <div className="max-w-4xl mx-auto flex flex-col gap-2">
          <div className="relative flex items-center">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 2000))}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              placeholder="Ask a question about this session's forecast, inventory policies, or what-if scenarios..."
              rows={2}
              className="w-full bg-[#0d0f14] border border-white/[0.1] rounded-2xl px-4 py-3 pr-24 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 resize-none disabled:opacity-50"
            />
            <div className="absolute right-3 flex items-center gap-2">
              <span className="text-[10px] text-slate-500">
                {content.length}/2000
              </span>
              <button
                onClick={() => handleSend()}
                disabled={!content.trim() || isSending}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
          <div className="flex justify-between items-center text-[10px] text-slate-500 px-1">
            <span>Press Enter to send, Shift+Enter for new line</span>
            <span>
              Numbers are grounded strictly in session analysis results
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default ConversationPage;
