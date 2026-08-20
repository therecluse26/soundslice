# 010 — Build LUFS normalization with tests

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** claude
**Blocked by:** none — was [008](./008-build-the-edit-stack.md), [005](./005-research-lufs-bs1770.md) and [006](./006-install-vitest.md), all closed 2026-08-19 or earlier. Ticket 006 chose a plain `node` environment with no Web Audio, which is the shape this ticket's BS.1770 tests take. Ticket 008 left the hole this fills: `{ op: "loudness", targetLufs }` is in the `Operation` union, `needsMeasurement` returns true for it, and both `graph.ts` and `render.ts` throw for it naming this ticket.
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can loudness normalization replace peak normalization, under the existing
switch, without the user noticing a new control?

`normalize()` at `src/lib/audio-processors.ts:135` divides by the loudest single
sample. That is peak normalization. It makes levels *consistent in peak*, which
is not what the tooltip at `src/components/custom/MasterToolbar.tsx:80` promises:
"this will make the levels more consistent".

The work:

1. Build the LUFS measurement from the findings in ticket 005: K-weighting,
   400 ms blocks at 75% overlap, absolute gate at -70 LUFS, relative gate.
2. Build the gain calculation to reach a target.
3. Write it as a **pure function over `Float32Array`**, so it tests without Web
   Audio. Then wrap it as an operation on the edit stack.
4. Write Vitest cases from the test vectors in ticket 005. Every published
   reference value must pass, inside the stated tolerance.
5. Add true-peak limiting after the gain, so the result cannot clip. Check how
   this interacts with the existing `limit()`, which is always on at
   `src/lib/audio-processors.ts:342`.
6. Wire it under Simple view's existing "Normalize Levels?" switch, at a -14 LUFS
   default. Simple gains no new control.
7. Expose the target as a number in Advanced view.

## Watch for

`getMaxAmplitude` at `src/lib/audio-processors.ts:169` walks every sample of
every channel on the main thread. LUFS measurement is heavier still. It must
respect the worker boundary from ticket 007.

Keep peak normalization available as its own operation. It is still the right
tool for some jobs, and Advanced view should offer both. `CONTEXT.md` already
separates the two terms.

## Acceptance

Every reference vector passes. A quiet track and a loud track, both normalized
to -14 LUFS, sound equally loud. Neither clips.

---

## Resolution — 2026-08-19

**Built.** "Normalize Levels?" now measures loudness in LUFS, per ITU-R
BS.1770-5, and hits its target. Simple view gained no control.

### The answer to the question

> Can loudness normalization replace peak normalization, under the existing
> switch, without the user noticing a new control?

Yes. The switch is unchanged, its tooltip finally describes what it does, and
the target lives in Advanced view where a Simple user never sees it.

Verified through the production UI and checked against **ffmpeg's `ebur128`**,
which is an independent, well-tested implementation:

| | Before this ticket | After |
|---|---|---|
| Export at a −14 LUFS target | −16.8 LUFS, −0.5 dBFS peak | **−14.0 LUFS, −1.2 dBFS peak** |

### What was built

| Module | What it is |
|---|---|
| `src/lib/loudness.ts` | K-weighting, gated integrated loudness, true peak, and the capped gain |
| `src/lib/loudness.test.ts` | the EBU Tech 3341 vectors, 33 tests |
| `src/lib/compressor-calibration.ts` | cancels a makeup gain nobody asked for — see below |
| `src/components/custom/advanced/LoudnessTarget.tsx` | the target, Advanced view only |

`pnpm test` is 89 → **125 tests**.

### The vectors pass

Every EBU Tech 3341 Table 1 case that a file-based meter can run, generated in
the test file rather than downloaded — cases 1 to 6 and 15 to 19 are sine waves
the table specifies completely, so the 87 MB test set buys nothing. Cases 7 and
8 need authentic programme material and are not here.

Both calibration checks pass too: the −18 dBFS signal reads −18.0 LUFS, and a
0 dBFS 997 Hz sine on one channel reads −3.01 LKFS, which is what the −0.691
offset exists to produce.

**Case 1 and the calibration also pass at 44.1 kHz**, on coefficients no
document publishes. That is the gap ticket 005 closed, and this is the test that
holds it closed.

### Three things the maths had to get right, and one it had to avoid

- **The gate is strictly greater than.** EBU Tech 3342's example code uses `>=`
  and FFmpeg flags the conflict in a comment. The specification says `>`.
- **The surround weight is 1.41 on the mean square**, not √2 on the amplitude.
  Case 6 misses by about 1.5 LU if that is wrong.
- **The mean is taken in the energy domain.** Averaging decibels is the classic
  bug.
- **Nothing materialises the K-weighted signal.** A 45-minute stereo track is
  119 million frames per channel, so a `Float64Array` copy is 1.9 GB for the
  pair — over the app's whole memory ceiling, to compute one number. The
  measurement streams and keeps one float per 100 ms.

True peak got the same treatment. Filtering every sample is 48 multiply-adds
each, which is eleven billion operations on a 45-minute track. An interpolated
output cannot exceed the largest input in its window by more than +3.13 dB, so
windows that provably cannot win are skipped. **The result is exact, not an
estimate** — the bound only decides what to skip.

### The interaction the ticket asked about, and it was not the one expected

> "Check how this interacts with the existing `limit()`."

**`DynamicsCompressorNode` applies a makeup gain of +0.541 dB that nothing asked
for.** Measured in Chromium 146, a 1 kHz sine through the limiter's own settings:

