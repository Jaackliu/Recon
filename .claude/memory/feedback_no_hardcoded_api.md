---
name: no-hardcoded-api-name
description: Never hardcode AI API model names in docs or code — always reference .env configuration
metadata:
  type: feedback
  origin: synced from old finance project
---

All documentation and code must not hardcode the AI API model name. Instead, reference `.env` variables (`AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`).

**Why:** The API provider/model may change; hardcoding creates maintenance burden and stale docs.

**How to apply:** When writing docs or code that references the AI API, use generic terms like "AI API" or "model (see `.env`)" instead of specific model names. Code should always read from `os.environ`.
