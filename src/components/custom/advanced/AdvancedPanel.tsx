import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LoudnessTarget } from "./LoudnessTarget";
import { ExportOptions } from "./ExportOptions";

/**
 * The Advanced view panel on a track card.
 *
 * **Two sections now, not three.** The map's vision is tracks in, regions cut,
 * files out — and *regions cut* left this panel. Everything about a region is on
 * the waveform: the tools in a strip above it, and a region's own gain, fades
 * and name drawn on the region itself. A panel below the card asked the user to
 * look away from the thing they were cutting.
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
export default function AdvancedPanel() {
  return (
    <Accordion type="multiple" className="w-full">
      <AccordionItem value="sound">
        <AccordionTrigger>Sound</AccordionTrigger>
        <AccordionContent>
          <LoudnessTarget />
          <EmptySection
            what="EQ, compressor, noise reduction, and time and pitch."
            ticket="the Sound feature tickets"
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="export" className="border-b-0">
        <AccordionTrigger>Export</AccordionTrigger>
        <AccordionContent>
          <ExportOptions />
          <EmptySection
            what="One joined file, with crossfades between regions."
            ticket="the join strip's own ticket"
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function EmptySection({ what, ticket }: { what: string; ticket: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {what} Not built yet — {ticket}.
    </p>
  );
}
