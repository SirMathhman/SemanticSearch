# SemanticSearch

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that gives AI agents **semantic search over your code**. It embeds named symbols extracted from TypeScript files with a local sentence-embedding model, and answers natural-language queries with the most relevant declarations — including the **file and line** so an agent can jump straight to the source.

Everything runs locally: the embedding model ([`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2), 384-dim ONNX, ~22 MB) runs on CPU via [`@huggingface/transformers`](https://github.com/huggingface/transformers.js). No API keys, no network calls at query time.

## How it works

- **Corpus** — the configured directories: at startup the server walks each directory, extracts named top-level declarations (functions, classes, interfaces, type aliases, enums, consts) from `.ts` files, and embeds them. Directories are watched, so edits and deletions are re-indexed automatically — the corpus always mirrors what is on disk.
- **Search** — the query is embedded with the same model and ranked by cosine similarity against the corpus.
- **Persistence** — the corpus (vectors included) is saved to a JSON file, so restarts don't re-embed unchanged documents.

## Getting started

### From npm (recommended)

Requires Node.js ≥ 20. The package ships a `semantic-search` bin:

```sh
npx -y @sirmathhman/semantic-search   # stdio MCP server
```

### From source

Requires Node.js and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm build
pnpm start          # stdio MCP server
```

The first run downloads the embedding model into `~/.cache/huggingface/transformers` (Windows: `C:\Users\<you>\.cache\huggingface\transformers`).

On first start the server creates `semantic-search.json` in the working directory with default values. Edit it to point at the directories you want indexed:

```json
{
  "corpusPath": "corpus.json",
  "directories": ["src"]
}
```

The server connects immediately and indexes in the background; early searches return whatever is indexed so far.

### Registering with an MCP client

Example for Claude Desktop / any stdio MCP client:

```json
{
  "mcpServers": {
    "semantic-search": {
      "command": "pnpm",
      "args": ["start"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Set `cwd` to the project you want searched — the config file and corpus live in that directory.

## Tools

| Tool     | Description                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `search` | Semantic search over the corpus. Inputs: `query` (string), `limit` (1–50, default 5). Returns scored results with `file:line` locations. |

## Development

| Task                                  | Command         |
| ------------------------------------- | --------------- |
| Build                                 | `pnpm build`    |
| Test                                  | `pnpm test`     |
| Generate corpus (one-shot, no server) | `pnpm generate` |
| Run server                            | `pnpm start`    |

`corpus.json` is gitignored and regenerable via `pnpm generate`.

## Publishing

Releases are published to npm as `@sirmathhman/semantic-search` by a GitHub Actions workflow (`.github/workflows/publish.yml`) that runs on `v*` tags: install → test → build → `npm publish --provenance`.

One-time setup: create an npm **granular access token** with **read and write** access to the `@sirmathhman/semantic-search` package (legacy/Automation tokens were removed in Nov 2025) and store it in the repo's `NPM_TOKEN` secret. Then:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Alternatively, use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) to publish with no long-lived token: add `permissions: id-token: write` to the workflow and authorize `publish.yml` as a trusted publisher on npmjs.com.

## Architecture

Strictly one-way, outer → inner: `src/index.ts` → `src/server.ts` → `src/search/*`. The domain layer (`src/search/`) is pure — no MCP SDK, no stdio concerns. See [AGENTS.md](./AGENTS.md) for the conventions and invariants that keep it that way.
