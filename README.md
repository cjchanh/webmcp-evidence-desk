# Evidence Desk — agent investigation, human judgment, durable proof

A judge-first [WebMCP Challenge](https://openai.com/webmcp-challenge/) entry: a
visible evidence caseboard over a **synthetic** vendor handoff packet. An agent
discovers four page tools, searches the packet, inspects exact source spans,
evaluates a contested claim, and proposes evidence. Every real tool call appears
in the page as it runs. The human keeps the final authority: pin or reject the
proposal, accept the verdict, and seal a local receipt.

> **Agent proposes. Human decides. Evidence preserves what happened.**

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
src/ui/                      judge-first caseboard, live tool-call lifecycle,
                             human decision boundary, readable receipt summary
src/simulated/               SIMULATED AGENT ribbon + [SIM] tags driving the
                             identical domain functions
corpus/exhibits/             13 synthetic exhibits (source of truth)
public/evidence/             signed manifest (build output)
src/generated/manifest.ts    same signed manifest as an importable module so the
                             runtime makes ZERO network calls
tests/                       vitest: unit, live-page WebMCP execution, UI contract,
                             tamper, invalid-input, abort, unsupported-browser
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

Each real execution emits a bounded, input-safe lifecycle event (`started`, then
`completed`, `refused`, `failed`, or `aborted`). `evaluate_claim` also applies its
result to the visible verdict. UI callback failures are isolated from tool results.

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
- **The final decision stays human.** A tool-produced verdict cannot be sealed until
  the person explicitly accepts it. Any later board change invalidates that acceptance.

## Deployment notes

`public/_headers` sets `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=self`
(Cloudflare Pages format). Runtime code additionally checks `window.originAgentCluster`
rather than trusting headers alone. WebMCP requires Chrome 149+ (flag:
`chrome://flags/#enable-webmcp-testing`).

## License

Apache-2.0 — see [LICENSE](LICENSE). Signing dependency `@noble/curves` is MIT;
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

> The snippet above is the illustrative core. Real definitions also carry a
> `title`, `annotations` (including `untrustedContentHint`), abort-signal
> threading, and bounded JSON-string outputs — see `src/webmcp/register.ts`.

## 20-second judge path

1. Open the app in ChatGPT's in-app browser and confirm `WEBMCP: ACTIVE (4 TOOLS)`.
2. Select **COPY AGENT BRIEFING** and give the copied prompt to the agent.
3. Watch all four real tool calls enter the first-viewport provenance rail.
4. See the Mar 14 acceptance versus Mar 19 inspection conflict resolve to
   `VERDICT: CONTRADICTED`; EX-001 and EX-002 land on the decision board.
5. Pin or reject the evidence, then select **ACCEPT AGENT VERDICT**.
6. Select **SEAL RECEIPT**. Read the human decision summary first; expand the raw
   signed JSON only if desired.

**Fallback demo:** **WATCH 20-SECOND GUIDED REPLAY** runs the same domain logic with
an unmistakable `SIMULATED AGENT` ribbon and `[SIM]` provenance tags. It is not
claimed as WebMCP proof.

**Adversarial proof:** after the primary flow, open the Forgery Bench, change one
signed span, and submit it. The altered bytes are quarantined and the seal fails closed.

The official challenge says submissions are judged on WebMCP leverage, execution,
potential impact, and creativity/ambition. Submission materials and the short demo
script are staged in [docs/SUBMISSION_PACKAGE.md](docs/SUBMISSION_PACKAGE.md).

No network calls. Synthetic data only.
