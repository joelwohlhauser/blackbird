import { describe, expect, it } from "vite-plus/test";

import {
  LAST_CHAT_ROUTE_STORAGE_KEY,
  isRestorableChatPath,
  readLastChatPath,
  resolveStartupChatPath,
  writeLastChatPath,
} from "./lastChatRoute";

function memoryStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: (key: string) => (key === LAST_CHAT_ROUTE_STORAGE_KEY ? value : null),
    setItem: (key: string, nextValue: string) => {
      if (key === LAST_CHAT_ROUTE_STORAGE_KEY) value = nextValue;
    },
    value: () => value,
  };
}

describe("last chat route persistence", () => {
  it.each(["/", "/draft/draft-123", "/local/thread-123"])(
    "accepts the chat path %s",
    (pathname) => {
      expect(isRestorableChatPath(pathname)).toBe(true);
    },
  );

  it.each(["", "settings/general", "/settings/general/extra", "/draft/id/", "/draft/id?q=1"])(
    "rejects the non-chat path %s",
    (pathname) => {
      expect(isRestorableChatPath(pathname)).toBe(false);
    },
  );

  it("restores a persisted draft or thread only from the startup index", () => {
    expect(resolveStartupChatPath("/", "/draft/draft-123")).toBe("/draft/draft-123");
    expect(resolveStartupChatPath("/", "/local/thread-123")).toBe("/local/thread-123");
    expect(resolveStartupChatPath("/", "/")).toBeNull();
    expect(resolveStartupChatPath("/local/direct-link", "/local/thread-123")).toBeNull();
  });

  it("round-trips the last valid chat path", () => {
    const storage = memoryStorage();
    writeLastChatPath(storage, "/draft/draft-123");
    expect(storage.value()).toBe("/draft/draft-123");
    expect(readLastChatPath(storage)).toBe("/draft/draft-123");
  });

  it("ignores invalid and unavailable storage", () => {
    const storage = memoryStorage("/settings/general/extra");
    expect(readLastChatPath(storage)).toBeNull();
    writeLastChatPath(storage, "/settings/general/extra");
    expect(storage.value()).toBe("/settings/general/extra");

    const unavailableStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLastChatPath(unavailableStorage)).toBeNull();
    expect(() => writeLastChatPath(unavailableStorage, "/local/thread-123")).not.toThrow();
  });
});
