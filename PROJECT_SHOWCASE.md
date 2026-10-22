# AetherCode — Project Showcase

A serverless AI code synthesizer that turns natural-language prompts into production-oriented, markdown-formatted code. AetherCode combines a React single-page application with Netlify Functions and LangChain.js to route a single chat surface across four LLM providers while giving users full control of their own API keys.

---

## 1. System Architecture & Design Decisions

### 1.1 High-Level Overview

AetherCode is a two-tier, serverless application with a deliberately thin backend and a stateful, privacy-first frontend:

```text
+---------------------------+        POST /.netlify/functions/agent        +-------------------------------+
|  React SPA (Vite)         |  -----------------------------------------> |  Netlify Function             |
|  src/ChatInterface.tsx    |      { model, message, history, userKeys }  |  netlify/functions/agent.ts   |
+---------------------------+                                             +---------------+---------------+
        ^                                                                                 |
        |  streaming-style markdown UI                              LangChain.js provider adapters
        |                                                                                 |
        |                        +----------------------+----------------------+----------+---------+
        |                        |                      |                      |                    |
   browser-only                Groq               Google Gemini           OpenAI              Anthropic
    storage layer         openai/gpt-oss-120b  gemini-3.8-flash   gpt-4o         claude-3-5-sonnet
```

The SPA owns all user interaction and persistence; the function is stateless and acts purely as an authenticated, provider-agnostic orchestration proxy. There is no database, no session server, and no server-side chat history.

### 1.2 Frontend Stack, State Management & Rendering

- **Stack:** React 19 + TypeScript, bundled by Vite 8, with `react-markdown` + `remark-gfm` for response rendering.
- **State management:** Intentionally local. `ChatInterface.tsx` is the single stateful component and uses React hooks rather than an external store:
  - `useState` for `messages`, `input`, `isLoading`, `selectedModel`, `remainingQuota`, the four API keys, and panel visibility.
  - `useRef` for the in-flight `AbortController` (request cancellation) and the scroll anchor.
  - `useEffect` hooks for hydration from storage, persistence back to storage, quota reload on model change, and auto-scroll.
- **Persistence layers:**
  - `localStorage` — chat history (`aether_chat_history`), API keys, and per-model/per-day quota counters.
  - `sessionStorage` — the active model selection (`aether_selected_model`).
- **Code-block rendering:** `renderMarkdown()` supplies a custom `code` component to ReactMarkdown. Inline snippets render as pill-styled `<code>`; fenced blocks are delegated to a dedicated `CodeBlock` component that renders a language header, a syntax-tagged `<pre><code>` region, and a per-block **Copy Code** control backed by `navigator.clipboard`.
- **UX considerations:** sticky header with model picker and actions, a fixed composer, a typing/loading indicator, error bubbles, and a scroll-to-latest effect keyed on `[messages, isLoading]`.

### 1.3 Serverless Backend Orchestration (Netlify Functions + LangChain)

The backend (`netlify/functions/agent.ts`) is a single HTTP handler:

1. **Method + payload guard:** rejects non-`POST` requests (405) and missing messages (400).
2. **Model resolution:** reads `{ model, message, history, userKeys }` from the JSON body.
3. **Provider router:** instantiates the correct LangChain chat model based on the model string (see §2.1).
4. **Prompt construction:** prepends a senior-architect `SystemMessage` that enforces fenced code blocks with language tags and concise prose.
5. **Conversation replay:** maps prior turns to `HumanMessage`/`AIMessage`, filtering out error turns and empty content.
6. **Invocation + metadata:** calls `primary.invoke(...)`, extracts the actual model name and token usage, and returns `{ reply, model, tokens }`.
7. **Error classification:** maps upstream failures to semantic HTTP statuses — `401` (missing/invalid key), `429` (rate limit/quota), or `500` (generic model error) — with user-facing messages.

Netlify wiring is declarative in `netlify.toml`: build with `npm run build`, publish `dist`, serve functions from `netlify/functions`, and SPA-redirect all routes to `index.html`.

### 1.4 Security & Privacy — BYOK Architecture

AetherCode is designed so that the operator never touches user secrets:

