import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",

        // ----- variants of this app's own, not shadcn's -----

        // The two CEFR levels, each with a tinted panel of its own so a word's level is
        // legible from the colour before the letters are read.
        a1: "bg-level-a1 text-level-a1-foreground text-[11px] font-bold uppercase",
        a2: "bg-level-a2 text-level-a2-foreground text-[11px] font-bold uppercase",
        // Part of speech, conjugation group, aspect: a fact about the word rather than a
        // judgement on it, so it stays the quietest thing in the row.
        tag: "bg-muted text-faint text-[11px]",
        // The same fact where it has to hold its own against a heading rather than a row.
        tagOutline: "border-border bg-muted text-muted-foreground text-[11px] font-semibold",
        // A count or a level on the header's dark gradient, where the theme's own surfaces
        // would disappear.
        onHeader: "bg-white/10 text-white text-[13px] font-normal px-3 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
