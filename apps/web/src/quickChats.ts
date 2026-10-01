import { type ProjectId, isQuickChatsProjectId } from "@t3tools/contracts";

/**
 * Quick chats use a real project internally because the orchestration model
 * requires every thread to have a workspace. The server creates it on demand
 * (`projects.ensureScratch`), and the reserved id keeps it out of project
 * pickers and normal project groups.
 */
export const QUICK_CHATS_PROJECT_TITLE = "Quick chats";

export function isQuickChatsProject(project: { readonly id: ProjectId }): boolean {
  return isQuickChatsProjectId(project.id);
}
