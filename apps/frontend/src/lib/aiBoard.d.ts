export const NO_PREOFF_QUOTE: string;

export type WinQuote = { horseNo: number; odds: number };

export type OddsSnapshot = { observed_at: string; payload?: unknown };

export function parseWinQuotes(raw: unknown): WinQuote[];

export function pickFavouriteAndSecond(
  quotes: WinQuote[]
): { favourite: WinQuote; second: WinQuote } | null;

export function choosePreOffSnapshot(
  snapshots: OddsSnapshot[] | null | undefined,
  postTimeMs: number | null | undefined
): { snapshot: OddsSnapshot; mode: "before-post" | "latest" } | null;

export function boardPricesFromSnapshots(
  snapshots: OddsSnapshot[] | null | undefined,
  postTimeMs: number | null | undefined,
  resultPageWinOdds?: unknown
): {
  label: string | null;
  favourite: WinQuote | null;
  second: WinQuote | null;
  observedAt: string | null;
  mode: "before-post" | "latest" | null;
};

export type HorseFormRow = {
  race_date?: string;
  racecourse?: string;
  race_no?: number | null;
  finish_position?: string | null;
  position_int?: number | null;
  draw?: number | null;
  race_distance?: number | null;
};

export function summarizeHorseForm(
  rows: HorseFormRow[] | null | undefined,
  ctx: {
    venueCode?: string;
    meetingDate?: string;
    raceNo?: number;
    distance?: number | null;
    draw?: number | null;
  }
): { sameVenueDistance: string; recent: string; draw: string };
