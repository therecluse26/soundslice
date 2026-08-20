import { RefObject, useRef, useState } from "react";
import { ResetIcon } from "@radix-ui/react-icons";
// The app's own switch, unchanged. It is already in Simple view's bundle by way
// of **Preview effects**, so using it here costs nothing.
import { Switch } from "@/components/ui/switch";
import { useAudioStore } from "@/stores/audio-store";
import {
  EditStack,
  LOUDNESS_TARGET_RANGE,
  Operation,
  OperationName,
  simpleStack,
} from "@/lib/edit-stack";
import {
  BLOCKS,
  BlockInfo,
  GAIN_RANGE,
  LIMITER_CEILING_RANGE,
  PEAK_TARGET_RANGE,
  blockSummary,
  formatDb,
  operationIn,
  replaceOperation,
  withOperation,
  withoutOperation,
} from "@/lib/signal-chain";
import { meterFraction } from "@/lib/meter";
import { MeterSource } from "@/lib/preview";
import { useMeterPair } from "@/hooks/useMeterPair";
import { countRender } from "@/lib/render-count";
import { EqEditor } from "./EqEditor";
import { CompressorEditor } from "./CompressorEditor";
import { ScaleStrip, ToolSlider } from "./ToolControls";

/**
 * The Sound section: the edit stack, drawn as the chain the audio goes through.
 *
 * ```
 *   in ▐  Noise ─ EQ ─ Comp ─ Gain ─ Loud ─ Peak ─ Limit  ▐ out
 * ```
 *
 * Left to right is the order the samples travel, which is `CANONICAL_ORDER` and
 * is checked against it by a test. A block is switched on with its own dot and
 * opened by clicking its name; the control that opens underneath is graphical
 * wherever the setting has a shape — a curve for the EQ and for the compressor,
 * a position on the meter scale for the three that are one level.
 *
 * The two meters are the ends of that chain, and they are live.
 *
 * ## Inherited until touched
 *
 * A track with no stack of its own shows the master defaults' chain, marked
 * **inherited**. Changing anything writes that chain onto the track and the
 * track stops following the master switches — ticket 003's override model,
 * unchanged. **Reset** gives it back.
 *
 * Advanced view only, and reached only through `AdvancedPanel`'s dynamic
 * import. Standing rule 6.
 */
