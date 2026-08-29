# SemanticSearch — Agent Instructions

An MCP (Model Context Protocol) server exposing semantic search over a corpus of documents. TypeScript (ES2022, NodeNext, ESM), pnpm, Node. The corpus is populated two ways: ad-hoc documents (`add_document`) and configured directories indexed + watched at startup (named symbols extracted from `.ts` files). Deeper architecture, definitions, and known design issues live in repo memory at `/memories/repo/architecture.md` — read it before making structural changes.

## Commands

| Task            | Command                                           |
| --------------- | ------------------------------------------------- |
| Build           | `pnpm build` (runs `tsc`)                         |
| Test            | `pnpm test`                                       |
| Generate corpus | `pnpm generate` (writes gitignored `corpus.json`) |
| Run server      | `pnpm start` (stdio MCP server)                   |

Tests run via `node --import tsx --test src/**/*.test.ts`. **tsx is required** — Node's native type-stripping does not rewrite `.js` import specifiers to `.ts`, so plain `node --test` fails to resolve the relative imports.

## Architecture

Pipeline is strictly one-way, outer → inner: `index.ts` → `server.ts` → `search/*`. **The domain layer (`src/search/*`) must never import the MCP SDK** — it is pure domain (no `@modelcontextprotocol/sdk`, no stdio concerns). `server.ts` is the only module that wires the watcher to the store and the only place that turns a failed config/corpus load into a process exit.

- `search/query.ts` — the `Store` (embed → upsert → search → reindex). `createStore` composes small named operation factories.
- `search/corpus.ts` — `indexDirectories`: the "index all configured directories" domain operation (no watchers, no MCP). Used by both `createServer` and `scripts/generate-corpus.ts`.
- `search/index.ts` — pure in-memory vector index (no I/O, no embedder).
- `search/persistence.ts` — the only module that touches the filesystem for corpus I/O (atomic writes).

## Conventions (non-obvious — follow them)

- **Stdio discipline:** stdout is reserved for the MCP protocol. **All logging goes to stderr** (`console.error`). A stray `console.log` corrupts the protocol.
- **Result-style errors, never throw.** Fallible functions return `{ ok: true, value } | { ok: false, error }` unions. Errors are structured (what/where/why/fix), not bare strings.
- **Store mutations are serialized.** `createStore` keeps a `chain: Promise` tail; every mutating op (`addDocument`, `upsertDocument`, `upsertDocuments`, `reindexDirectory`) is enqueued via `enqueue` so mutations run one at a time in issue order. This is what makes the background initial index and file watchers safe to run concurrently. `search` stays unqueued (read-only). Don't add a mutation that bypasses `enqueue`.
- **Background startup:** `createServer` starts watchers immediately and runs the initial index in the background (`void ... .catch`) so the transport connects without waiting for a cold-start embed. Early searches return whatever is indexed so far.
- **Size limits:** ≤ 50 lines per function, ≤ 300 lines per file, ≤ 10 files per directory.

## Pitfalls

- **128-token embedding limit:** the local model truncates input at 128 tokens, so large declarations are silently truncated and rank poorly.
- **`corpus.json` is gitignored** and regenerable via `pnpm generate` — don't commit it.
- **Model cache:** the ONNX model is cached under `~/.cache/huggingface/transformers`; the first `generate`/`start` downloads it.
- **Full-snapshot persistence:** each save rewrites the whole corpus even when few docs changed. Fine at current scale; revisit only if the corpus grows large.
