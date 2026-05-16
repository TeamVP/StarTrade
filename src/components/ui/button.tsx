import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, MouseEventHandler } from "react";
import { playUiSound, type UiSoundKind } from "@/lib/audio/uiSounds";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  asChild?: boolean;
  uiSound?: UiSoundKind | "none";
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-st-accent text-slate-950 hover:opacity-90",
  secondary: "bg-st-panel text-st-fg border border-st-border hover:border-st-accent",
  outline: "border border-st-border text-st-fg hover:border-st-accent hover:bg-st-panel",
  ghost: "text-st-muted hover:text-st-fg",
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  asChild = false,
  uiSound = "button_press",
  onClick,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (!disabled && uiSound !== "none") {
      playUiSound(uiSound);
    }
    onClick?.(event);
  };

  return (
    <Comp
      type={asChild ? undefined : type}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        className,
      )}
      onClick={handleClick}
      disabled={disabled}
      {...props}
    />
  );
}
