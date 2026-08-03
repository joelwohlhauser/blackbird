export const THREAD_SIDEBAR_OPEN_STORAGE_KEY = "blackbird:thread-sidebar-open:v1";

export function resolveInitialThreadSidebarOpen(persisted: boolean | null): boolean {
  return persisted ?? true;
}
