import { useParams } from "react-router-dom";
import AskAiSelectorPage from "../askAi/AskAiSelectorPage.jsx";
import ConversationPage from "../askAi/ConversationPage.jsx";

export default function AskAiPage() {
  const { conversationId } = useParams();

  if (conversationId) {
    return <ConversationPage />;
  }

  return <AskAiSelectorPage />;
}
