/**
 * The controls a user drags **on** a region, not under it.
 *
 * ```
 *   ◤▁▁▁▁▁▁▁ Region 1 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ✕ ◥
 *   █▓▒░                                        ░▒▓█
 *   ────────────────── gain ─────────────────────────
 *   █▓▒░                                        ░▒▓█
 *   ◣ fade in                          fade out  ◢
 * ```
 *
 * Four things live here, and every one is where a DAW puts it:
 *
 * | Control | Where | Gesture |
 * |---|---|---|
 * | Fade in, fade out | a grip at each **top corner** | drag sideways |
 * | Region gain | a line **across** the region | drag up or down |
 * | Name | a label at the **top left** | double-click, then type |
 * | Delete | an ✕ at the **top right**, on hover | click |
 *
 * ## Why this is plain DOM and not React
 *
 * The region element belongs to the wavesurfer regions plugin. It is created by
 * `addRegion`, moved by `renderPosition`, and detached and re-attached by
 * `virtualAppend` as the waveform scrolls. React cannot own a node another
 * library creates and destroys, so this appends its own children to it and
 * removes exactly those.
 *
 * `virtualAppend` moving the region element takes these children with it, which
 * is the whole reason they are children of it rather than siblings.
 *
 * ## Why every handle stops its own `pointerdown`
 *
 * The plugin makes the whole region draggable, so a pointer press anywhere on it
 * moves the region. A press on a fade grip must not do that. `stopPropagation`
 * on `pointerdown` is what keeps them apart — and `click` is deliberately left to
 * bubble, so pressing a handle still selects the region.
 *
 * The maths is in [`region-geometry.ts`](./region-geometry.ts), where Vitest
 * reads it under Node. This file is the shell around it.
 */

import {
  fadeAfterDrag,
  fadeWidthPx,
  formatFade,
  formatGain,
  gainAfterDrag,
  gainLineFraction,
} from "./region-geometry";

/** Where a drag has got to. `end` is the gesture boundary undo coalesces on. */
export type DragPhase = "move" | "end";

/** What the overlay draws. Everything it needs, and nothing it does not. */
export type RegionOverlayView = {
  label: string;
  gainDb: number;
  fade: { inMs: number; outMs: number };
  /** The region's length in seconds, which fades are measured against. */
  durationSec: number;
  selected: boolean;
};

export type RegionOverlayHandlers = {
  onGain: (gainDb: number, phase: DragPhase) => void;
  onFade: (fade: { inMs: number; outMs: number }, phase: DragPhase) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
};

export type RegionOverlay = {
  /** Redraws from the store. Safe to call on every change. */
  update: (view: RegionOverlayView) => void;
  /** Removes every node and listener this added, and nothing else. */
  destroy: () => void;
};

/** The shade drawn over the part of a region a fade takes away. */
const FADE_SHADE = "rgba(9, 9, 11, 0.62)";
const LINE = "rgba(250, 250, 250, 0.75)";
const LINE_SELECTED = "rgba(250, 250, 250, 0.95)";

