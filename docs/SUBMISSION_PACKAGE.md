# Evidence Desk — submission package

## Submission status

Local build package: **READY FOR FINAL EXTERNAL ASSETS**

External submission: **NOT SUBMITTED**

Deadline: **September 3, 2026 at 1:00 p.m. PT / 2:00 p.m. MDT**.

The official challenge requires a working live URL, a text description, a public
demo video under three minutes with audio, and a public code repository containing
the functional source, assets, instructions, visible open-source license, and a
literal `document.modelContext.registerTool(...)` pattern.

Sources: [OpenAI challenge page](https://openai.com/webmcp-challenge/) and
[official Devpost requirements](https://webmcp.devpost.com/).

| Required asset | Local state | External action still owned by CJ |
|---|---|---|
| Project description | READY below | Paste into Devpost |
| Working live app | Production build is locally runnable | Deploy and paste public URL |
| Public code repository | Source, instructions, and Apache-2.0 license are present | Push/publish repo and ensure license is visible in repository About |
| Demo video | Shot list and narration are READY below | Record audio/video, upload publicly, paste URL |
| Devpost entry | Field-ready copy is staged | Log in, review official rules, submit |

No deploy, push, login, video upload, or Devpost submission was performed while
preparing this package.

## Copy-ready project description

### One-line pitch

Evidence Desk lets an agent investigate a contested record while the human keeps
the verdict—and seals a tamper-evident receipt of what both sides actually did.

### Description

Evidence-heavy decisions usually force a bad choice: make the person read every
document, or let an agent act through a UI and trust an opaque summary. Evidence
Desk creates a third path.

The page exposes four real WebMCP tools over a signed synthetic procurement packet:
`search_evidence`, `inspect_exhibit`, `evaluate_claim`, and `update_caseboard`.
The agent can search thirteen exhibits, inspect exact hash-linked spans, evaluate
one contested claim, and propose evidence to a shared caseboard. Its live tool
lifecycle appears in the interface, including refusals and aborts. The strongest
conflict is instantly legible: the lot was accepted March 14, while its signed
inspection report says inspection occurred March 19.

WebMCP is the product primitive, not a wrapper around button clicks. It gives the
agent bounded semantic operations and structured outputs while preserving the
human boundary. The agent cannot pin, reject, remove, accept a verdict, or seal.
Only the person can adjudicate the proposal and create the local Ed25519-signed
receipt. The receipt binds the human-accepted verdict, accepted evidence hashes,
the signed build manifest, and the tool-call trail.

The app is client-only, uses synthetic data, makes zero runtime network calls, and
fails closed on forged evidence. A clearly labeled guided replay is available when
WebMCP is unavailable, but it is never presented as real WebMCP execution.

**Agent proposes. Human decides. Evidence preserves what happened.**

### Why this is a strong WebMCP fit

- Evidence review needs semantic search, source inspection, evaluation, and proposal—not coordinate guessing.
- Structured tool results keep citations and board mutations deterministic and bounded.
- The shared page becomes better for both parties: the agent handles packet-scale inspection while the human sees, challenges, and accepts the result.
- Human-exclusive controls demonstrate deliberate authority separation rather than automating the person out of the decision.

### Implementation summary

The app registers four tools with awaited `document.modelContext.registerTool(...)`
calls. Each registration and execution is isolated. Inputs are validated at runtime;
outputs are bounded JSON strings; corpus text is marked untrusted. An Ed25519-signed
manifest and per-span SHA-256 checks quarantine altered evidence before evaluation.
Real tool executions emit visible lifecycle events without allowing UI callback
failures to change the tool result.

## Demo video — 75-second script

### Recording setup

- Use ChatGPT's in-app browser at desktop width.
- Start on a fresh page load with `WEBMCP: ACTIVE (4 TOOLS)` visible.
- Keep the first viewport onscreen for the opening.
- Record system audio or narration. Target 60–90 seconds; official maximum is under three minutes.

### Shot list and narration

**0:00–0:08 — category and promise**

> “This is Evidence Desk: a WebMCP evidence review where the agent investigates,
> the human keeps the verdict, and the receipt preserves what happened.”

Show the two-column first viewport, four-tool status, trust contract, and live rail.

**0:08–0:18 — start the real agent path**

Select **INVESTIGATE WITH MY AGENT** (copies the briefing), paste it into the agent, and send it.

> “The page gives the agent four bounded tools instead of making it guess through
> buttons: search, inspect, evaluate, and propose to the caseboard.”

**0:18–0:38 — visible WebMCP payoff**

Keep the app visible as the real calls appear. Hold briefly on the date conflict and
`VERDICT: CONTRADICTED`.

> “Every real call leaves a visible lifecycle record. The decisive conflict is March
> 14 acceptance versus March 19 inspection, with reasons tied to exact signed spans.”

**0:38–0:55 — human authority**

Show EX-001 and EX-002 on the caseboard. Pin one, reject or retain the other, then
select **APPROVE AGENT VERDICT**.

> “The agent can only propose. It cannot pin, reject, accept the verdict, or seal.
> Those controls remain human-only.”

**0:55–1:05 — receipt payoff**

Select **SEAL RECEIPT** and show the readable summary before the collapsed raw JSON.

> “The local receipt shows what the agent proposed, what I accepted or rejected,
> my final verdict, and verified evidence integrity. It is tamper-evident—not a
> legal signature.”

**1:05–1:15 — adversarial close**

Open the Forgery Bench, change `2026-03-19` to `2026-03-09`, and submit.

> “Change one signed byte and the exhibit is quarantined. The desk fails closed.”

End on:

> “Agent proposes. Human decides. Evidence preserves what happened.”

## Judge checklist

### WebMCP leverage

- Confirm the browser discovers exactly four tools.
- Run each tool through ChatGPT's in-app browser—not the replay.
- Confirm every real execution shows a visible `started` and terminal lifecycle event.
- Confirm structured outputs, bounded length, abort behavior, and per-tool registration isolation.

### Execution

- Confirm the production build loads with no console errors.
- Complete the real search → inspect → evaluate → propose → human accept → seal flow.
- Verify the downloaded receipt in-app.
- Confirm the full thirteen-exhibit packet begins collapsed.

### Potential impact

- Keep the demonstrated audience specific: people making evidence-heavy procurement,
  compliance, audit, or dispute decisions who need agent speed without surrendering authority.
- Do not claim legal validity, authoritative identity, trusted time, or tamper prevention.

### Creativity and ambition

- Lead with the human-agent authority boundary, not cryptography.
- Show the live lifecycle and Forgery Bench only after the primary workflow is clear.
- Explain the receipt as a trace of joint work, not a generic export.

## Claim boundaries

Safe claims:

- The four tools register and execute in a WebMCP-capable browser.
- Real calls become visible in the page and real evaluation changes the verdict.
- Agent board mutations are add-only; human-only controls are separately enforced.
- The shipped synthetic manifest is signed and each span is hash-checked client-side.
- The receipt is locally signed with an ephemeral key and can detect later changes.
- Runtime application logic performs no network egress.

Do not claim:

- The receipt proves identity, origin, trusted time, legal validity, or non-repudiation.
- The page prevents all tampering or compromise.
- The guided replay proves WebMCP execution.
- The external live URL, public repository, video, or Devpost entry exists until CJ creates and verifies it.

## Final external checklist

- [ ] Deploy the production build to a public HTTPS URL.
- [ ] Re-run all four WebMCP tools against that exact deployed URL in ChatGPT's in-app browser.
- [ ] Publish the repository and verify `LICENSE` is detected and visible in the repository About section.
- [ ] Record and upload the public demo video with audio; keep it under three minutes.
- [ ] Paste the description and URLs into Devpost.
- [ ] Review the official rules and eligibility details.
- [ ] Submit before **September 3, 2026 at 1:00 p.m. PT / 2:00 p.m. MDT**.
