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
 * Three sections, in the order the map's vision states: **tracks in, regions
 * cut, files out.** Every section starts closed, so Advanced view opens looking
 * almost identical to Simple view.
 *
 * Every section is empty. That is expected at this point: this ticket builds
 * the shell and the lazy-load boundary, and the feature tickets fill it.
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
      <AccordionItem value="regions">
        <AccordionTrigger>Regions</AccordionTrigger>
        <AccordionContent>
          <EmptySection
            what="Many regions, split on silence, and snap to transients."
            ticket="the Regions feature tickets"
          />
        </AccordionContent>
      </AccordionItem>

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
