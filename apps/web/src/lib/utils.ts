import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and lets the later one win.
 *
 * Plain concatenation does not: `"px-2" + " px-4"` leaves both in the attribute and the
 * cascade picks by source order in the stylesheet, not by the order they were written here.
 * That is what makes a `className` prop on a component unreliable — the caller cannot
 * override a default padding without knowing which rule Tailwind emitted first. twMerge
 * drops the earlier of any two classes that set the same property, so the prop wins.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
