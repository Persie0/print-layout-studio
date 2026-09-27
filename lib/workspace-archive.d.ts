import type { Workspace } from "./storage";

export function createWorkspaceArchive(workspace: Workspace): Promise<Uint8Array>;
export function readWorkspaceArchive(archiveBytes: ArrayBuffer | Uint8Array): Workspace;
