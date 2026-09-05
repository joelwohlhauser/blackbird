import * as Schema from "effect/Schema";
import { useLocalStorage } from "./useLocalStorage";

const ThreadNotificationPreferences = Schema.Record(Schema.String, Schema.Boolean);
const EMPTY_PREFERENCES: Readonly<Record<string, boolean>> = {};

// Overrides the global default for individual environment-scoped chats.
export function useThreadNotificationPreferences() {
  return useLocalStorage(
    "blackbird:thread-notifications:v1",
    EMPTY_PREFERENCES,
    ThreadNotificationPreferences,
  );
}
