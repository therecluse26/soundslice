import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioStore } from "@/stores/audio-store";
import { countRender } from "@/lib/render-count";

/**
 * **Join** — separate files, or one joined file per track. Advanced view only.
 *
 * A track with six regions gives six files, or one file holding all six laid
 * end to end. The second is what a recording wants: split a podcast on silence,
 * and you want one clean file back, not sixty fragments.
 *
 * ## What a join does, exactly
 *
 * Regions are laid end to end **in start-time order**, with no overlap and no
 * crossfade. Each keeps its own gain and its own fade edges, so a seam is a
 * fade-out immediately followed by a fade-in. Split on silence already keeps
 * padding at each end so those fades ramp over silence, which is why the seam
 * is inaudible for the case this exists for.
 *
 * The track's stack runs **once**, over the whole joined file — so a compressor
 * keeps its envelope across the seams, and a loudness target resolves to one
 * gain for the file rather than a different one per region.
 *
 * ## Why it is on the master toolbar
 *
 * It decides the shape of a whole export, and the button that performs one is
 * here. It is a master default beside the other export choices, for the same
 * reason the output format is: a batch that gave one joined file and five loose
 * regions would be a batch nobody asked for.
 *
 * **Advanced only, and therefore lazy-loaded.** `MasterToolbar` is in Simple
 * view's bundle, so this is reached through a dynamic import and needs a default
 * export. Standing rule 6.
 */
export default function JoinRegions() {
  if (import.meta.env.DEV) countRender("JoinRegions");

  const joinRegions = useAudioStore((state) => state.joinRegions);
  const setJoinRegions = useAudioStore((state) => state.setJoinRegions);

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <Label className="text-xs font-normal text-muted-foreground">Regions</Label>

      <Select
        value={joinRegions ? "joined" : "separate"}
        onValueChange={(value) => setJoinRegions(value === "joined")}
      >
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="separate">Separate files</SelectItem>
          <SelectItem value="joined">One joined file</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
