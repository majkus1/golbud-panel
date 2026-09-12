"use client";

import { EstimateImportPanel } from "@/components/case/estimate-import-panel";

type Props = {
  variantId: string;
  organizationId: string;
  baseSortOrder: number;
  onImported: () => Promise<void> | void;
};

/** Przycisk + panel importu kosztorysu na istniejącej ofercie. */
export function EstimateImport({ variantId, organizationId, baseSortOrder, onImported }: Props) {
  return (
    <EstimateImportPanel
      mode="persist"
      variantId={variantId}
      organizationId={organizationId}
      baseSortOrder={baseSortOrder}
      onImported={onImported}
    />
  );
}
