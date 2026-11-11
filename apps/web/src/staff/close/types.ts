import type { SplitBody } from "@lodos/shared";
import type { Loc } from "../kds/types";
import type { PayMethod } from "../floor/types";

/**
 * `GET`/`PUT /api/checks/:id/split` (the API's `SplitView`, apps/api/src/checks/split.ts). Every amount is kuruş and
 * computed on the server; the client only ever sends an amount back to confirm it.
 */
export type { SplitBody };
export type SplitMode = "full" | "even" | "items";

export interface SplitUnit {
  ref: string;
  lineRef: string;
  name: Loc;
  options: Loc[];
  /** 0 when comped. */
  unitAmount: number;
  station: "kitchen" | "bar";
  vatRate: 10 | 20;
  comp: { reason: string } | null;
  /** By item: the shares this unit is divided between, in label order. */
  labels: string[];
  /** It can't be reassigned: in a paid share, a locked Evenly split, or a paid check. */
  frozen: boolean;
}

export interface SharePart {
  ref: string;
  part: number;
  parts: number;
}

export interface SharePayment {
  method: PayMethod;
  amount: number;
  at: string;
  last4: string | null;
}

export interface ShareView {
  label: string;
  amount: number;
  units: SharePart[];
  payment: SharePayment | null;
}

export interface SplitView {
  checkId: string;
  tableName: string;
  status: "open" | "paid";
  total: number;
  mode: SplitMode;
  count: number;
  /** Any share is paid: the mode (and an Evenly count) can't change. */
  locked: boolean;
  units: SplitUnit[];
  shares: ShareView[];
  /** Units worth more than ₺0 with no label (By item). */
  unassigned: { count: number; amount: number };
  paidCount: number;
  /** total − Σ paid. */
  left: number;
}

/** `POST /api/checks/:id/shares/:label/pay`. */
export interface PayShareResult {
  changed: boolean;
  share: ShareView;
  closed: boolean;
}

export const MIN_SHARES = 2;
export const MAX_SHARES = 20;
