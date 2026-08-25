# Evidence Desk — AI receipts for claims that matter

A WebMCP challenge entry: a visible evidence caseboard over a **synthetic** vendor
handoff packet. An agent discovers the page's four WebMCP tools, searches exhibits,
inspects exact source spans, evaluates one contested claim, and adds exhibits to a
shared caseboard. The human pins, removes, or rejects evidence and seals a local
session receipt referencing the accepted evidence hashes.

**Hero claim:** “Did the vendor provide the required inspection report before acceptance?”

The corpus contains a deliberate contradiction: a vendor attestation asserting
inspection was completed before acceptance, against an inspection report timestamped
after the acceptance date. The agent must surface both sides; the human adjudicates.

> All data is synthetic. The vendor “Meridian Components Ltd”, the buyer, the project,
> every exhibit, every name, and every date are invented. No real corpus, personal
> data, legal files, or credentials are included.

## Quickstart

```bash
npm install
npm run build:manifest   # signs the exhibit manifest; private key -> gitignored keys/
npm run dev              # local dev server

npm test                 # vitest suite
npm run build            # production build -> dist/
npm run typecheck        # tsc --noEmit
```

Requires Node 22.18+ (native TypeScript type-stripping runs `scripts/build-manifest.mts`).

## Architecture

```
scripts/build-manifest.mts   build-time Ed25519 signing (@noble/curves);
                             private key written ONLY to .gitignored keys/
src/domain/                  pure functions: searchExhibits, inspectExhibit,
                             evaluateClaim, board ops (agent add-only),
                             verifyManifest, sealed receipts. No DOM access.
src/webmcp/                  registration layer; progressive enhancement only;
                             4 tools on document.modelContext when present
src/ui/                      caseboard, claim card, live tool-call log,
                             receipt modal; textContent-only rendering
src/simulated/               SIMULATED AGENT ribbon + [SIM] tags driving the
                             identical domain functions
corpus/exhibits/             13 synthetic exhibits (source of truth)
public/evidence/             signed manifest (build output)
src/generated/manifest.ts    same signed manifest as an importable module so the
                             runtime makes ZERO network calls
tests/                       vitest: unit, contract, tamper, invalid-input,
                             duplicate-registration, abort, unsupported-browser
```

### Tool contract (frozen)

| Tool | Input | Output |
|---|---|---|
| `search_evidence` | `{query}` | ranked `{exhibit_id, title, snippet, score}[]` |
| `inspect_exhibit` | `{exhibit_id}` | `{spans:[{span_id, text, hash}]}` |
| `evaluate_claim` | `{claim}` | `{verdict: SUPPORTED\|CONTRADICTED\|INSUFFICIENT, reasons:[{verdict_basis, span_id, exhibit_id}], missing:[]}` |
| `update_caseboard` | `{action:"add", exhibit_id, stance}` | updated board state |

Agents may only ADD. Pin / remove / reject / seal are human-exclusive controls,
enforced in the domain layer, not just the UI. All outputs are JSON strings bounded
to ≤1500 chars. Tools returning corpus-derived text set
`annotations.untrustedContentHint`.

## Trust boundary — honest claims

- **Tamper-evident, not tamper-proof.** The manifest is Ed25519-signed at build time;
  runtime verifies the signature and recomputes every span sha256 client-side. A
  tampered exhibit is quarantined (`SIG FAILED`) and the verdict is forced to
  `INSUFFICIENT`. This raises the cost of silent tampering; it does not eliminate it.
- **Receipts are not authoritative legal signatures.** The build-time signing key never
  ships, so sealed session receipts are signed by an ephemeral locally-generated keypair
  chained to the manifest’s public key and signature.
- **Zero network egress at runtime.** No backend, no fetches; the signed manifest is
  bundled at build time.
- **Unsupported claims abstain.** `evaluate_claim` returns `INSUFFICIENT` naming the
  missing document type rather than guessing.
- **All agent-visible evidence text is untrusted.** Rendering is text-only
  (`textContent`, never `innerHTML`), outputs are length-bounded, and
  `untrustedContentHint` is set where the API supports it.
- **The simulated agent is labeled.** `SIMULATED AGENT` ribbon + `[SIM]` log tags;
  it is never presented as proof WebMCP executed.

## Deployment notes

`public/_headers` sets `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=self`
(Cloudflare Pages format). Runtime code additionally checks `window.originAgentCluster`
rather than trusting headers alone. WebMCP requires Chrome 149+ (flag:
`chrome://flags/#enable-webmcp-testing`).

## License

Apache-2.0 — see [LICENSE](LICENSE). Signing dependency `@noble/curves` is ISC;
its license notices are preserved in `node_modules` and acknowledged here.

## WebMCP registration (the required pattern, literally)

Tools are registered on `document.modelContext` when present. The exact
registration shape used by this repo:

```js
await document.modelContext.registerTool({
  name: "evaluate_claim",
  description: "Test the contested claim against verified exhibits",
  inputSchema: { type: "object", properties: { claim: { type: "string" } } },
  execute: async (input) => JSON.stringify(evaluateClaim(input.claim, verified))
})
```

All four tools (`search_evidence`, `inspect_exhibit`, `evaluate_claim`,
`update_caseboard`) are registered in `src/webmcp/register.ts` with per-tool
error isolation and bounded JSON-string outputs.