export function SignalChain({
  fileName,
  meters,
}: {
  fileName: string;
  meters: MeterSource;
}) {
  if (import.meta.env.DEV) countRender(`SignalChain:${fileName}`);

  // One selector per thing, and the narrowest that will do. Selecting the whole
  // track would redraw this panel — and repaint two canvases — on every frame
  // of a region drag. Ticket 009's rule, applied to a panel that draws.
  const stack = useAudioStore(
    (state) => state.tracks.find((track) => track.file.name === fileName)?.stack
  );
  const normalizeAudio = useAudioStore((state) => state.normalizeAudio);
  const applyPostProcessing = useAudioStore((state) => state.applyPostProcessing);
  const loudnessTargetLufs = useAudioStore((state) => state.loudnessTargetLufs);
  const setTrackStack = useAudioStore((state) => state.setTrackStack);

  const [open, setOpen] = useState<OperationName | null>(null);

  // One undo entry per gesture. Incremented when a drag ends, so the next drag
  // cannot merge into the last one. The region overlays use the same counter
  // for the same reason.
  const gesture = useRef(0);

  const inherited = stack === undefined;
  const effective =
    stack ??
    simpleStack({ normalizeAudio, applyPostProcessing, loudnessTargetLufs });

  const targets = useMeterPair(meters, "vertical", true);

  /** Writes a chain onto the track. The first call claims it from the master. */
  const write = (next: EditStack, what: string) =>
    setTrackStack(fileName, next, {
      label: "Change sound",
      coalesceKey: `sound:${fileName}:${what}:${gesture.current}`,
    });

  const commit = () => {
    gesture.current += 1;
  };

  const toggle = (info: BlockInfo) => {
    if (!info.built) return;

    const next = operationIn(effective, info.op)
      ? withoutOperation(effective, info.op)
      : withOperation(effective, info.op);

    write(next, `toggle:${info.op}`);
    commit();
    setOpen(operationIn(next, info.op) ? info.op : null);
  };

  const change = (operation: Operation) =>
    write(replaceOperation(effective, operation), operation.op);

  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {inherited
            ? "Following the master switches. Change anything to give this track its own."
            : "This track has its own chain."}
        </span>

        {!inherited && (
          <button
            type="button"
            onClick={() => {
              setTrackStack(fileName, undefined, { label: "Reset sound" });
              commit();
              setOpen(null);
            }}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ResetIcon />
            Reset
          </button>
        )}
      </div>

      {/*
        No `flex-1` on the middle. The three parts hug each other, so the chain
        reads left to right as one thing — in, the blocks, out — instead of
        stranding a meter at each edge of a wide card. `min-w-0` is what still
        lets the block row scroll when it will not fit.
      */}
      <div className="flex items-end gap-2">
        <ChainMeter
          label="in"
          title="Dry — what enters the chain, after the region's own gain and fades"
          canvas={targets.input}
          readout={targets.inputReadout}
        />

        <div className="min-w-0 overflow-x-auto">
          <div className="flex items-center gap-0 pb-1">
            {BLOCKS.map((info, index) => (
              <div key={info.op} className="flex items-center">
                {index > 0 && (
                  <span
                    aria-hidden
                    className="w-2 shrink-0 border-t border-dashed border-border"
                  />
                )}
                <BlockTile
                  info={info}
                  operation={operationIn(effective, info.op)}
                  opened={open === info.op}
                  onOpen={() =>
                    setOpen((was) => (was === info.op ? null : info.op))
                  }
                  onToggle={() => toggle(info)}
                />
              </div>
            ))}
          </div>
        </div>

        <ChainMeter
          label="out"
          title="Wet — what leaves the chain and reaches the speakers"
          canvas={targets.output}
          readout={targets.outputReadout}
        />
      </div>

      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">
          The chain is doing
          {/*
            Written straight into the element on an animation frame. It changes
            sixty times a second and must never become React state.
          */}
          <code ref={targets.differenceReadout} className="mx-1 text-primary">
            —
          </code>
          dB to the level, right now.
        </span>
      </div>

      {open && (
        <OpenBlock
          op={open}
          stack={effective}
          onChange={change}
          onCommit={commit}
        />
      )}
    </div>
  );
}

/** One end of the chain: a label, a bar, and the level in decibels. */
function ChainMeter({
  label,
  title,
  canvas,
  readout,
}: {
  label: string;
  title: string;
  canvas: RefObject<HTMLCanvasElement>;
  readout: RefObject<HTMLElement>;
}) {
  return (
    <div
      title={title}
      className="flex w-11 shrink-0 flex-col items-center justify-end gap-1"
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <canvas
        ref={canvas}
        className="h-24 w-4 rounded-sm border border-border"
        aria-label={`${label} level`}
      />
      <code ref={readout} className="text-[10px] text-primary">
        −∞
      </code>
    </div>
  );
}

/**
 * One block of the chain, as a tile.
 *
 * A **switch** turns the block on, and it is the app's own switch — the same
 * one **Preview effects** uses, at the same size. It was a two-pixel dot, which
 * asked the user to aim at something the size of a full stop and told them
 * nothing about which way it was set.
 *
 * The name beside it opens the block's control underneath. Two targets, two
 * jobs: the switch decides **whether**, the name shows **what**.
 *
 * Only the name and the summary dim when a block is off. The switch stays at
 * full strength, because a dimmed switch is exactly the control you cannot read
 * when you need to.
 */