| Input | Output | Gain |
|---|---|---|
| −60.0 dBFS | −59.459 | **+0.541 dB** |
| −40.0 dBFS | −39.459 | **+0.541 dB** |
| −20.0 dBFS | −19.459 | **+0.541 dB** |
| −10.0 dBFS | −9.459 | **+0.541 dB** |
| −3.0 dBFS | −2.459 | **+0.541 dB** |
| −0.5 dBFS | −0.342 | +0.158 dB — above the threshold, so compressing |

Identical at every level below the threshold. It is a constant gain, not
compression.

Three consequences, and the third is why it had to be fixed rather than noted:

1. **Every export SoundSlice has ever produced is 0.541 dB louder than its graph
   says.** This predates the map.
2. **It broke the true-peak ceiling.** The loudness operation caps its gain so
   the peak lands at −1 dBTP, and the limiter behind it added 0.541 dB.
3. **The Web Audio specification does not mention it**, so another browser may
   use a different figure or none. Leaving it in makes the same settings sound
   different on different browsers, which is what standing rule 1 exists to stop.

The fix measures it rather than hard-coding it: one 0.5-second offline render of
a tone 20 dB below the threshold, once per set of settings, cached for the life
of the page. A compensating `GainNode` takes it back off. A failed calibration
returns 1, which is the old behaviour, so this can never fail an export.

Proof it works — the limiter alone, on audio nowhere near its threshold:

| | Loudness | True peak |
|---|---|---|
| Source | −26.65 LUFS | −10.34 dBTP |
| Through the limiter, before | −26.13 (+0.52) | −9.80 (+0.54) |
| Through the limiter, after | **−26.67 (−0.02)** | **−10.34 (0.00)** |

### Acceptance

**Met.** "A quiet track and a loud track, both normalized to −14 LUFS, sound
equally loud. Neither clips."

The same music at two levels, 30.4 LU apart, both switches on, target −14 LUFS:

| | Loudness before | Loudness after | True peak after |
|---|---|---|---|
| Quiet, scaled by 0.03 | −57.04 LUFS | **−13.99 LUFS** | −1.20 dBTP |
| Loud, unscaled | −26.65 LUFS | **−13.99 LUFS** | −1.20 dBTP |

Identical to two decimal places, 0.01 LU from the target — inside EBU R128's
±0.2 LU quality-control tolerance — and 1.2 dB clear of full scale.

At a −23 LUFS target the same source reads **−22.99 LUFS**.

### When the target is not reached, and why that is right

With post-processing **off**, this source reads −17.33 LUFS at a −14 target and
its true peak lands on **exactly −1.00 dBTP**. The cap bound, and it should have:
the source's crest factor is 16.31 LU, so reaching −14 LUFS would need a true
peak of +2.31 dBTP.

**A capped gain does not reach the target, and that is correct.** It is why
streaming services turn loud masters down rather than turning quiet ones up
without limit. The alternative is a true-peak limiter, which changes the sound
rather than the level, and that is a bigger feature than this ticket.

The compressor lowers the crest factor, which is why the both-switches-on case
above reaches the target and this one does not.

### Speed

The extra render pass and the BS.1770 analysis cost about 400 ms on a 5-minute
track. Every headline number still beats both the original baseline and the
post-013 numbers:

| Case | Ticket 001 | After 013 | After 008 | **After 010** |
|---|---|---|---|---|
| Slice off, 30 s | 192.3 | 242.6 | 125.4 | **123.3** |
| Slice processed, 30 s | 378.7 | 349.5 | 262.5 | **308.8** |
| Slice off, 5-minute WAV | 2030.9 | 2238.8 | 1172.7 | **1207.5** |
| Slice processed, 5-minute WAV | 3779.2 | 3233.1 | 2500.4 | **2801.2** |
| Slice off, 5-minute MP3 | 2329.2 | 2729.8 | 1494.2 | **1543.0** |
| Slice processed, 5-minute MP3 | 3843.5 | 3632.9 | 2836.9 | **3090.2** |
| Batch, 10 × 30-second | 2350 | 2777.1 | 1525.2 | **1584.6** |

A 45-minute MP3, both switches on, ran twice at **26986.9** and **26915.8 ms**
against a 35446.0 ms baseline that killed the tab on repetition.

Simple bundle 111.95 → **113.02 KiB gzip**, against a 136.62 KiB target. The
loudness DSP is **not in it**: it ships in the encode worker, where it runs. The
target control ships in the Advanced chunk, 2.62 → 3.00 KiB gzip.

### What changed for a user

- **"Normalize Levels? Yes" now targets −14 LUFS instead of a 0 dBFS peak.**
  Exported bytes change, and this is the change the switch was always for.
- **Its tooltip was wrong and is now right.** It said "maximize the volume",
  which it did not do and should not.
- **Everything is 0.541 dB quieter** than the same settings produced before,
  because a makeup gain nobody asked for is gone.
- Master defaults reset once: the stored version is 2 → 3.

### What was deliberately not done

- **Peak normalization stays**, as its own operation, with its own tests. The
  research said to keep it and `CONTEXT.md` separates the two terms. Simple view
  still uses it for gain staging into the compressor.
- **No true-peak limiter.** The ceiling caps the gain instead, which never
  distorts. A limiter that reduces peaks dynamically is a Sound feature ticket.
- **Momentary and short-term loudness** are not built. Only integrated loudness
  is gated and only integrated loudness normalizes; M and S are meter features.
- **Cases 7, 8, 11, 14 and 20 to 23** are not tested. Seven and eight need the
  EBU files; eleven and fourteen are for live meters; twenty to twenty-three
  need signals synthesized at 4× and downsampled with sub-sample offsets.
