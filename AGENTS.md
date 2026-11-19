# AGENTS.md — StockPilot AI (read fully before EVERY task)

## Operating rules
1. Read `docs/REPO_MAP.md` before starting (except P00). Placeholders `<CLIENT_DIR>`, `<SERVER_DIR>`, `<STATS_DIR>` resolve there.
2. Do exactly the task in the prompt. No extra features, refactors, renames, or dependencies beyond those listed.
3. **NO TESTS.** Never create test files, test configs, mocks, fixtures, or add test dependencies (vitest, jest, pytest, supertest, etc.). Verification = typecheck/build + the manual commands listed in the prompt.
4. Do not modify existing authentication code unless the prompt says so.
5. TypeScript `strict`. No `any`, no `@ts-ignore`, no `@ts-expect-error`, no non-null assertion `!`. Use `unknown` + Zod narrowing.
6. Every external input is validated at the boundary: HTTP params/query/body (Zod), Python responses (Zod), LLM output (Zod), env (Zod), Python requests (Pydantic).
7. Never trust a user id from the client. Derive it from the verified Firebase token. Every Mongo query on user data filters by `userId` (and `sessionId` when applicable). Ownership miss → HTTP 404 `NOT_FOUND` (never 403, never reveal existence).
8. Secrets only via environment variables. Never log tokens, API keys, Authorization headers, or raw CSV rows.
9. If a library API is uncertain, read the installed package's type definitions (`node_modules/<pkg>/**/*.d.ts`) or introspect Python (`python -c "import x, inspect; ..."`). Never guess signatures.
10. Code blocks in prompts marked **VERBATIM** must be copied exactly (formatting may be adjusted by the formatter only). Marked **SPEC** means implement to the described contract.
11. If a prompt conflicts with repo reality: keep the prompt's contract (names, shapes, status codes, behaviors), adapt only file locations, and record the deviation in the FINAL REPORT. If a contract cannot be met, STOP and report. Do not improvise.
12. Pin dependencies: commit lockfiles; Python `requirements.txt` uses `==` pins from `pip freeze` of only the packages you installed (plus their direct pins).
13. Never print or commit `.env`. Only update `.env.example`.
14. Every prompt ends with a **FINAL REPORT** containing: Files created · Files modified · Commands run with their outputs (typecheck/build) · Manual verification results · Deviations/open issues.

## Conventions
- API base path: `/api/v1`. Success envelope: `{ "data": <payload>, "meta"?: <object> }`. Error envelope: `{ "error": { "code": <ErrorCode>, "message": <string>, "details"?: <unknown>, "requestId": <string> } }`.
- Node-owned JSON fields: camelCase. Python-originated payloads (forecast/evaluate/optimize/simulate results) are stored and returned **unchanged in snake_case**. Never convert case.
- Dates: `YYYY-MM-DD` (UTC calendar dates, no timezone). Timestamps: ISO-8601 UTC with `Z`.
- Currency: ₹ shown in UI; numbers stored raw. Costs: ordering cost per order; holding cost per unit per day (or per year if chosen); shortage penalty per lost unit.
- Ids in API: 24-char hex Mongo ObjectId strings.
- Python JSON: snake_case. Python service listens on port 8000.
- Library language: server TypeScript, client TypeScript (match existing module system per `docs/REPO_MAP.md`).
- Do not add emojis to code, logs, or UI copy.