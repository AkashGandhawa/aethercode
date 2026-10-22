# AetherCode

A serverless AI code synthesizer built with React, Netlify Functions, and LangChain.js. Describe a coding task in the chat and the Netlify Function routes it to your chosen provider, then streams back the generated response.

## Architecture

```text
+---------------------+       POST        +-------------------------------+
| React UI             | ----------------> | Netlify Function              |
| Vite SPA             |                   | netlify/functions/agent.ts    |
+---------------------+                   +---------------+---------------+
                                      |
                                      | LangChain.js
                                      | multi-provider router
                                      v
                     +-------------------------------------------+
                     | Groq | Google Gemini | OpenAI | Anthropic |
                     +-------------------------------------------+
```

The browser renders the Vite-powered React chat interface. Each prompt is sent to the Netlify Serverless Function, which selects the correct LangChain model based on the requested model ID and returns the generated response.

## Key Features

- **Bring-Your-Own-Key (BYOK)** — API keys are stored exclusively in the browser's `localStorage` and are never persisted on the server. Keys are sent per-request and fall back to server environment variables when absent.
- **Dynamic multi-provider routing** — a model-name router instantiated in the Netlify Function dispatches requests to Groq, Google Gemini, OpenAI, or Anthropic via LangChain.js.
- **Quota-aware fallback logic** — on a rate-limit/quota (429) failure, AetherCode surfaces a fallback action that reroutes the prompt to Groq's `openai/gpt-oss-120b`, so work continues without manual re-entry.
- **Code presentation enhancements** — responses are rendered as Markdown with syntax-tagged code blocks and a per-block "Copy Code" clipboard action.
- **Chat continuity** — session model selection is persisted in `sessionStorage` (a "New Chat" clears messages but keeps the active model), and the entire conversation can be exported to a Markdown file.

## Supported Models

| Provider | Model ID |
| --- | --- |
| Groq | `openai/gpt-oss-120b` |
| Groq | `openai/gpt-oss-20b` |
| Groq | `qwen/qwen3.8-27b` |
| Google | `gemini-3.8-flash` |
| Google | `gemini-3.1-pro-preview` |
| OpenAI | `gpt-4o` |
| OpenAI | `gpt-4o-mini` |
| Anthropic | `claude-3-5-sonnet-20240620` |

## Tech Stack

| Technology | Role |
| --- | --- |
| React | Chat interface |
| TypeScript | Type-safe application and function code |
| Vite | Frontend build tool and SPA development server |
| LangChain.js | Model orchestration and provider adapters |
| Netlify Functions | Serverless backend endpoint and deployment platform |

## Local Setup & Run

1. Clone the repository and enter the project directory:

   ```bash
   git clone https://github.com/<your-username>/<your-repository>.git
   cd <your-repository>
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Optionally create a `.env` file in the project root with server-side fallback keys (you can also provide keys directly in the UI, where they stay in your browser):

   ```env
   GEMINI_API_KEY=your_gemini_api_key
   GROQ_API_KEY=your_groq_api_key
   OPENAI_API_KEY=your_openai_api_key
   ANTHROPIC_API_KEY=your_anthropic_api_key
   ```

4. Start the local Netlify development environment:

   ```bash
   npx netlify dev
   ```

   This runs the Vite frontend and makes the serverless function available at `/.netlify/functions/agent`.

## Deployment

1. Push the project to a public GitHub repository.
2. In Netlify, choose **Add new project** and import the GitHub repository.
3. Use the build settings from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. In the Netlify project dashboard, open **Project configuration > Environment variables** and add any fallback API keys you want to provide server-side.
5. Trigger a deploy. Netlify will build the Vite SPA and deploy the serverless function together.
