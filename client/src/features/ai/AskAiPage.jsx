import { useParams } from "react-router-dom";
import { Sparkles } from "lucide-react";

export default function AskAiPage() {
  const { conversationId } = useParams();

  return (
    <div className="min-h-screen bg-[#0d0f14] text-slate-100 p-8 flex flex-col items-center justify-center text-center">
      <div className="max-w-md bg-[#13151c] border border-white/[0.08] rounded-2xl p-8 flex flex-col items-center gap-4 shadow-xl">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
          <Sparkles size={24} />
        </div>
        <div>
          <h2 className="text-base font-bold text-white">Ask AI Assistant</h2>
          <p className="text-xs text-slate-400 mt-1">
            Conversation interface {conversationId ? `(${conversationId})` : ""} is integrated in Phase 5.
          </p>
        </div>
      </div>
    </div>
  );
}