export function createRegionOverlay(
  element: HTMLElement,
  handlers: RegionOverlayHandlers
): RegionOverlay {
  let view: RegionOverlayView = {
    label: "",
    gainDb: 0,
    fade: { inMs: 0, outMs: 0 },
    durationSec: 1,
    selected: false,
  };

  const off: Array<() => void> = [];

  // Nothing in here takes the pointer unless it says so. The region underneath
  // has to stay draggable everywhere the controls are not.
  const root = div({
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "3",
  });

  const fadeInShade = div({
    position: "absolute",
    left: "0",
    top: "0",
    height: "100%",
    background: FADE_SHADE,
    clipPath: "polygon(0 0, 100% 0, 0 100%)",
  });

  const fadeOutShade = div({
    position: "absolute",
    right: "0",
    top: "0",
    height: "100%",
    background: FADE_SHADE,
    clipPath: "polygon(100% 0, 100% 100%, 0 0)",
  });

  // The gain line's hit area is eleven pixels tall and invisible; the line
  // inside it is two. A two-pixel target cannot be hit with a mouse.
  const gainGrip = div({
    position: "absolute",
    left: "0",
    right: "0",
    height: "11px",
    marginTop: "-5px",
    cursor: "ns-resize",
    pointerEvents: "auto",
    zIndex: "4",
  });

  // Two pixels, with a dark shadow under it. A pale line alone disappears
  // wherever it crosses a pale waveform bar, which is most of a loud region.
  const gainLine = div({
    position: "absolute",
    left: "0",
    right: "0",
    top: "4px",
    height: "0",
    borderTop: `2px solid ${LINE}`,
    boxShadow: "0 1px 2px rgba(9, 9, 11, 0.9)",
  });
  gainGrip.appendChild(gainLine);

  const fadeInGrip = fadeGrip("ew-resize");
  const fadeOutGrip = fadeGrip("ew-resize");

  const label = div({
    position: "absolute",
    left: "13px",
    top: "1px",
    maxWidth: "calc(100% - 46px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: "0 4px",
    borderRadius: "3px",
    background: "rgba(9, 9, 11, 0.5)",
    color: "#fafafa",
    font: "11px/16px ui-sans-serif, system-ui, sans-serif",
    cursor: "text",
    pointerEvents: "auto",
    zIndex: "5",
  });

  const nameInput = document.createElement("input");
  Object.assign(nameInput.style, {
    position: "absolute",
    left: "13px",
    top: "1px",
    width: "40%",
    padding: "0 4px",
    border: `1px solid ${LINE}`,
    borderRadius: "3px",
    background: "#09090b",
    color: "#fafafa",
    font: "11px/16px ui-sans-serif, system-ui, sans-serif",
    display: "none",
    pointerEvents: "auto",
    zIndex: "6",
  } as Partial<CSSStyleDeclaration>);
  nameInput.setAttribute("aria-label", "Region name");

  // Hidden until the pointer is over the region. A permanent ✕ on every region
  // is six delete buttons on a track that has been split.
  const remove = div({
    position: "absolute",
    right: "13px",
    top: "1px",
    width: "16px",
    height: "16px",
    borderRadius: "3px",
    background: "rgba(9, 9, 11, 0.5)",
    color: "#fafafa",
    font: "12px/16px ui-sans-serif, system-ui, sans-serif",
    textAlign: "center",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 0.12s ease",
    pointerEvents: "auto",
    zIndex: "5",
  });
  remove.textContent = "✕";
  remove.title = "Delete this region";

  /** What a drag is doing right now, so the readout can say so. */
  const readout = div({
    position: "absolute",
    right: "13px",
    bottom: "2px",
    padding: "0 4px",
    borderRadius: "3px",
    background: "rgba(9, 9, 11, 0.72)",
    color: "#fafafa",
    font: "11px/16px ui-monospace, SFMono-Regular, Menlo, monospace",
    display: "none",
    zIndex: "5",
  });

  root.append(
    fadeInShade,
    fadeOutShade,
    gainGrip,
    fadeInGrip,
    fadeOutGrip,
    label,
    nameInput,
    remove,
    readout
  );
  element.appendChild(root);

  // ---- gestures -----------------------------------------------------------

  off.push(
    drag(gainGrip, () => view.gainDb, (startGain, _dx, dy, phase) => {
      const gainDb = gainAfterDrag(startGain, dy, element.clientHeight);
      say(phase, formatGain(gainDb));
      handlers.onGain(gainDb, phase);
    })
  );

  off.push(
    drag(fadeInGrip, () => view.fade.inMs, (startFade, dx, _dy, phase) => {
      const inMs = fadeAfterDrag(
        startFade,
        dx,
        element.clientWidth,
        view.durationSec,
        1
      );
      say(phase, `fade in ${formatFade(inMs)}`);
      handlers.onFade({ inMs, outMs: view.fade.outMs }, phase);
    })
  );

  off.push(
    drag(fadeOutGrip, () => view.fade.outMs, (startFade, dx, _dy, phase) => {
      const outMs = fadeAfterDrag(
        startFade,
        dx,
        element.clientWidth,
        view.durationSec,
        -1
      );
      say(phase, `fade out ${formatFade(outMs)}`);
      handlers.onFade({ inMs: view.fade.inMs, outMs }, phase);
    })
  );

  off.push(listen(label, "dblclick", (event) => {
    event.stopPropagation();
    startRename();
  }));

  // The label is a drag target for the region underneath it otherwise, and a
  // user aiming at a name would move the region instead.
  off.push(listen(label, "pointerdown", (event) => event.stopPropagation()));

  off.push(listen(nameInput, "pointerdown", (event) => event.stopPropagation()));
  off.push(listen(nameInput, "blur", () => commitRename()));
  off.push(listen(nameInput, "keydown", (event) => {
    // Space plays the card and Delete removes the region. Neither may happen
    // while a name is being typed.
    event.stopPropagation();

    if ((event as KeyboardEvent).key === "Enter") nameInput.blur();
    if ((event as KeyboardEvent).key === "Escape") {
      nameInput.value = view.label;
      nameInput.blur();
    }
  }));

  off.push(listen(remove, "pointerdown", (event) => event.stopPropagation()));
  off.push(listen(remove, "click", (event) => {
    event.stopPropagation();
    handlers.onDelete();
  }));

  off.push(listen(element, "mouseenter", () => {
    remove.style.opacity = "1";
  }));
  off.push(listen(element, "mouseleave", () => {
    remove.style.opacity = "0";
  }));

  function startRename() {
    nameInput.value = view.label;
    label.style.display = "none";
    nameInput.style.display = "block";
    nameInput.focus();
    nameInput.select();
  }

  function commitRename() {
    nameInput.style.display = "none";
    label.style.display = "block";

    const typed = nameInput.value.trim();
    if (typed !== view.label) handlers.onRename(typed);
  }

  /** Shows what a drag is doing, and clears it when the drag ends. */
  function say(phase: DragPhase, text: string) {
    if (phase === "end") {
      readout.style.display = "none";
      return;
    }

    readout.textContent = text;
    readout.style.display = "block";
  }

  return {
    update(next: RegionOverlayView) {
      view = next;

      const width = element.clientWidth;
      const inPx = fadeWidthPx(next.fade.inMs, width, next.durationSec);
      const outPx = fadeWidthPx(next.fade.outMs, width, next.durationSec);

      fadeInShade.style.width = `${inPx}px`;
      fadeOutShade.style.width = `${outPx}px`;

      // The grip sits where the ramp meets the top of the region, which is what
      // it is dragging. At a fade of zero that is the corner itself.
      fadeInGrip.style.left = `${Math.max(0, inPx - 5)}px`;
      fadeOutGrip.style.right = `${Math.max(0, outPx - 5)}px`;

      gainGrip.style.top = `${gainLineFraction(next.gainDb) * 100}%`;
      gainLine.style.borderTopColor = next.selected ? LINE_SELECTED : LINE;

      label.textContent = next.label;
      label.style.fontWeight = next.selected ? "600" : "400";
    },

    destroy() {
      off.forEach((unsubscribe) => unsubscribe());
      root.remove();
    },
  };
}

