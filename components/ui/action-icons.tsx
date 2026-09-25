/**
 * Ikony akcji (edycja, usuwanie) — SVG dziedziczy kolor tekstu, tak jak ikony poczty
 * w components/case/mail-icons.tsx. Na telefonie przyciski karty sprawy pokazują same
 * ikony, więc każdy przycisk z ikoną ma mieć `aria-label` i `title`.
 */

type IconProps = { className?: string };

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconPencil({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

export function IconTrash({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}
