# Video Plan — Evidence Desk WebMCP demo (75s)

## Gate

The video is shot against the FIXED build. Fix is the gate; video is downstream.

## Phase 1 — Fix (blocks video)

1. `src/domain/evaluate.ts` — 3 wrong-verdict bugs (S1, reproduced live):
   - F1: acceptance anchor fell back to a max-date scan (register date) when the
     "accepted … date" sentence had no date → CONTRADICTED flipped to SUPPORTED.
     Fix: anchor acceptance ONLY on the acceptance-event sentence; never fall back.
   - F2: report date fell back to a max-date scan (picked an unrelated later date,
     e.g. "released 03-20") when "performed" wasn't keyword-phrased → SUPPORTED
     flipped to CONTRADICTED. Fix: require performed-keyword adjacency; no fallback.
   - F3: only the first inspection report was adjudicated; a contradicting
     revision was dropped → CONTRADICTED flipped to SUPPORTED.
     Fix: evaluate ALL reports; any report dated after acceptance contradicts.
2. Regression tests — one per bug, asserting the correct verdict on the exact probe corpora.
3. README test count → actual; soften "enforced in the domain layer" claim.
4. verify.ts fail-closed on malformed `exhibits` (no throw); calendar-valid dates only.
5. Verify: `npm test`, `npx tsc --noEmit`, `npx vite build`, re-create `dist/vercel.json`
   (build wipes it), deploy, re-run the 3 probes → correct.
6. Push.

## Phase 2 — Record (75s, TTS narration)

Toolchain: `ffmpeg` (/opt/homebrew/bin), `say` (/usr/bin).

1. Narration: `say` (Samantha) per beat → one 75s track.
2. Capture: live domain `https://evidence.centennialdefense.systems` in a
   WebMCP-capable browser, walking the 7 beats.
3. Mux: `ffmpeg` combine capture + narration + end card (both URLs + GitHub).
4. Output: one `.mp4` under 3 min.

Storyboard + narration staged in `docs/SUBMISSION_PACKAGE.md` (7 beats, 0:00–1:15).

## Phase 3 — Post (operator-owned)

- Upload video (YouTube unlisted or Devpost direct file).
- Submit Devpost entry (copy staged in `docs/SUBMISSION_PACKAGE.md`).
