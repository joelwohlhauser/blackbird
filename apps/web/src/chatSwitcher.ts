export type ChatSwitcherDirection = "next" | "previous";
export type ChatSwitcherModifier = "alt" | "control";

export function chatSwitcherVisibilityDelayMs(modifier: ChatSwitcherModifier): number {
  return modifier === "alt" ? 100 : 0;
}

export function chatSwitcherDirectionForShortcut(
  command: string | null,
  shiftKey: boolean,
): ChatSwitcherDirection | null {
  if (command !== "chat.switcher") return null;
  return shiftKey ? "previous" : "next";
}

export function activeChatSwitcherDirection(input: {
  readonly modifier: ChatSwitcherModifier;
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}): ChatSwitcherDirection | null {
  if (input.key.toLowerCase() !== "tab") return null;
  if (input.modifier === "alt" && !input.altKey) return null;
  if (input.modifier === "control" && !input.ctrlKey) return null;
  return input.shiftKey ? "previous" : "next";
}

export interface ChatSwitcherOrderableItem {
  readonly key: string;
  readonly updatedAt: string;
}

export function orderChatSwitcherItems<T extends ChatSwitcherOrderableItem>(input: {
  readonly items: ReadonlyArray<T>;
  readonly activeKey: string | null;
  readonly recentKeys: ReadonlyArray<string>;
}): T[] {
  const itemByKey = new Map(input.items.map((item) => [item.key, item] as const));
  const ordered: T[] = [];
  const seen = new Set<string>();

  const append = (key: string | null): void => {
    if (key === null || seen.has(key)) return;
    const item = itemByKey.get(key);
    if (!item) return;
    seen.add(key);
    ordered.push(item);
  };

  append(input.activeKey);
  input.recentKeys.forEach(append);

  const remaining = input.items
    .filter((item) => !seen.has(item.key))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  ordered.push(...remaining);

  return ordered;
}

export function initialChatSwitcherIndex(
  itemCount: number,
  direction: ChatSwitcherDirection,
  activeItemAtStart = true,
): number {
  if (itemCount <= 1) return 0;
  if (!activeItemAtStart) return direction === "next" ? 0 : itemCount - 1;
  return direction === "next" ? 1 : itemCount - 1;
}

export function adjacentChatSwitcherIndex(
  itemCount: number,
  currentIndex: number,
  direction: ChatSwitcherDirection,
): number {
  if (itemCount <= 1) return 0;
  const delta = direction === "next" ? 1 : -1;
  return (currentIndex + delta + itemCount) % itemCount;
}
