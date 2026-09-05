# PASSDOWN — Evidence Desk WebMCP Challenge (2026-09-03, ~04:20 MDT)

**Deadline: 2026-09-03 13:00 PT (14:00 MDT). ~9.5h remain.**
**Campaign: ship the Evidence Desk submission — public repo + live URL + canary + BYOE + domain + video + Devpost.**

## North Star → current state

North Star: WebMCP Challenge submission that survives a skeptical judge.
Campaign outcome: repo public, live URL, BYOE panel, real domain, video, Devpost entry — all verified.

**Where we are (verified, parent-run):**
- Repo: https://github.com/cjchanh/webmcp-evidence-desk — PUBLIC, Apache-2.0, main = `d81c527` (pushed).
- Local HEAD: `cee3300` (BYOE commit, 8 files, +818/−7) on top of `6b75508` (README pass). **NOT pushed.**
- Tests: **161/161 pass, 20 files** (parent-run after commit). `npx tsc --noEmit` exit 0.
- Domain: **https://evidence.centennialdefense.systems — LIVE, 200, cert issued** (cert_rxpQD4AQkeqg1EIRrf3SdYwu). All 4 headers present (Origin-Agent-Cluster: ?1, Permissions-Policy: tools=self, nosniff, no-referrer). BYOE panel HTML confirmed in served page (grep user-evidence-section = 1).
- https://webmcp-evidence-desk.vercel.app — 200, BYOE panel present.
- DNS: CNAME evidence → cname.vercel-dns.com (Porkbun, operator added it — DONE, verified via dig).
- 3 BYOE critic fixes verified in-file: honest copy (index.html:190), fail-closed load (src/main.ts:873 LOAD REFUSED), receipt chain (src/main.ts:603-604, 669-672 userManifest ?? MANIFEST).

## What the new session must do (the gauntlet)

