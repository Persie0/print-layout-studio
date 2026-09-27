export type ImageGroup = {
  id: string;
  name: string;
  color: string;
  numberImages?: boolean;
};

export const IMAGE_GROUP_COLORS: readonly string[];
export const MAX_IMAGE_GROUPS: number;
export function normalizeImageGroups(value: unknown): ImageGroup[];
export function createImageGroup(existingGroups: ImageGroup[], id: string): ImageGroup | null;