function BlockTile({
  info,
  operation,
  opened,
  onOpen,
  onToggle,
}: {
  info: BlockInfo;
  operation: Operation | undefined;
  opened: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const on = operation !== undefined;

  return (
    <div
      className={`flex w-[6.75rem] shrink-0 flex-col gap-1 rounded border px-2 py-1.5 transition-colors ${
        opened ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onOpen}
          title={info.what}
          className={`min-w-0 flex-1 truncate text-left text-[11px] font-medium hover:text-primary ${
            on ? "" : "opacity-55"
          }`}
        >
          {info.short}
        </button>

        <Switch
          checked={on}
          disabled={!info.built}
          onCheckedChange={onToggle}
          aria-label={`${info.label} on`}
          title={info.built ? info.what : `${info.what} Not built yet.`}
        />
      </div>

      <span className={`truncate text-[10px] text-muted-foreground ${on ? "" : "opacity-55"}`}>
        {!info.built ? "not built" : operation ? blockSummary(operation) : "off"}
      </span>
    </div>
  );
}

/** The control that opens under the chain for whichever block is selected. */
function OpenBlock({
  op,
  stack,
  onChange,
  onCommit,
}: {
  op: OperationName;
  stack: EditStack;
  onChange: (operation: Operation) => void;
  onCommit: () => void;
}) {
  const operation = operationIn(stack, op);
  const info = BLOCKS.find((block) => block.op === op);

  return (
    <div className="rounded border border-border p-2">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{info?.label}</span>
        <span className="text-xs text-muted-foreground">{info?.what}</span>
      </div>

      {!operation ? (
        <p className="text-xs text-muted-foreground">
          {info?.built
            ? "Switched off. Use the dot on the tile to add it to the chain."
            : "Not built yet. It needs an AudioWorklet and a measured noise profile, and neither exists."}
        </p>
      ) : (
        <BlockControls
          operation={operation}
          onChange={onChange}
          onCommit={onCommit}
        />
      )}
    </div>
  );
}

function BlockControls({
  operation,
  onChange,
  onCommit,
}: {
  operation: Operation;
  onChange: (operation: Operation) => void;
  onCommit: () => void;
}) {
  switch (operation.op) {
    case "eq":
      return (
        <EqEditor
          bands={operation.bands}
          onChange={(bands) => onChange({ op: "eq", bands })}
          onCommit={onCommit}
        />
      );

    case "compressor":
      return (
        <CompressorEditor
          operation={operation}
          onChange={onChange}
          onCommit={onCommit}
        />
      );

    case "gain":
      return (
        <>
          <ToolSlider
            label="Gain"
            display={formatDb(operation.db)}
            value={operation.db}
            range={GAIN_RANGE}
            onChange={(db) => onChange({ op: "gain", db })}
            onCommit={onCommit}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            One fixed change, for the whole track. A region's own gain line
            stacks on top of it, the way clip gain does in any editor.
          </p>
        </>
      );

    case "loudness":
      return (
        <>
          <ToolSlider
            label="Target"
            display={`${operation.targetLufs.toFixed(0)} LUFS`}
            value={operation.targetLufs}
            range={{ ...LOUDNESS_TARGET_RANGE, step: 1 }}
            onChange={(targetLufs) => onChange({ ...operation, targetLufs })}
            onCommit={onCommit}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            <b>This track's</b> own target, in LUFS. Peaks are held below{" "}
            {formatDb(operation.ceilingDbTp, 0)} true peak, so a very peaky track
            comes out quieter than the target rather than clipping. The target on
            the toolbar is the master default, for every track that has not
            claimed its own chain.
          </p>
        </>
      );

    case "peakNormalization":
      return (
        <>
          <ToolSlider
            label="Loudest sample"
            display={`${operation.targetDbfs.toFixed(1)} dBFS`}
            value={operation.targetDbfs}
            range={PEAK_TARGET_RANGE}
            onChange={(targetDbfs) =>
              onChange({ op: "peakNormalization", targetDbfs })
            }
            onCommit={onCommit}
          />
          <ScaleStrip
            fraction={meterFraction(operation.targetDbfs)}
            label={`${operation.targetDbfs.toFixed(1)} dBFS`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Scales the whole track so its single loudest sample lands here. This
            is not loudness — two tracks can share a peak and sound nothing
            alike.
          </p>
        </>
      );

    case "limiter":
      return (
        <>
          <ToolSlider
            label="Ceiling"
            display={formatDb(operation.ceilingDb, 2)}
            value={operation.ceilingDb}
            range={LIMITER_CEILING_RANGE}
            onChange={(ceilingDb) => onChange({ op: "limiter", ceilingDb })}
            onCommit={onCommit}
          />
          <ScaleStrip
            fraction={meterFraction(operation.ceilingDb)}
            label={formatDb(operation.ceilingDb, 2)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Holds the peaks below this. It is a sample-peak limiter, so it does
            not catch inter-sample peaks — the loudness block's own true-peak
            ceiling does that, before this ever sees the signal.
          </p>
        </>
      );

    case "noiseReduction":
      return (
        <p className="text-xs text-muted-foreground">
          Not built. It needs an AudioWorklet and a noise profile measured from a
          region the user marks as silent.
        </p>
      );
  }
}
