import { memo } from "react";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { TEXT_TO_SPEECH_SPEEDS } from "@t3tools/contracts/settings";

import { useClientSettings } from "~/hooks/useSettings";
import {
  playTextToSpeech,
  setTextToSpeechSpeed,
  stopTextToSpeech,
  useTextToSpeechStore,
} from "~/textToSpeech";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const MessageListenButton = memo(function MessageListenButton({
  messageId,
  text,
}: {
  messageId: string;
  text: string;
}) {
  const apiKey = useClientSettings((settings) => settings.geminiApiKey);
  const voice = useClientSettings((settings) => settings.textToSpeechVoice);
  const defaultSpeed = useClientSettings((settings) => settings.textToSpeechSpeed);
  const playback = useTextToSpeechStore((state) =>
    state.playback?.messageId === messageId ? state.playback : null,
  );

  if (apiKey.trim().length === 0) return null;

  const label = playback ? "Stop reading" : "Read aloud";
  const nextSpeed = playback
    ? (TEXT_TO_SPEECH_SPEEDS[
        (TEXT_TO_SPEECH_SPEEDS.indexOf(playback.speed) + 1) % TEXT_TO_SPEECH_SPEEDS.length
      ] ?? defaultSpeed)
    : defaultSpeed;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              onClick={() =>
                playback
                  ? stopTextToSpeech()
                  : void playTextToSpeech({
                      messageId,
                      markdown: text,
                      apiKey: apiKey.trim(),
                      voice,
                      speed: defaultSpeed,
                    })
              }
              type="button"
              size="xs"
              variant="ghost-muted"
            />
          }
        >
          {playback?.status === "loading" ? (
            <Spinner size="xs" />
          ) : playback ? (
            <SquareIcon className="size-3 fill-current" />
          ) : (
            <Volume2Icon className="size-3" />
          )}
        </TooltipTrigger>
        <TooltipPopup>
          <p>{label}</p>
        </TooltipPopup>
      </Tooltip>
      {playback ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Change reading speed"
                onClick={() => setTextToSpeechSpeed(nextSpeed)}
                type="button"
                size="xs"
                variant="ghost-muted"
              />
            }
          >
            <span className="tabular-nums">{playback.speed}×</span>
          </TooltipTrigger>
          <TooltipPopup>
            <p>Reading speed</p>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
});
