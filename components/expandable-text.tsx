"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ClampLines, clampClass, isTextOverflowing, normalizeText } from "@/lib/expandable-text";

/**
 * Długi opis skrócony do kilku wierszy, z przełącznikiem „Rozwiń / Zwiń".
 *
 * Powstał z konkretnego problemu: przy rozbudowanym zakresie prac jedno zlecenie zajmowało
 * pół ekranu, przez co przejście do kolejnego wymagało długiego przewijania, a pozycje na
 * liście miały skrajnie różne wysokości.
 *
 * Przełącznik pokazuje się **tylko wtedy, gdy tekst faktycznie się nie mieści** — inaczej
 * przy krótkich opisach wisiałby bezużyteczny przycisk. Sprawdzamy to po wyrenderowaniu,
 * bo długość tekstu nie mówi nic o liczbie wierszy: zależy ona od szerokości kolumny,
 * rozmiaru czcionki i miejsc łamania wyrazów.
 */

type Props = {
  text: string | null | undefined;
  /** Ile wierszy pokazać w stanie zwiniętym. */
  lines?: ClampLines;
  className?: string;
  /** Tekst zastępczy, gdy opis jest pusty. */
  emptyLabel?: string;
};

export function ExpandableText({ text, lines = 2, className = "", emptyLabel = "—" }: Props) {
  const content = normalizeText(text);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  const measure = useCallback(() => {
    const node = textRef.current;
    if (!node) return;
    if (expanded) return; // W stanie rozwiniętym nic nie jest przycięte — pomiar byłby fałszywy.
    setOverflowing(isTextOverflowing(node.scrollHeight, node.clientHeight));
  }, [expanded]);

  useEffect(() => {
    measure();
  }, [measure, content, lines]);

  // Zmiana szerokości okna zmienia liczbę wierszy — przy zwężeniu tekst może zacząć wystawać.
  useEffect(() => {
    const node = textRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  // Listy mają dwa warianty — karty na telefonie, tabelę na desktopie — i oba są w drzewie
  // strony naraz, jeden ukryty przez CSS. Ukryty mierzy się na zerowej wysokości, więc po
  // przejściu przez próg szerokości trzeba go zmierzyć jeszcze raz; sam `ResizeObserver`
  // tego nie łapie, bo w kolumnie o stałej szerokości akapit wcale nie zmienia rozmiaru.
  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  if (!content) {
    return <p className={`text-sm ${className}`.trim()}>{emptyLabel}</p>;
  }

  return (
    <div className="min-w-0">
      <p
        ref={textRef}
        // Kolor tekstu zostaje po stronie wywołania — ten sam komponent trafia na jasne kafelki
        // i na wiersze tabeli, a klasy koloru Tailwinda nie nadpisują się kolejnością w atrybucie.
        className={`whitespace-pre-wrap break-words text-sm ${clampClass(lines, expanded)} ${className}`.trim()}
      >
        {content}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          // Listy bywają klikalne (przejście do zlecenia) — przełącznik nie może tego uruchamiać.
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="relative z-10 mt-0.5 rounded text-xs font-semibold text-moss hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
          aria-expanded={expanded}
        >
          {expanded ? "Zwiń" : "Rozwiń"}
        </button>
      )}
    </div>
  );
}
