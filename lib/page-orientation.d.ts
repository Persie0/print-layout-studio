import type { LayoutItem, LayoutPlacement } from "./layout.js";

type PageSize = { width: number; height: number };
type OrientationItem = LayoutItem & { textHeightRatio?: number };
type LayoutResult = { fits: boolean; imageScale: number; placements: LayoutPlacement[] };

export type PageLayoutChoice = {
  orientation: "portrait" | "landscape";
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
  layout: LayoutResult;
  textHeights: number[];
  smallestTextHeight: number | null;
  imageAreas: number[];
  imageShortSides: number[];
};

export function choosePageLayout(input: {
  portraitSize: PageSize;
  landscapeSize: PageSize;
  orientation?: "auto" | "portrait" | "landscape";
  margin?: number;
  gap?: number;
  imageBorder?: number;
  items?: OrientationItem[];
}): PageLayoutChoice;