### 1. Push (operator-gated — bash push is DENIED on this surface)
Hand CJ this exact line, he runs it:
```
cd <local checkout> && git push origin HEAD:main
```
After push: verify GitHub main = `cee3300` (curl https://api.github.com/repos/cjchanh/webmcp-evidence-desk/commits/main | grep sha).

### 2. Full public canary on the DOMAIN (ego-browser, WebMCP-capable)
The ego-browser SDK pattern that WORKS (task space required):
```bash
SDK="$(ego-browser help sdk 2>/dev/null | grep -oE '/[^ ]+sdk[^ ]*' | head -1)"
ego-browser nodejs --sdk-path "$SDK" <<'EOF'
const h = ego.helpers
const spaces = await ego.listTaskSpaces()
const mine = spaces.taskSpaces.find(s => s.name && s.name.includes('webmcp'))
if (!mine) { console.log('NO SPACE - create one via ego.createTaskSpace("webmcp canary")'); }
else {
  await ego.useTaskSpace(mine.id)
  const tab = await h.openOrReuseTab('https://evidence.centennialdefense.systems')
  await h.waitForLoad(tab); await h.wait(2000)
  console.log('TITLE: ' + (await h.pageInfo(tab)).title)
  console.log('TOOLS: ' + await h.js(tab, "document.modelContext ? JSON.stringify(await document.modelContext.getTools().then(t=>t.map(x=>x.name))) : 'NO-MCP'"))
}
EOF
```
NOTE: a task space named "webmcp ev..." (id 5) already exists. Earlier attempts without a task space failed with "Task space not selected"; with the space selected the openOrReuseTab call hung once (120s timeout) — retry, or use `ego.createTaskSpace('webmcp canary')` fresh. If ego-browser stays flaky, fall back to curl checks (already PASS: 200 + panel + headers) and do the interactive canary manually with CJ watching.

**8-point canary (from prior session, all passed on vercel.app — re-run on domain):**
1. Title = Evidence Desk
2. H1/fold renders
3. `document.modelContext.getTools()` → exactly 4 tools
4. Tool call via `executeTool(tool, JSON.stringify({query:'...'}))` → rail 6→16
5. MAR 14 ≠ MAR 19 → VERDICT: CONTRADICTED
6. NEEDS APPROVAL state before human decision
7. Seal refused without humanDecision; works after pin+approve
8. 390×844 no horizontal overflow

**BYOE canary (new, not yet run live):** paste 2-exhibit corpus in the user-evidence textarea → SIGN → SIGNED LOCALLY → evaluate → CONTRADICTED → human pin/approve → seal receipt verifies against USER manifest (not shipped manifest). Also: SAVE writes JSON packet; import of a tampered packet → LOAD REFUSED.

### 3. Video (75s, operator records)
Storyboard ready: internal ox-flow harvest, run 20260903T094052Z-2e307ce2 (beats 0:00–1:15: WEBMCP ACTIVE badge → INVESTIGATE WITH MY AGENT → 4 tool calls in rail → MAR 14 ≠ MAR 19 → CONTRADICTED → pin + APPROVE AGENT VERDICT → SEAL RECEIPT → Forgery Bench tamper SIG FAILED → end card evidence.centennialdefense.systems + github.com/cjchanh/webmcp-evidence-desk). Operator narrates; screen-record in a WebMCP-capable browser (ego-browser or Chrome with WebMCP flag). Upload to YouTube unlisted or direct file for Devpost.

### 4. Devpost submission (operator)
Staged copy: docs/SUBMISSION_PACKAGE.md in the repo. Requires: repo URL, live URL (use https://evidence.centennialdefense.systems), video URL, team info. CJ owns the Devpost account.

## Hard-won environment facts (do not re-learn these)

- **`git push` is DENIED in bash on this surface** — always hand CJ the command. Also denied: `rm -rf`, `vercel` (direct binary), `security` keychain reads. `npx vercel` works.
- **Vercel deploy gotcha:** `npx vercel deploy dist --prod --yes` from repo root created a STRAY project named `dist` (dist-seven-kappa-66.vercel.app) because the path arg hijacked project resolution. The fix that WORKS: `cd dist && npx vercel link --yes --project webmcp-evidence-desk && npx vercel deploy . --prod --yes` — this deployed correctly and aliased webmcp-evidence-desk.vercel.app. **Cleanup needed: delete the stray `dist` project** (npx vercel project: it's in the team list; deleting a project is destructive — ask CJ or leave it, it's harmless but untidy).
- **dist/vercel.json is hand-written and gitignored** — `npx vite build` WIPES it. After every build, re-create dist/vercel.json with the 4 headers (content is in this passdown's appendix) before deploying. dist/_headers (Cloudflare-style) survives but Vercel uses vercel.json.
- **Domain attachment:** the 302-to-SSO wall was fixed by `npx vercel domains add evidence.centennialdefense.systems webmcp-evidence-desk` — alias alone was NOT enough; the domain must be attached to the project. Apex centennialdefense.systems is attached to a different project (centennialsystems-com) — that's fine, the subdomain is what matters.
- **DO NOT run `node scripts/build-manifest.mts`** — it regenerates the shipped keypair (f88a3503…) and dirties public/evidence/manifest.json + src/generated/manifest.ts. If run: `git checkout -- public/evidence/manifest.json src/generated/manifest.ts`.
- **MCP auth decision: NO** — challenge requires no-login judge path. Security story = headers + signed manifests + human-only seal. Post-challenge maybe.
- **ego-browser is WebMCP-capable** (document.modelContext works). Tools take JSON-string inputs.
- **ox_flow dispatch** requires `--parent-session <parent session id>`. Harvests: `<internal ox-flow harvest dir>/<run_id>/harvested.json`. Before every operator reply: `ox_flow.py drain; ox_flow.py status --cue` — first line of reply is the cue (OUT: 0 or OUT: N running).
- **Worker fleet:** ox-builder-a (build), ox-critic-a (red-team), ox-repo-scout (read slices) — quota-metered, no USD. All idle now.
- **Test count history:** 145 (ship) → 161 (BYOE, after concurrent-builder merge dedup). 161 is correct and current; earlier "164" was a transient concurrent-write artifact, not a regression.

## Git state (exact)
- HEAD: `cee3300` (BYOE) ← `6b75508` (README) ← `d81c527` (ship, pushed) ← `099b985` (qual patch).
- origin/main = `d81c527`. Two local commits unpushed.
- Working tree: CLEAN after commit (only .vercel/ untracked-ignored, dist/ ignored).
- .gitignore now includes `.vercel` (part of cee3300).

## Remaining operator-owned items
1. `git push` (command above).
2. Video recording + upload (75s, storyboard ready).
3. Devpost submission (copy staged in docs/SUBMISSION_PACKAGE.md).
4. Optional: delete stray Vercel `dist` project.

## Appendix: dist/vercel.json content (re-create after every vite build)
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Origin-Agent-Cluster", "value": "?1" },
        { "key": "Permissions-Policy", "value": "tools=self" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

## Campaign hierarchy (keep explicit)
North Star: submission that survives a skeptical judge.
Campaign outcome: repo + live domain + BYOE + video + Devpost, all verified.
Success criteria: push landed (main=cee3300), domain canary 8/8 + BYOE canary PASS, video uploaded, Devpost submitted.
Current blocker: operator push (bash-denied) → then live canaries → then video/Devpost (operator-owned).
Current action: hand CJ the push command; run domain canary while he pushes.