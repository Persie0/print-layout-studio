export const PAPER_FORMATS: Readonly<Record<PaperFormat, Readonly<{
  label: string;
  width: number;
  height: number;
  printName: string;
}>>>;

export type PaperFormat = "a3" | "a4" | "a5" | "letter" | "legal";

export function isPaperFormat(value: unknown): value is PaperFormat;
export function getPageSize(format: PaperFormat, orientation?: "portrait" | "landscape"): {
  width: number;
  height: number;
};
export function getPrintPageName(format: PaperFormat): string;
