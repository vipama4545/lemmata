import type { MorphemePart } from "@/utils/verbMorphology";

/**
 * One hue per slot of the verb template, so a form reads as
 * preverb · person · version · ROOT · PFSF · stem · screeve · ending.
 *
 * The colours themselves are theme variables — both themes need their own values to stay
 * legible against the surface they sit on — and this table is what turns a parsed segment
 * into the class that wears one. The verb pages, the anatomy chips, the legend and the
 * definition card in the story reader all colour from here, which is the point: a root is
 * the same red wherever a form is broken up.
 */
export const MORPHEME_CLASS: Record<MorphemePart, string> = {
  preverb: "text-mo-preverb",
  person: "text-mo-person",
  version: "text-mo-version",
  // The root carries the weight as well as the colour — it is the part everything else hangs
  // off, and it is what you scan for when comparing screeves down a column.
  root: "text-mo-root font-bold",
  pfsf: "text-mo-pfsf",
  screeve: "text-mo-screeve",
  ending: "text-mo-ending",
  particle: "text-faint",
  // Material the segmenter could not place. Tinted rather than underlined: Mkhedruli has too
  // many descenders for an underline to sit anywhere useful.
  other: "bg-muted rounded-[3px] shadow-[0_0_0_1px_var(--border)]",
  // Not a morpheme at all — text between the pieces, which takes the colour around it.
  plain: "",
};
