# Evidence Desk

A page where an agent searches signed exhibits and a person keeps the verdict. [WebMCP Challenge](https://openai.com/webmcp-challenge/) entry from [Centennial Defense Systems](https://centennialsystems.com).

```bash
npm install
npm run build:manifest
npm run dev
```

Open the app, run **INVESTIGATE WITH MY AGENT**, then **APPROVE** and **SEAL**. The agent cannot seal a verdict.

**Refuses:** no runtime network; does not seal without an explicit human accept; does not treat a forged exhibit as evidence.

**Live demo:** https://evidence.centennialdefense.systems · https://webmcp-evidence-desk.vercel.app

Background: [docs/WHY.md](docs/WHY.md). Trust model: [docs/TRUST.md](docs/TRUST.md).

---

## What it does

A synthetic vendor handoff packet — 13 exhibits, Ed25519-signed at build time — contains a deliberate contradiction: a vendor attestation claims the required inspection happened *before* acceptance, while the signed inspection report is dated *after* it.

**The contested claim:** *"Did the vendor provide the required inspection report before acceptance?"*

An agent with WebMCP tools investigates the packet through the page itself:

1. **Searches** the 13 exhibits (`search_evidence`)
2. **Inspects** exact source spans, each carrying its manifest hash (`inspect_exhibit`)
3. **Evaluates** the claim deterministically, returning `CONTRADICTED` with span-tied reasons for both sides (`evaluate_claim`)
4. **Proposes** evidence to a shared caseboard (`update_caseboard`)

Every real tool call lands in a live provenance rail as it runs — including refusals and aborts. Then the agent stops. Pin, reject, correct, decline, approve, and seal are **human-exclusive controls**: the tool contract is add-only (enforced in the tool schema and domain logic), and no tool-produced verdict can be sealed until a person explicitly accepts it.

The result is a sealed, locally-signed record of what the agent proposed, what the person decided, and which evidence both sides touched — with the human-readable summary ahead of the raw signed JSON.

## The four tools (frozen contract)

| Tool | Input | Output |
|---|---|---|
| `search_evidence` | `{query}` | ranked `{exhibit_id, title, snippet, score}[]` |
| `inspect_exhibit` | `{exhibit_id}` | `{spans:[{span_id, text, hash}]}` |
| `evaluate_claim` | `{claim}` | `{verdict: SUPPORTED\|CONTRADICTED\|INSUFFICIENT, reasons:[{verdict_basis, span_id, exhibit_id}], missing:[]}` |
| `update_caseboard` | `{action:"add", exhibit_id, stance}` | updated board state |

Agents may only **add**. All outputs are JSON strings bounded to ≤1500 chars; corpus-derived text sets `annotations.untrustedContentHint`. Each execution emits a bounded lifecycle event (`started`, then `completed`, `refused`, `failed`, or `aborted`).

## WebMCP registration (the required pattern, literally)

```js
await document.modelContext.registerTool({
  name: "evaluate_claim",
  description: "Test the contested claim against verified exhibits",
  inputSchema: { type: "object", properties: { claim: { type: "string" } } },
  execute: async (input) => JSON.stringify(evaluateClaim(input.claim, verified))
})
```

All four tools are registered in `src/webmcp/register.ts` with per-tool error isolation, abort-signal threading, and bounded outputs. Registration is progressive enhancement: when `document.modelContext` is absent, the page degrades gracefully to a labeled simulated review — never presented as WebMCP proof.

## Adversarial proof: the Forgery Bench

After the primary flow, open the Forgery Bench, edit one signed span, and submit the forgery. The manifest comparison catches the changed bytes, quarantines the exhibit, forces the verdict to `INSUFFICIENT`, and refuses the seal — fail closed, visibly, in one click.

## Quickstart

```bash
npm install
npm run build:manifest   # signs the exhibit manifest; private key -> gitignored keys/
npm run dev              # local dev server

npm test                 # vitest suite (189 tests)
npm run build            # production build -> dist/
npm run typecheck        # tsc --noEmit
```

Requires Node 20+ (`engines.node`, tests, and `tsc`). `npm run build:manifest` runs `node scripts/build-manifest.mts` and needs Node 22.18+ for native TypeScript execution.

## Architecture

```
scripts/build-manifest.mts   build-time Ed25519 signing (@noble/curves);
                             private key written ONLY to .gitignored keys/
src/domain/                  pure functions: searchExhibits, inspectExhibit,
                             evaluateClaim, board ops (agent add-only),
                              verifyManifest, sealed records. No DOM access.
src/webmcp/                  registration layer; progressive enhancement only;
                             4 tools on document.modelContext when present
src/ui/                      judge-first caseboard, live tool-call lifecycle,
                             human decision boundary, readable record summary
src/simulated/               SIMULATED AGENT ribbon + [SIM] tags driving the
                             identical domain functions
corpus/exhibits/             13 synthetic exhibits (source of truth)
public/evidence/             signed manifest (build output)
src/generated/manifest.ts    same signed manifest as an importable module so the
                             runtime makes ZERO network calls
tests/                       vitest: unit, live-page WebMCP execution, UI contract,
                             tamper, invalid-input, abort, unsupported-browser
```

## Deployment notes

`public/_headers` carries the static-host header contract, and the tracked root `vercel.json` makes the Vercel build and all seven security headers reproducible from the public repository. Deploy from the repository root so Vercel runs `npm run build` and serves `dist/`. Runtime code additionally checks `window.originAgentCluster` rather than trusting headers alone. WebMCP requires Chrome 149+ (flag: `chrome://flags/#enable-webmcp-testing`).

## The 20-second judge path

1. Open the app in ChatGPT's in-app browser and confirm `WEBMCP: ACTIVE (4 TOOLS)`.
2. Select **INVESTIGATE WITH MY AGENT** and give the copied briefing to the agent.
3. Watch all four real tool calls enter the first-viewport provenance rail.
4. See the Mar 14 acceptance versus Mar 19 inspection conflict resolve to `VERDICT: CONTRADICTED`; EX-001 and EX-002 land on the decision board.
5. Pin or reject the evidence, then select **APPROVE AGENT VERDICT**.
6. Select **SEAL RECEIPT**. Read the human decision summary first; expand the raw signed JSON only if desired.

**Fallback demo:** **WATCH 20-SECOND GUIDED REPLAY** runs the same domain logic with an unmistakable `SIMULATED AGENT` ribbon and `[SIM]` provenance tags.

Submission materials and the short demo script are staged in [docs/SUBMISSION_PACKAGE.md](docs/SUBMISSION_PACKAGE.md).

## Synthetic data disclosure

All data is synthetic. The vendor "Meridian Components Ltd", the buyer, the project, every exhibit, every name, and every date are invented. No real corpus, personal data, legal files, or credentials are included.

## License

Apache-2.0 — see [LICENSE](LICENSE). Signing dependency `@noble/curves` is MIT; its license notices are preserved in `node_modules` and acknowledged here.

---

*Built by [Centennial Defense Systems](https://centennialsystems.com) — deterministic, audit-first systems.*
