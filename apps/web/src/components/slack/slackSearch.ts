export interface SlackSearch {
  readonly view?: "unreads" | "snoozed";
  readonly c?: string;
  readonly item?: string;
  readonly t?: string;
}

function searchString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;
}

export function validateSlackSearch(raw: Record<string, unknown>): SlackSearch {
  const c = searchString(raw.c);
  const item = searchString(raw.item);
  const t = searchString(raw.t);
  if (c !== undefined) return { c, ...(t === undefined ? {} : { t }) };
  return {
    ...(raw.view === "snoozed" ? { view: "snoozed" as const } : {}),
    ...(item === undefined ? {} : { item }),
  };
}
