import { ProjectId } from "./baseSchemas.ts";

export const QUICK_CHATS_PROJECT_ID = ProjectId.make("blackbird-quick-chats");
export const LEGACY_QUICK_CHATS_PROJECT_ID = ProjectId.make("blackboard-quick-chats");

export function isQuickChatsProjectId(projectId: ProjectId): boolean {
  return projectId === QUICK_CHATS_PROJECT_ID || projectId === LEGACY_QUICK_CHATS_PROJECT_ID;
}
