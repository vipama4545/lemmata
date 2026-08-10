import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",

        // ----- variants of this app's own, not shadcn's -----

        // The workhorse of the reader: a 2px-bordered chip on the card surface that turns
        // the accent colour on hover. Every toolbar and every row of controls is built from
        // it, which is why it is a variant rather than a className repeated forty times.
        control:
          "border-2 border-border bg-card text-foreground font-medium hover:border-primary hover:bg-control-hover disabled:opacity-45 disabled:hover:border-border disabled:hover:bg-card",
        // The same chip in its pressed state: used where the button reports a mode that is
        // currently on, rather than an action.
        controlOn: "border-2 border-primary bg-card text-primary font-medium hover:bg-control-hover",
        // Sits on the header's dark gradient rather than on a surface, so its colours are
        // white at low alpha rather than the theme's — the theme's would vanish into it.
        header:
          "border-2 border-white/20 bg-white/5 text-white hover:border-white/40 hover:bg-white/15",
        // The one irreversible thing in this app gets the one colour used nowhere else.
        danger:
          "border border-destructive bg-destructive text-destructive-foreground font-semibold hover:brightness-93",
        dangerOutline:
          "border border-destructive bg-card text-destructive font-semibold hover:bg-destructive/10",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
        // Height comes from the content rather than a fixed track, so a control can hold two
        // stacked lines — the grade buttons say a word and the wait it buys underneath it.
        auto: "h-auto px-5 py-2.5",
        "auto-sm": "h-auto px-3 py-1.5 text-[13px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