- **Keys live only in the browser.** The four provider keys are held in React state and stored in `localStorage`; they are read on mount and written when the user clicks **Save**.
- **Keys are transmitted per request.** Each call sends `userKeys: { gemini, groq, openai, anthropic }` in the POST body. The function prefers these over server environment variables, so a deployment with zero configured secrets still works for BYOK users.
- **Zero server persistence.** The function processes keys in memory for the duration of a single request. Nothing is written to disk, logs, or a database. Chat history likewise never leaves the client except as part of the orchestration call.
- **Explicit disclosure.** The settings panel states that keys "are stored locally in your browser and are never saved to our servers," recommending restricted-billing keys.
- **Least-privilege fallback.** Server-side `GEMINI_API_KEY`/`GROQ_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are optional shared fallbacks — an operator-only convenience that never overrides a user-supplied key.

**Trade-off acknowledged:** `localStorage` is readable by any script on the origin, so BYOK favors user-owned credentials with strict billing limits over server-held secrets. This keeps the platform free of key-custody liability.

---

## 2. Core Engineering Features & Problem Solving

### 2.1 Dynamic Multi-Provider Model Routing

A single `/agent` endpoint fans out to four providers. The router is order-sensitive and precise to avoid misrouting similarly named models:

| Model string condition | Provider adapter | Key source |
| --- | --- | --- |
| includes `claude` | `ChatAnthropic` | `userKeys.anthropic` |
| includes `gemini` | `ChatGoogleGenerativeAI` | `userKeys.gemini` |
| **starts with** `gpt-` | `ChatOpenAI` | `userKeys.openai` |
| otherwise | `ChatGroq` | `userKeys.groq` |

The `startsWith('gpt-')` rule is a deliberate fix: Groq's `openai/gpt-oss-*` and `qwen/*` IDs contain "gpt"/open-weight names but must **not** be sent to OpenAI. Any non-matching ID (including `openai/gpt-oss-120b`) falls through to Groq, guaranteeing correct billing and provider affinity.

### 2.2 Rate-Limit & Quota-Exhaustion Resilience (HTTP 429)

AetherCode treats quota as a first-class concern on both the client and server:

- **Client-side quota ledger:** each model has a daily allowance (`MODEL_QUOTAS`); Groq models get a high allowance (14,400) while premium per-call providers default to 20. Counters are keyed per model per day in `localStorage` and decremented on success. The user can inspect and manually adjust the counter from the header.
- **Pre-flight guard:** submission is blocked when the active model's quota reads zero, prompting the user to switch models or wait for the midnight reset.
- **Automatic fallback:** on a `429`/rate-limit response, the app zeroes that model's quota and, when Gemini is the failing primary, **automatically reroutes to Groq `openai/gpt-oss-120b`**, updating the active model and surfacing a one-click **Resend with GPT OSS 120B** action.
- **Graceful terminal state:** when the Groq fallback is also exhausted, a clear "all providers are currently rate-limited; quotas reset at midnight" notice is shown.
- **Server-side mirroring:** the function independently classifies `429` and auth errors so the client receives actionable status codes rather than opaque 500s.

### 2.3 Session Continuity — Sticky Model vs. New-Chain Lifecycle

Model choice is treated as session state, not per-prompt state:

- The active model is stored in `sessionStorage` and validated against the supported-model list on load, so refreshes/turns don't silently reset the user to a default.
- The model changes **only** when the user selects a different option or when the `429` fallback path deliberately reroutes to Groq.
- **New Chat** clears the conversation messages (and the `localStorage` history) while intentionally preserving the selected model — restarting a conversation shouldn't cost the user their provider setup.

Complementing this is a **duplicate-prompt cache**: repeating an identical prompt re-displays the prior answer tagged "already answered," with no quota or token spend.

### 2.4 Zero-Data-Loss Markdown Session Export

`exportChat()` gives users ownership of their transcripts:

- Serializes the conversation to clean Markdown with a metadata header (export timestamp + model used) and `### User` / `### Assistant` sections per turn.
- Creates a `Blob` (`text/markdown;charset=utf-8`), generates an object URL, and triggers a download via a temporary `<a download="aethercode-session-<timestamp>.md">`.
- Revokes the object URL afterward to avoid memory leaks, and disables the action when there are no messages.

---

## 3. Portfolio Project Entry

AetherCode is a serverless AI code synthesizer that turns natural-language prompts into clean, code-fenced answers. Built with React 19, Netlify Functions, and LangChain.js, it exposes one chat surface that dynamically routes requests across four providers — Groq, Google Gemini, OpenAI, and Anthropic — behind a bring-your-own-key model. The frontend is a fully client-owned application: API keys, chat history, and quota counters live in browser storage, while the serverless function stays stateless and persists nothing, so users retain complete control and custody of their credentials and data.

The project's engineering focus is resilience and control. A precise name-based router (`startsWith('gpt-')` vs. contains `claude`/`gemini`) prevents Groq's open-weight `openai/gpt-oss-*` models from being misrouted to OpenAI. A client-side quota ledger plus a server-aware 429 handler automatically falls back to Groq's `openai/gpt-oss-120b`, keeps model selection sticky across a session in `sessionStorage`, and re-serves duplicate prompts from cache without spending tokens. Responses render as syntax-tagged Markdown with per-block clipboard actions, and the full session can be exported to a Markdown file.

**Technologies & capabilities**

- React 19, TypeScript, Vite 8, `react-markdown` + `remark-gfm`
- Netlify Functions (serverless HTTP handler) with SPA redirects
- LangChain.js adapters: `@langchain/groq`, `@langchain/google-genai`, `@langchain/openai`, `@langchain/anthropic`
- Multi-provider dynamic routing from a single endpoint
- BYOK security model with `localStorage`-only key custody and zero server persistence
- Rate-limit/quota resilience with automatic Groq fallback
- Sticky session model selection, cached duplicate-prompt answers, and Markdown session export
- Custom code-block UI with syntax tags and per-block copy-to-clipboard

---

## 4. LinkedIn Launch Post

> **🚀 Launching AetherCode — a serverless AI code synthesizer that puts you in control**
>
> Hit a rate limit and your AI pair-programmer stops? Locks you into one vendor? Keeps your API key on someone else's server? I built AetherCode to fix all three.
>
> AetherCode is a React + Netlify Functions + LangChain.js coding assistant that routes one chat across **Groq, Google Gemini, OpenAI, and Anthropic** — with a bring-your-own-key model where your keys live **only in your browser** and are never persisted server-side.
>
> **Highlights:**
> - 🔀 Dynamic multi-provider routing from a single serverless endpoint
> - 🛟 Quota-aware resilience — on HTTP 429 it falls back to Groq's `openai/gpt-oss-120b` so you keep working
> - 🔐 BYOK architecture: keys, history, and quotas stay client-side with zero server persistence
> - 📌 Sticky session model selection plus cached duplicate-prompt answers (no wasted tokens)
> - 📋 Syntax-tagged code blocks with per-block "Copy Code" and one-click Markdown session export
>
> 🔗 Live demo: `<your-netlify-demo-url>`
> 💻 Source: `<your-github-repo-url>`
>
> #AIAgents #DevTools #LangChain #Netlify #React #TypeScript #LLM #OpenSource #BuildInPublic
