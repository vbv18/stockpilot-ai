# Data Handling & Privacy Policy

## Session Data Deletion

- **User-Initiated & Permanent:** Session deletion via `DELETE /api/v1/sessions/:sessionId` is permanent and irrecoverable. There is no automated expiry or soft-deletion recycle bin once deleted.
- **Cascading Removal:** Deleting a session permanently purges:
  1. Semantic vector points in Qdrant (filtered by `user_id` and `session_id`).
  2. Stored uploaded raw and processed CSV datasets on disk (`storage/datasets/<userId>/<sessionId>`).
  3. All database records across MongoDB: `ai_messages`, `ai_conversations`, `what_if_runs`, `jobs`, `simulation_runs`, `optimization_runs`, `assumption_sets`, `forecast_runs`, `datasets`, and `analysis_sessions`.
- **Third-Party Backups & Provider Logs:** Server backups, disaster recovery snapshots, and external AI provider request logs (e.g., Google, OpenAI, Anthropic, Groq) are subject to their respective data retention policies and outside the app's direct control.

## Data Isolation & Security

- Every data access and database query is scoped strictly to the authenticated `userId`.
- No raw customer demand CSV rows are ever forwarded to LLMs; only aggregated statistical summaries and numerical calculation tool outputs are provided in model contexts.
