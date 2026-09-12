"use client";

/**
 * Lekki zestaw prymitywów UI dla całego panelu.
 * Celowo bez zewnętrznych bibliotek — spójny wygląd na bazie Tailwind + tokenów z tailwind.config.ts.
 */

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-moss",
  secondary: "border border-stone-300 bg-white text-ink hover:bg-stone-50",
  ghost: "text-steel hover:bg-stone-100 hover:text-ink",
  danger: "bg-red-600 text-white hover:bg-red-700",
  subtle: "bg-stone-100 text-ink hover:bg-stone-200"
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-sm"
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function Button({ variant = "primary", size = "md", block, className, ...props }: ButtonProps) {
  return (
    <button
      className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], block && "w-full", className)}
      {...props}
    />
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function ButtonLink({ href, variant = "primary", size = "md", block, className, ...props }: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], block && "w-full", className)}
      {...props}
    />
  );
}

type CardProps = HTMLAttributes<HTMLDivElement> & { padded?: boolean };

export function Card({ padded = true, className, ...props }: CardProps) {
  return (
    <div
      className={cx("rounded-xl2 border border-stone-200/80 bg-white shadow-card", padded && "p-5", className)}
      {...props}
    />
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("text-xs font-semibold uppercase tracking-[0.18em] text-steel", className)}>{children}</p>
  );
}

type BadgeTone = "neutral" | "moss" | "amber" | "red" | "blue";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-stone-100 text-stone-700",
  moss: "bg-moss/12 text-moss-dark",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  blue: "bg-sky-100 text-sky-800"
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        badgeTones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl2 border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-stone-400">{icon}</div> : null}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-steel">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-stone-200/70", className)} />;
}

export function SkeletonCard() {
  return (
    <Card>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-3 h-3 w-32" />
    </Card>
  );
}
