/**
 * Ikony modułu korespondencji.
 *
 * Świadomie SVG zamiast emoji — emoji renderują się inaczej w każdym systemie
 * (na Windowsie część wychodzi kolorowa i rozjeżdża wysokość wiersza), więc pasek
 * narzędzi wyglądał niespójnie. SVG dziedziczy kolor tekstu i zawsze ma ten sam rozmiar.
 */

type IconProps = { className?: string };

const base = "shrink-0";

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconPaperclip({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  );
}

export function IconLink({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

export function IconListBullet({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" fill="currentColor" />
      <circle cx="3.5" cy="12" r="1" fill="currentColor" />
      <circle cx="3.5" cy="18" r="1" fill="currentColor" />
    </Svg>
  );
}

export function IconListNumber({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M4 4h1v4M3 16.5c0-.8.7-1.5 1.5-1.5S6 15.7 6 16.5c0 1.2-2 1.6-2 3h2" strokeWidth="1.6" />
    </Svg>
  );
}

export function IconClearFormat({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 5h11M12 5l-3 9" />
      <path d="M4 20l14-14" />
    </Svg>
  );
}
