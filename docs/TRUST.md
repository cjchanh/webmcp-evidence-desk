# Trust model

- **Tamper-evident, not tamper-proof.** The manifest is Ed25519-signed at build time; runtime verifies the signature and recomputes every span sha256 client-side. A tampered exhibit is quarantined (`SIG FAILED`) and the verdict is forced to `INSUFFICIENT`. This raises the cost of silent tampering; it does not eliminate it.
- **Sealed records are not authoritative legal signatures.** The build-time signing key never ships; sealed records are signed by an ephemeral local keypair chained to the manifest's public key.
- **Zero network egress at runtime.** No backend, no fetches; the signed manifest is bundled at build time.
- **Unsupported claims abstain.** `evaluate_claim` returns `INSUFFICIENT` naming the missing document type rather than guessing.
- **All agent-visible evidence text is untrusted.** Rendering is text-only (`textContent`, never `innerHTML`), outputs are length-bounded, and `untrustedContentHint` is set where the API supports it.
- **The simulated agent is labeled.** `SIMULATED AGENT` ribbon + `[SIM]` log tags; it is never claimed as WebMCP proof.
- **The final decision stays human.** A tool-produced verdict cannot be sealed until the person explicitly accepts it. Any later board change invalidates that acceptance.
