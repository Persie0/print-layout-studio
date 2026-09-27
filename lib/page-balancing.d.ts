import type { Workspace } from "./storage";

export type BalancePageStats = {
  average: number | null;
  fits: boolean;
};

export type GroupMoveResult = {
  workspace: Workspace;
  sourcePage: number;
  targetPage: number;
  sourceGroupId: string;
  sourceGroupName: string;
  destinationGroupName: string;
  movedImageCount: number;
  movedImageIds: string[];
  before: { source: number; target: number };
  after: { source: number; target: number };
  improvement: number;
};

export type GroupMovesResult = {
  workspace: Workspace;
  moves: GroupMoveResult[];
};

export function findBestGroupMove(input: {
  workspace: Workspace;
  pages: number[];
  getPageStats: (workspace: Workspace, page: number) => BalancePageStats;
  createId: () => string;
  excludedImageIds?: Set<string>;
}): GroupMoveResult | null;

export function findBestGroupMoves(input: {
  workspace: Workspace;
  pages: number[];
  getPageStats: (workspace: Workspace, page: number) => BalancePageStats;
  createId: () => string;
}): GroupMovesResult | null;
