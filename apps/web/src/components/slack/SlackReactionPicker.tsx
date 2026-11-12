import { type ReactElement, useState } from "react";

import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useSlackDirectory } from "./slackDirectory";
import { resolveSlackEmoji, SLACK_EMOJI, SLACK_QUICK_REACTIONS } from "./slackEmoji";

const MAX_RESULTS = 48;
const STANDARD_NAMES = Object.keys(SLACK_EMOJI);
const DISTINCT_STANDARD_NAMES = STANDARD_NAMES.filter(
  (name, index) =>
    STANDARD_NAMES.findIndex((other) => SLACK_EMOJI[other] === SLACK_EMOJI[name]) === index,
);

export function SlackEmoji({ name }: { readonly name: string }) {
  const { mrkdwn } = useSlackDirectory();
  const glyph = resolveSlackEmoji(name, mrkdwn.customEmoji);
  if (glyph.kind === "image") {
    return <img alt={`:${name}:`} className="inline-block size-4 object-contain" src={glyph.url} />;
  }
  return <span>{glyph.value}</span>;
}

function matchingEmojiNames(query: string, customNames: ReadonlyArray<string>) {
  const needle = query.trim().toLowerCase().replaceAll(":", "");
  if (needle.length === 0) {
    const quick = new Set<string>(SLACK_QUICK_REACTIONS);
    return [...quick, ...DISTINCT_STANDARD_NAMES.filter((name) => !quick.has(name))].slice(
      0,
      MAX_RESULTS,
    );
  }
  return [...STANDARD_NAMES, ...customNames]
    .filter((name) => name.includes(needle))
    .toSorted((left, right) => Number(right.startsWith(needle)) - Number(left.startsWith(needle)))
    .slice(0, MAX_RESULTS);
}

export function SlackReactionPicker({
  open,
  onOpenChange,
  onPick,
  trigger,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (name: string) => void;
  readonly trigger: ReactElement<Record<string, unknown>>;
}) {
  const { mrkdwn } = useSlackDirectory();
  const [query, setQuery] = useState("");
  const names = open ? matchingEmojiNames(query, Object.keys(mrkdwn.customEmoji)) : [];
  const pick = (name: string) => {
    onPick(name);
    setQuery("");
    onOpenChange(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverPopup align="end" padding="compact" side="top">
        <div className="flex w-64 flex-col gap-2">
          <Input
            aria-label="Search emoji"
            autoFocus
            placeholder="Search emoji"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const first = names[0];
              if (event.key !== "Enter" || first === undefined) return;
              event.preventDefault();
              pick(first);
            }}
          />
          {names.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">No emoji found.</p>
          ) : (
            <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
              {names.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-label={`:${name}:`}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-base outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => pick(name)}
                >
                  <SlackEmoji name={name} />
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
