# Fork roadmap

Follow-ups specific to this fork: local-model speed, agent reliability, packaging
and maintenance. Ranked by value for day-to-day use — reliability and trust
first, then speed, then hygiene — weighted by effort and by how much each item
unblocks later work.

This is a planning document, not a commitment list. Effort is rough: **S** ≈
hours, **M** ≈ a day or two, **L** ≈ a week.

Measurements referenced below were taken on a 14 GB-class GPU/CPU split with
`gpt-oss:20b` at `num_ctx 32768`.

---

## Tier 1 — start here

### 1. Make the prompt prefix cacheable — M

`server.ts` rebuilds `buildSystemPrompt(await getLiveState(song), …)` on every
round and sends all ~48 tool schemas after it, so the volatile live state sits at
the front of the prompt and invalidates the prefix each call.

**Why:** prefill is the dominant local cost — a first tool call measured **13.3 s**
at 32k context. Layout `[static policy + tool schemas][volatile live state]
[history]` (state as a trailing block) lets llama.cpp's prompt cache and the
cloud providers' prefix caching hit.

**First step:** diff the prompt across two consecutive rounds and confirm only
the state block moves; then reorder and re-measure time-to-first-token.

### 2. Cut the tool schema payload — S–M

~48 generated tools occupy most of a ~12k-token prompt, and small local models
degrade on long tool lists — with a truncated context, `gpt-oss:20b` emitted
`["","song_set_tempo",70]` as prose instead of calling the tool.

**Why:** faster prefill and better tool selection. Send a core set (transport,
tempo, tracks, clips, scenes, `get_live_state`) and expose the rest via a
`find_tools` lookup or per-category expansion.

**First step:** measure serialised JSON size per tool category to find where the
bytes are.

### 3. Agent-loop test harness — M

173 tests exist, but none cover `server.ts`'s loop: tool selection, failure
recovery, confirm modes, round caps.

**Why:** every prompt change above is unverifiable today, and this fork keeps
diverging from upstream. A fake `Song` stub plus recorded model transcripts makes
"given this history, the loop calls X and stops" testable without network.

**First step:** extract the loop's provider call behind an injectable interface.

### 4. Turn-level undo — M–L (spike first)

A 20-tool task currently means 20 ⌘Z presses.

**Why:** for a tool that mutates someone's session, one-keystroke revert is the
difference between trust and fear. Either group edits into one Live undo
transaction or record inverse operations per turn and expose "revert last turn".

**Spike:** check whether the SDK exposes undo transactions before committing —
without it this becomes a large correctness project.

### 5. Encrypt stored API keys — S–M

Keys are stored in plaintext in the extension storage directory; there is no
`safeStorage`, keytar or cipher use in the codebase.

**Why:** anyone with filesystem access reads a paid key. Prefer the OS keychain
if the host exposes it; otherwise encrypt with a machine-bound key and document
the residual risk.

**First step:** check what the extension host's runtime offers for secret
storage.

---

## Tier 2 — high value, more design

### 6. Token-aware context management — M

`history-prune.ts` drops the oldest tool pairs once history passes **40
messages** — a count, not a budget. A user who sets `LIVE_AGENT_NUM_CTX=8192`
silently overflows.

**Why:** prune against a token budget derived from the model's context, keep all
user messages, and replace dropped pairs with a compact digest. Makes long
sessions resumable rather than lossy.

### 7. Post-condition verification — M

The system prompt asks the model to verify before claiming success; that is a
request, not a guarantee, and a false "Done." is the worst failure mode here.

**Why:** after a mutating turn, re-read the affected state (tempo, track count,
clip notes) and show a verified/changed badge; allow one self-correction pass
before answering.

**First step:** define the ~8 invariants worth checking from the tool set.

### 8. Graceful degradation across providers — M

A local model that times out or emits malformed JSON currently fails the turn.

**Why:** fall back to the next configured provider (or a smaller local tag) with
the same history, surface which model answered, and cap `num_ctx` by available
VRAM instead of a fixed 32768 — heavy for `gemma4:26b` on a 14 GB split.

### 9. CI that covers what ships — S

`.github/workflows/ci.yml` runs on ubuntu only: typecheck, format check, lint,
test. It has no build step, no Windows or macOS job, and no packaging test.

**Why:** the POSIX `kill(-pid)` path in `scripts/dev.ts` is untested, and `.ablx`
packaging already produced a blank panel once without `-i dist/ui`.

**First step:** add `npm run build`, a Windows job, an `.ablx` smoke test, and a
generate-drift check (`npm run generate && git diff --exit-code`).

---

## Tier 3 — cheap wins and new angles

### 10. Selection-aware actions — S–M (spike first)

"Make this punchier" acting on the selected track, clip or device, instead of
requiring ids in prose. Needs a selection API — check the SDK surface first.

**Why:** id passing is where most model mistakes originate.

### 11. Live-aware preflight validation — S

Validate tempo range, send counts, quantised parameter values and clip-vs-loop
lengths before calling the SDK, and return field-level errors.

**Why:** turns opaque SDK throws into messages the model can act on.

### 12. Turn telemetry panel — S–M

Per turn: model, prompt vs completion tokens, prefill vs decode time, tool count,
wall time.

**Why:** makes GPU split and `num_ctx` tuning measurable instead of anecdotal,
and pairs naturally with item 1.

### 13. Local-only privacy switch — S

One toggle that disables `web_search` and any egress while on a local provider.

**Why:** cheap, and a genuine differentiator for a local-first fork: a session
that provably never leaves the machine.

### 14. Fork maintenance kit — S

An upstream-sync ritual (`fetch origin && rebase`, resolving `generated-*`
files), a changelog gate in CI, and tagged `.ablx` releases.

**Why:** the fork is already several commits ahead; divergence costs compound
quietly.

### 15. Mid-turn kill switch in the panel — S–M

Today the agent can only be stopped at a checkpoint (every 5 rounds, via **Stop**)
or by refusing a confirmation. There is no way to abort a turn that is
mid-stream or looping through tool calls.

**Why:** playing with a local model means watching it go wrong — an immediate
abort is the difference between experimenting and babysitting. Pairs with item 4:
cancelling mid-tool cannot undo an edit already applied, so revert and cancel
belong together.

**Constraints:** the streams in `providers/http-stream.ts` take no abort signal,
so cancellation needs plumbing from the panel's `{ type: 'cancel' }` message
through an `AbortController` into the request and into the loop's between-round
and between-tool checks. A button inside the panel cannot restart or stop the
host itself — that stays the dev runner's job.

**First step:** add the abort signal to `streamLines` and a loop check, then the
button last.

---

## Not on this list

Work already shipped this cycle (local Ollama provider, startup model picker,
watch runner, provider registry sent from the host, stale-host scoping,
`num_ctx`/keep-alive handling) and features already present upstream
(checkpoints, `liveSnapshot` refresh, tool error recovery, sessions/history, web
search) are intentionally excluded.

Items 4 and 10 are **spikes, not commitments** — both depend on SDK capabilities
that have not been verified.

See [`CHANGELOG.md`](../CHANGELOG.md) for what has shipped.
