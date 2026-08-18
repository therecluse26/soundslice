# 005 — Research: LUFS loudness per ITU-R BS.1770

**Type:** `wayfinder:research`
**Status:** open
**Assignee:** research agent (charting session, 2026-08-18)
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
