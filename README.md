# Live Agent

An AI assistant built into Ableton Live. Describe what you want in plain English — Live Agent executes it directly on your session.

> _"Delete all audio tracks. In one of the remaining MIDI tracks, add a punchy synth and a 4-bar clip with an Em bassline. Lastly, set the tempo to 150."_ → Done.

[![Live Agent demo](https://img.youtube.com/vi/AFiYc4WvxQU/hqdefault.jpg)](https://youtu.be/AFiYc4WvxQU)

[▶ Watch on YouTube](https://youtu.be/AFiYc4WvxQU)

---

## What it does

Live Agent opens a chat panel inside Live via the [Ableton Extensions SDK](https://ableton.github.io/extensions-sdk/). You describe what you want; the agent calls the right SDK methods to make it happen — creating tracks, setting tempos, adding clips, adjusting devices, and more.

**Full SDK coverage.** Tool schemas are auto-generated directly from the SDK type definitions — all 15 SDK classes, every method and setter, kept in sync automatically when the SDK updates. No hand-written tool definitions.

**Multi-step reasoning.** The agent chains multiple tool calls when needed. "Duplicate the drum rack on track 3 to a new track and set its volume to -6dB" runs as a sequence, not a single command. When a tool fails (stale id, Live constraint), the agent gets the error and keeps going instead of stopping the turn. After track layout changes, tool results include a fresh `liveSnapshot` so ids from the opening prompt are not reused. Long tasks pause every 5 steps with **Continue / Stop** (counted across follow-up messages in the same Live session).

**Web lookup & learning.** `web_search` looks up song tabs and reference, production techniques, mixing tips, and Ableton Live / built-in device guidance — DuckDuckGo links, ASCII tab excerpts, Ableton.com articles when fetchable, and Wikipedia for song overview.

**Three confirmation modes** to match how much you trust the agent:

- **Review** — approve every action before it runs
- **Guard** — auto-approve safe actions, confirm destructive ones
- **Auto** — run everything immediately

**Undo is native.** Every agent action is an ordinary Live edit — ⌘Z reverts them one step at a time.

**Free to use, always.** Works with free-tier models (Gemini Flash has a free API key, no credit card required). No subscription, no account, no charges from this project.

**Supported providers:**

| Provider       | Models                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| OpenAI         | GPT-5.5, GPT-5.5 Pro, GPT-5.4, GPT-5.4 mini, o3, o3 Pro                                                  |
| Anthropic      | Claude Opus 4.8, Claude Sonnet 4.6, Claude Haiku 4.5                                                     |
| Google         | Gemini 3.5 Flash, Gemini 3.1 Pro (preview), Gemini 3.1 Flash-Lite                                        |
| Freebuff API   | `deepseek-v4.1-flash` (streaming) plus eight tool-capable models via the Developer API — key in Settings |
| Ollama (local) | gpt-oss:20b, gemma4:12b, gemma4:26b, llama3.1:8b — no API key; server URL in Settings                    |

API keys are stored locally in Live's extension storage and never leave your machine. Local models run with a 32k context and a 30-minute keep-alive — set `LIVE_AGENT_NUM_CTX` to override the context size. The **Freebuff API** provider talks to `freebuff.com/api/v1/paid` with a Developer API key from [freebuff.com/account/api](https://freebuff.com/account/api) (a session token cannot drive an external client); catalog models that cannot stream are requested as one JSON reply and replayed, so they behave like the streaming ones. The `npm start` model picker is a developer-mode feature; in a packaged `.ablx` install, pick the provider and model in the panel's bottom bar and the choice is remembered.

**The panel can live in your browser.** The Extensions SDK only exposes a _modal_ dialog, so while the panel is open Live's transport and other controls are blocked. The **external-link button** in the bottom bar opens the same UI in your default browser, where you can play the track, tweak devices and browse while the agent works. The host listens on a fixed port (`LIVE_AGENT_PORT`, default `47100`) so a popped-out tab survives restarts.

**Conversations persist, and prompts stay lean.** Closing the panel or restarting Live resumes the most recent saved conversation instead of starting empty. Token use is bounded on three sides: `get_live_state` returns a compact snapshot (`detail: "full"` returns every device parameter and note), oversized tool results are capped before they reach the model, and provider history is trimmed to a character budget by stubbing older tool results. That keeps multi-round turns inside providers' per-minute token limits.

---

## Requirements

**To run:**

- **Ableton Live 12** version **12.4.5 beta** or later (Extensions require Live Suite)
- Either a cloud API key — [Google AI Studio](https://aistudio.google.com) (free tier, no credit card), [OpenAI](https://platform.openai.com), [Anthropic](https://console.anthropic.com) — or a local model via [Ollama](https://ollama.com), which needs no key

**To build from source:**

- Node.js v24.16.0 or higher — [download](https://nodejs.org)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/nonogv/live-agent.git
cd live-agent
npm install
```

The Ableton Extensions SDK is vendored in `vendor/` — `npm install` handles it automatically.

### 2. Build

```bash
npm run build
```

### 3. Load in Live

- Open Live 12.4.5 beta
- Go to **Live → Preferences → Extensions**
- Enable **Developer Mode**
- Point Live to this project folder
- Run `npm start` — picks a local model in the terminal (if Ollama is running), then Live connects and hot-reloads on save

### 4. Add your API key

- Right-click any track → **Live Agent**
- Click the **gear icon** in the bottom bar → paste your API key
- Click the **chat icon** to return and start talking
- Optionally click the **external-link icon** to move the panel into your browser, leaving Live fully usable

### 5. Optional — run a local model with Ollama

No API key needed; the model runs on your machine.

```bash
ollama pull gpt-oss:20b   # 13 GB — the default local model
ollama serve              # skip if the Ollama app is already running
npm start                 # the picker lists the models you have pulled
```

Use a non-default endpoint (another machine, a different port) in the panel's **Settings → Ollama server** field.

The picker only offers the four tags registered in `PROVIDERS.ollama.models` (`src/providers/index.ts`) **and** only those you have actually pulled. To use a different tag, add it to that registry — the panel reads the list from the extension, so there is nothing to change in `ui/`. `LIVE_AGENT_MODEL=gpt-oss:20b npm start` skips the prompt entirely.

---

## Development

```bash
npm start          # watch mode — recompiles on save, Live hot-reloads
LIVE_AGENT_MODEL=gpt-oss:20b npm start  # same, but skip the model prompt
npm run typecheck  # type-check only
npm run generate   # regenerate tool schemas from SDK types
npm test           # run tests
```

### How tool generation works

`scripts/generate-tools.ts` reads the SDK's TypeScript type definitions using `ts-morph` and writes two files:

- `src/agent/generated-tools.ts` — function schemas the AI model sees
- `src/live/generated-executor.ts` — the dispatcher that maps tool calls to SDK method invocations

Run `npm run generate` after updating the SDK to pick up any new API surface automatically.

### Project structure

```
scripts/
├── generate-tools.ts       # SDK type parser → tool schema + executor generator
├── choose-model.ts         # `npm start` prompt — pick a local model, write it for activation
└── dev.ts                  # Watch runner — rebuild + restart the Extension Host on save

src/
├── extension.ts            # Entry point — registers context menu, starts server, opens webview
├── startup-choice.ts       # Applies the one-shot model choice written by `npm start`
├── server.ts               # Local HTTP + WebSocket server, agentic loop, confirmation flow
├── storage.ts              # Persistent key + settings storage
├── history-prune.ts        # Provider history trimming — count limit + character budget
├── open-external.ts        # Opens a URL in the default browser (pop-out button)
├── providers/
│   ├── index.ts            # ProviderAdapter interface, provider/model registry, factory
│   └── http-stream.ts      # Streaming over node:https — OpenAI, Anthropic, Gemini, native Ollama
├── agent/
│   ├── chat.ts             # System prompt builder + LiveState types
│   ├── safety.ts           # DESTRUCTIVE_TOOLS set for confirmation mode
│   ├── tools.ts            # Custom tool schema (get_live_state)
│   ├── tool-result.ts      # Caps oversized tool results before they reach the model
│   └── generated-tools.ts  # Auto-generated — do not edit
└── live/
    ├── executor.ts         # getLiveState + custom tool handler
    ├── compact-state.ts    # Compact session snapshot returned by get_live_state
    ├── handle-registry.ts  # Float64 → BigInt precision recovery
    └── generated-executor.ts  # Auto-generated — do not edit

ui/src/                     # React + Vite webview
├── App.tsx
├── chatReducer.ts
├── types.ts
└── components/             # ChatPanel, ChatInput, MessageBubble, ProviderBar, SettingsPanel, …
```

---

## Roadmap

Full issue tracking is on [GitHub](https://github.com/nonogv/live-agent/issues) (`v1` / `v2` / `v3` labels). High-level milestones:

**v1 — Developer release** _(in progress)_  
Polished, stable experience for developer-musicians who build from source and bring their own API key. Manual QA across all three providers is the remaining gate.

**v2 — Power features**  
Consumer packaged installer · producer rules (persistent agent instructions) · `@track` / `@clip` / `@device` context targeting · RAG over the Ableton Live manual (scraped, BM25-indexed, auto-refreshed by CI) · SDK auto-sync on new Ableton releases.

**v3 — Platform**  
Cloud conversation sync · collaborative sessions for remote co-production.

**Ideas (not yet scheduled)**  
Max for Live patch generation, M4L bridge, cloud plugin parameter database, voice-first / hum-to-MIDI mobile interface.

See [`CHANGELOG.md`](./CHANGELOG.md) for what has already shipped. Fork-specific follow-ups (local-model speed, agent reliability, packaging) are tracked in [`docs/fork-roadmap.md`](./docs/fork-roadmap.md).

---

## License

MIT — see [LICENSE](./LICENSE).
