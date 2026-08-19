import {
  LEGACY_QUICK_CHATS_PROJECT_ID,
  type ProjectId,
  QUICK_CHATS_PROJECT_ID,
  isQuickChatsProjectId,
} from "@t3tools/contracts";

export { LEGACY_QUICK_CHATS_PROJECT_ID, QUICK_CHATS_PROJECT_ID };

/**
 * Quick chats use a real project internally because the orchestration model
 * requires every thread to have a workspace. The reserved id keeps that
 * implementation detail out of project pickers and normal project groups.
 */
export const QUICK_CHATS_PROJECT_TITLE = "Quick chats";
export const QUICK_CHATS_WORKSPACE_ROOT = "~";

export function isQuickChatsProject(project: { readonly id: ProjectId }): boolean {
  return isQuickChatsProjectId(project.id);
}
