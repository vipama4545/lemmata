import type { ComponentProps } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchFieldProps extends ComponentProps<"input"> {
  /** The bigger of the two sizes, for a page whose whole job is the search box. */
  large?: boolean;
  /** Applied to the wrapper; the rest of the props go to the input. */
  wrapperClassName?: string;
}

/**
 * A search box with the magnifier inside the field rather than beside it.
 *
 * The icon is positioned rather than laid out, and the input is padded to clear it, so the
 * placeholder starts where the typing will. It picks up the accent colour from the wrapper's
 * `focus-within`, which is the only way to colour it from the input's state without making
 * it a sibling that can steal the click — hence `pointer-events-none`.
 */
export function SearchField({ large = false, className, wrapperClassName, ...props }: SearchFieldProps) {
  return (
    <div className={cn("relative flex min-w-[200px] flex-1 focus-within:[&_svg]:text-primary", wrapperClassName)}>
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint transition-colors",
          large ? "left-4 size-5" : "left-3.5 size-[18px]",
        )}
        aria-hidden="true"
      />
      <Input
        type="text"
        className={cn(
          "h-auto rounded-lg border-2 border-border bg-card shadow-none focus-visible:border-primary focus-visible:ring-0",
          large ? "py-4 pr-5 pl-[50px] text-xl md:text-xl" : "py-3 pr-4 pl-[42px] text-base md:text-base",
          className,
        )}
        {...props}
      />
    </div>
  );
}
