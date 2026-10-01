import {
  LEGACY_QUICK_CHATS_PROJECT_ID,
  ProjectId,
  QUICK_CHATS_PROJECT_ID,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isQuickChatsProject } from "./quickChats";

describe("Quick chats workspace", () => {
  it("recognizes the reserved and legacy project ids", () => {
    expect(isQuickChatsProject({ id: QUICK_CHATS_PROJECT_ID })).toBe(true);
    expect(isQuickChatsProject({ id: LEGACY_QUICK_CHATS_PROJECT_ID })).toBe(true);
    expect(isQuickChatsProject({ id: ProjectId.make("regular-project") })).toBe(false);
  });
});
