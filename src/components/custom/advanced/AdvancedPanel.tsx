import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MeterSource } from "@/lib/preview";
import { ExportOptions } from "./ExportOptions";
import { SignalChain } from "./SignalChain";

/**
 * The Advanced view panel on a track card.
 *
 * **Two sections, not three.** The map's vision is tracks in, regions cut,
 * files out — and *regions cut* left this panel. Everything about a region is on
 * the waveform: the tools in a strip above it, and a region's own gain, fades
 * and name drawn on the region itself. A panel below the card asked the user to
 * look away from the thing they were cutting.
 *
 * **Sound is a chain, not a form.** It was a slider and a note saying the rest
 * was not built. It is now the edit stack drawn in the order the audio passes
 * through it, with a live input and output meter at each end and a graphical
 * control for every block that has a shape. See `SignalChain`.
 *
 * Both sections start closed, so Advanced view opens looking almost identical to
 * Simple view.
 *
 * **This file is the lazy-load boundary.** It is reached only through a dynamic
 * import in `AudioEditor`, so a Simple view user never downloads it. Everything
 * Advanced-only must be imported from here or below, never from a module the
 * Simple path already pulls in.
 *
 * It must have a default export, because `React.lazy` requires one.
 */
export default function AdvancedPanel({
  fileName,
  meters,
}: {
  fileName: string;
  meters: MeterSource;
}) {
  return (
    <Accordion type="multiple" className="w-full">
      <AccordionItem value="sound">
        <AccordionTrigger>Sound</AccordionTrigger>
        <AccordionContent>
          {/*
            The chain and nothing else. A master loudness target used to sit
            above it, and the chain's own Loudness block made that two targets
            on one screen. The master one belongs with the other master
            defaults — it is on the toolbar now. See `LoudnessTarget`.
          */}
          <SignalChain fileName={fileName} meters={meters} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="export" className="border-b-0">
        <AccordionTrigger>Export</AccordionTrigger>
        <AccordionContent>
          <ExportOptions />
          <p className="text-xs text-muted-foreground">
            <b>Separate files or one joined file</b> is on the master toolbar,
            under Output Format — it decides the shape of the whole export, so it
            lives with the button that performs one. Reordering the joined
            regions, and crossfades between them, are the join strip's own
            ticket.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
