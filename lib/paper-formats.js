export const PAPER_FORMATS = Object.freeze({
  a3: Object.freeze({ label: "A3", width: 841.89, height: 1190.55, printName: "A3" }),
  a4: Object.freeze({ label: "A4", width: 595.28, height: 841.89, printName: "A4" }),
  a5: Object.freeze({ label: "A5", width: 419.53, height: 595.28, printName: "A5" }),
  letter: Object.freeze({ label: "US Letter", width: 612, height: 792, printName: "letter" }),
  legal: Object.freeze({ label: "US Legal", width: 612, height: 1008, printName: "legal" }),
});

export function isPaperFormat(value) {
  return typeof value === "string" && Object.hasOwn(PAPER_FORMATS, value);
}

export function getPageSize(format, orientation = "portrait") {
  const selected = PAPER_FORMATS[isPaperFormat(format) ? format : "a4"];
  return orientation === "landscape"
    ? { width: selected.height, height: selected.width }
    : { width: selected.width, height: selected.height };
}

export function getPrintPageName(format) {
  return PAPER_FORMATS[isPaperFormat(format) ? format : "a4"].printName;
}
