export type LayoutItem = {
  id: string;
  type: "image" | "text";
  width: number;
  height: number;
};

export type LayoutPlacement = {
  id: string;
  type: "image" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
};

export function layoutPage(input: {
  width: number;
  height: number;
  gap?: number;
  imageBorder?: number;
  items: LayoutItem[];
}): { fits: boolean; imageScale: number; placements: LayoutPlacement[] };
