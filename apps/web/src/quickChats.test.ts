import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isQuickChatsProject,
  LEGACY_QUICK_CHATS_PROJECT_ID,
  QUICK_CHATS_PROJECT_ID,
  QUICK_CHATS_PROJECT_TITLE,
  QUICK_CHATS_WORKSPACE_ROOT,
} from "./quickChats";

describe("Quick chats workspace", () => {
  it("uses a reserved project rooted in the personal directory", () => {
    expect(QUICK_CHATS_PROJECT_TITLE).toBe("Quick chats");
    expect(QUICK_CHATS_WORKSPACE_ROOT).toBe("~");
    expect(isQuickChatsProject({ id: QUICK_CHATS_PROJECT_ID })).toBe(true);
    expect(isQuickChatsProject({ id: LEGACY_QUICK_CHATS_PROJECT_ID })).toBe(true);
    expect(isQuickChatsProject({ id: ProjectId.make("regular-project") })).toBe(false);
  });
});
