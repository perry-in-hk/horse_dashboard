export const NO_MEETING_PICK: string;
export const NOT_MENTIONED: string;

export function messageMentionsHorse(text: string, horseNo: number): boolean;

export function extractMention(text: string, horseNo: number): string;

export function winSuggestion(picks: {
  others?: { product?: string; combo?: string; reason_zh?: string; reason_en?: string; odds?: string }[];
  qpl?: { combo?: string; reason_zh?: string; reason_en?: string; product?: string }[];
} | null | undefined): { horseNo: number; reason: string; odds: string } | null;

export function followOnLines(picks: {
  others?: { product?: string; combo?: string; reason_zh?: string; reason_en?: string }[];
  qpl?: { combo?: string; reason_zh?: string; reason_en?: string; product?: string }[];
} | null | undefined): { product: string; combo: string; reason: string }[];

export type HorseQuote = {
  kind: "pick" | "transcript";
  product: string;
  speaker: string;
  text: string;
  ev_status?: string;
};

export type HorseNameView = "positive" | "negative" | "none";

export function listRoundNumbers(
  messages?: { meta_json?: Record<string, unknown> }[]
): number[];

export function horseNameView(quotes?: HorseQuote[]): HorseNameView;

export type HorseNote = {
  horse_no: number;
  summary_zh: string;
  buy_zh: string;
  stake_zh: string;
  view?: "positive" | "negative" | "none" | string;
};

export function horseNoteFor(
  horseNo: number,
  input?: {
    messages?: { meta_json?: Record<string, unknown> }[];
    picks?: { horse_notes?: HorseNote[]; _status?: { round_no?: number } } | null;
    roundNo?: number;
  }
): HorseNote | null;

export function commentsForHorse(
  horseNo: number,
  input?: {
    messages?: { content?: string; role?: string; meta_json?: Record<string, unknown> }[];
    picks?: {
      others?: { product?: string; combo?: string; reason_zh?: string; reason_en?: string; ev_status?: string }[];
      qpl?: { combo?: string; reason_zh?: string; reason_en?: string; product?: string; ev_status?: string }[];
    } | null;
    roundNo?: number;
  }
): HorseQuote[];
