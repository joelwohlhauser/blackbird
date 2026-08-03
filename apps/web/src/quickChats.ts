import { ProjectId } from "@t3tools/contracts";

/**
 * Quick chats use a real project internally because the orchestration model
 * requires every thread to have a workspace. The reserved id keeps that
 * implementation detail out of project pickers and normal project groups.
 */
export const QUICK_CHATS_PROJECT_ID = ProjectId.make("blackbird-quick-chats");
export const LEGACY_QUICK_CHATS_PROJECT_ID = ProjectId.make("blackboard-quick-chats");
export const QUICK_CHATS_PROJECT_TITLE = "Quick chats";
export const QUICK_CHATS_WORKSPACE_ROOT = "~";

export function isQuickChatsProject(project: { readonly id: ProjectId }): boolean {
  return project.id === QUICK_CHATS_PROJECT_ID || project.id === LEGACY_QUICK_CHATS_PROJECT_ID;
}
