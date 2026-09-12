import { renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { existsSync } from "node:fs";
import { createElement } from "react";
import { AsBuiltEstimatePdfDocument } from "@/components/pdf/as-built-estimate-pdf-document";
import {
  buildAsBuiltLineSnapshots,
  formatContractReference,
  roundMoney,
  sumAsBuiltNet
} from "@/lib/as-built-estimate";
import { settleAgainstPayments } from "@/lib/money-vat";
import { formatPlDate } from "@/lib/offer-pdf-helpers";
import { sellerProfileFromOrganization } from "@/lib/organization-offer-profile";
import type { OrganizationOfferRow } from "@/lib/organization-offer-profile";
import type { AsBuiltLineSnapshot, CaseRow, OfferLine } from "@/lib/types";

function logoPath(): string | null {
  const p = path.join(process.cwd(), "public", "logo-golbud.png");
  return existsSync(p) ? p : null;
}

export type AsBuiltPdfInput = {
  caseRow: CaseRow;
  org: OrganizationOfferRow | null;
  lines: OfferLine[];
  contractNumber: string | null;
  contractDate: string | null;
  settlementBasis: string;
  footerNote: string;
  advancesPaid: number;
  issueDate?: Date;
};

export type AsBuiltPdfSnapshotInput = {
  caseRow: Pick<CaseRow, "client_name" | "location" | "work_description">;
  org: OrganizationOfferRow | null;
  lines: AsBuiltLineSnapshot[];
  contractNumber: string | null;
  contractDate: string | null;
  settlementBasis: string;
  footerNote: string | null;
  netTotal: number;
  advancesPaid: number;
  balanceDue: number;
  /** Starsze rekordy nie mają kwot brutto — wtedy dokument odtwarza się w dawnym układzie netto. */
  vatRate?: number | null;
  vatTotal?: number | null;
  grossTotal?: number | null;
  balanceDueGross?: number | null;
  issueDate: Date;
};

/** Kwoty brutto rozliczenia; brak = rekord sprzed wprowadzenia VAT do kosztorysu. */
export type AsBuiltGrossFigures = {
  vatRate: number;
  vatTotal: number;
  grossTotal: number;
  balanceDueGross: number;
};

function buildDocumentProps(input: {
  caseRow: Pick<CaseRow, "client_name" | "location" | "work_description">;
  org: OrganizationOfferRow | null;
  lines: AsBuiltLineSnapshot[];
  contractNumber: string | null;
  contractDate: string | null;
  settlementBasis: string;
  footerNote: string;
  netTotal: number;
  advancesPaid: number;
  balanceDue: number;
  gross: AsBuiltGrossFigures | null;
  issueDate: Date;
}) {
  return {
    logoPath: logoPath(),
    issueDate: formatPlDate(input.issueDate),
    seller: sellerProfileFromOrganization(input.org),
    investorName: input.caseRow.client_name,
    investmentAddress: input.caseRow.location,
    contractReference: formatContractReference(input.contractNumber, input.contractDate),
    settlementBasis: input.settlementBasis,
    workDescription: input.caseRow.work_description,
    lines: input.lines,
    netTotal: roundMoney(Number(input.netTotal) || 0),
    advancesPaid: roundMoney(Number(input.advancesPaid) || 0),
    balanceDue: roundMoney(Number(input.balanceDue) || 0),
    gross: input.gross,
    footerNote: input.footerNote
  };
}

function grossFromSnapshot(input: AsBuiltPdfSnapshotInput): AsBuiltGrossFigures | null {
  if (input.vatRate == null || input.grossTotal == null || input.balanceDueGross == null) return null;
  return {
    vatRate: Number(input.vatRate),
    vatTotal: roundMoney(Number(input.vatTotal) || 0),
    grossTotal: roundMoney(Number(input.grossTotal) || 0),
    balanceDueGross: roundMoney(Number(input.balanceDueGross) || 0)
  };
}

export function buildAsBuiltPdfProps(input: AsBuiltPdfInput) {
  const snapshots = buildAsBuiltLineSnapshots(input.lines);
  const netTotal = sumAsBuiltNet(snapshots);
  const advancesPaid = roundMoney(Math.max(0, input.advancesPaid));
  // Wpłaty klienta są brutto — potrącamy je od wartości brutto, nie netto.
  const seller = sellerProfileFromOrganization(input.org);
  const settlement = settleAgainstPayments(netTotal, seller.defaultVatRate, advancesPaid);
  const gross: AsBuiltGrossFigures = {
    vatRate: settlement.vatRate,
    vatTotal: settlement.vat,
    grossTotal: settlement.gross,
    balanceDueGross: settlement.balanceGross
  };
  // `balanceDue` (netto) zostaje w rekordzie dla zgodności ze starszą historią kosztorysów.
  const balanceDue = roundMoney(Math.max(0, netTotal - advancesPaid));
  const issue = input.issueDate ?? new Date();

  return {
    snapshots,
    netTotal,
    advancesPaid,
    balanceDue,
    gross,
    props: buildDocumentProps({
      caseRow: input.caseRow,
      org: input.org,
      lines: snapshots,
      contractNumber: input.contractNumber,
      contractDate: input.contractDate,
      settlementBasis: input.settlementBasis,
      footerNote: input.footerNote,
      netTotal,
      advancesPaid,
      balanceDue,
      gross,
      issueDate: issue
    })
  };
}

export async function renderAsBuiltEstimatePdf(input: AsBuiltPdfInput): Promise<{
  buffer: Buffer;
  snapshots: AsBuiltLineSnapshot[];
  netTotal: number;
  advancesPaid: number;
  balanceDue: number;
  gross: AsBuiltGrossFigures;
}> {
  const built = buildAsBuiltPdfProps(input);
  const buffer = await renderToBuffer(
    createElement(AsBuiltEstimatePdfDocument, built.props) as Parameters<typeof renderToBuffer>[0]
  );
  return {
    buffer: Buffer.from(buffer),
    snapshots: built.snapshots,
    netTotal: built.netTotal,
    advancesPaid: built.advancesPaid,
    balanceDue: built.balanceDue,
    gross: built.gross
  };
}

/** Ponowne generowanie PDF z zapisanego snapshotu (bez Storage). */
export async function renderAsBuiltEstimatePdfFromSnapshot(input: AsBuiltPdfSnapshotInput): Promise<Buffer> {
  const buffer = await renderToBuffer(
    createElement(
      AsBuiltEstimatePdfDocument,
      buildDocumentProps({
        caseRow: input.caseRow,
        org: input.org,
        lines: input.lines,
        contractNumber: input.contractNumber,
        contractDate: input.contractDate,
        settlementBasis: input.settlementBasis,
        footerNote: input.footerNote?.trim() || "",
        netTotal: input.netTotal,
        advancesPaid: input.advancesPaid,
        balanceDue: input.balanceDue,
        gross: grossFromSnapshot(input),
        issueDate: input.issueDate
      })
    ) as Parameters<typeof renderToBuffer>[0]
  );
  return Buffer.from(buffer);
}