// ---- small DOM helpers ----------------------------------------------------

function div(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = document.createElement("div");
  Object.assign(node.style, style);
  return node;
}

function fadeGrip(cursor: string): HTMLDivElement {
  return div({
    position: "absolute",
    top: "0",
    width: "10px",
    height: "10px",
    borderRadius: "0 0 3px 3px",
    background: LINE,
    cursor,
    pointerEvents: "auto",
    // Above the plugin's own resize handle, which is z-index 2 and full height.
    // The top ten pixels of an edge are the fade; the rest is the resize.
    zIndex: "5",
  });
}

function listen(
  target: EventTarget,
  type: string,
  handler: (event: Event) => void
): () => void {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

/**
 * A drag on one handle, measured from where it started.
 *
 * From the start of the gesture rather than frame by frame, so a slow drag and a
 * fast one over the same distance end in the same place. The listeners live on
 * `document`, so a pointer that leaves the region mid-drag keeps dragging.
 */
function drag(
  target: HTMLElement,
  startValue: () => number,
  onDrag: (start: number, dx: number, dy: number, phase: DragPhase) => void
): () => void {
  const down = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;

    pointer.preventDefault();
    // The region underneath is draggable. Without this, grabbing a fade grip
    // would move the whole region sideways instead.
    pointer.stopPropagation();

    const start = startValue();
    const x0 = pointer.clientX;
    const y0 = pointer.clientY;

    const move = (moved: PointerEvent) => {
      moved.preventDefault();
      onDrag(start, moved.clientX - x0, moved.clientY - y0, "move");
    };

    const up = (ended: PointerEvent) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      onDrag(start, ended.clientX - x0, ended.clientY - y0, "end");
    };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  target.addEventListener("pointerdown", down);
  return () => target.removeEventListener("pointerdown", down);
}
