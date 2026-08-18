# 005 — Research: LUFS loudness per ITU-R BS.1770

**Type:** `wayfinder:research`
**Status:** closed
**Assignee:** research agent (baselines session, 2026-08-18)
**Blocked by:** none
**Blocks:** [010 — Build LUFS normalization with tests](./010-build-lufs-normalization.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

What exactly must be implemented to measure LUFS, and what numbers prove it
correct?

Today `normalize()` in `src/lib/audio-processors.ts:135` divides by the loudest
single sample. That is peak normalization. It is not loudness. Two tracks can
share a peak and sound very different.

Find out:

1. **The specification.** ITU-R BS.1770, current revision, and EBU R128. Get the
   exact algorithm, not a blog summary.
2. **K-weighting filter.** The two-stage filter: a high-shelf, then a high-pass.
   Get the exact biquad coefficients. State how they are derived for sample
   rates other than 48 kHz, since audio here may be 44.1 kHz.
3. **Gating.** The absolute gate at -70 LUFS and the relative gate at -10 LU
   below the ungated loudness. Block size, 400 ms. Overlap, 75%. Confirm each.
4. **Channel weighting.** The per-channel weights for mono, stereo, and 5.1.
5. **True peak.** How true-peak is measured, with 4x oversampling. Whether a
   -1 dBTP ceiling should be applied after gain, and how that interacts with the
   existing `limit()` function.
6. **Test vectors.** This is the most important part. Find published reference
   files or reference values with known LUFS. The EBU tech 3341 compliance
   material is the usual source. These become the Vitest test cases.
7. **Targets.** Confirm the standard targets: -14 LUFS for streaming, -16 LUFS
   for podcast, -23 LUFS for broadcast. State the tolerance each allows.
8. **Existing implementations.** Whether a small, well-tested JS library exists.
   Dependencies are allowed. Judge whether one is worth using.

## Answer format

Findings committed to a throwaway branch `research/lufs-bs1770`, as a markdown
file with a source link per claim.

It must include a table of test vectors: input description, expected LUFS, and
allowed tolerance. Ticket 010 turns those directly into tests.

---

## Resolution — 2026-08-18

Findings on branch `research/lufs-bs1770`, at
`.wayfinder/research/lufs-bs1770.md`. 68 source links. Every numeric claim comes
from the primary ITU and EBU documents, extracted from the official PDFs.

**Verdict: implement directly, about 150 lines in `src/lib/loudness.ts`. Do not
add a runtime dependency.**

**The specification is settled and cheap.** ITU-R BS.1770-5 (11/2023) is current,
but its Annex 1 is unchanged from -4. The stereo path has not moved since 2011.

**The 44.1 kHz gap is closed.** The specification publishes K-weighting
coefficients only for 48 kHz and does not say how to re-derive them. The research
inverted the published coefficients back to their analog prototype, confirmed the
result against libebur128, and regenerated the 48 kHz values to about 14 digits.
The 44.1 kHz coefficients are in the findings as copy-pasteable TypeScript.

**The test vectors are verified, not quoted.** A reference implementation was
written and run against EBU Tech 3341 cases 1-6, 9, 10, 12, 13 and 15-19, plus
both calibration checks, at 48 kHz **and** 44.1 kHz. Two traps are documented:
the 10 ms taper on true-peak signals is mandatory — case 18 fails by +0.68 dB
without it — and case 5's odd 20.1 s length is load-bearing.

**Why not a library.** The only Node-testable candidates are 0 to 2 star
packages. The best is six weeks old with 88 weekly downloads. Good code, bad
dependency. Suggested as a dev-only cross-check instead.

**Targets need care.** Of the five music platforms, only Spotify publishes a
LUFS number. Do not label -14 LUFS as YouTube's official target. Two corrections
to common lore: R128's plus or minus 0.5 LU is superseded, now plus or minus
1.0 LU live and 0.2 LU for quality control; and AES moved podcasts from -16 to
-18 LUFS.

**Scope note for ticket 010.** Keep the existing peak `normalize()` as its own
labelled operation rather than replacing it. Peak and loudness normalization are
different tools, and `limit()` is sample-peak, so it does not catch inter-sample
peaks.

**Flagged stale.** ATSC A/85:2026-07 was not read. The EBU test-set zip was not
downloaded.
