import {
  DEFAULT_TEXT_TO_SPEECH_VOICE,
  TEXT_TO_SPEECH_SPEEDS,
  TEXT_TO_SPEECH_VOICES,
} from "@t3tools/contracts/settings";
import { useGT } from "gt-react";

import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function TextToSpeechSettings() {
  const apiKey = useScopedSettings((settings) => settings.geminiApiKey);
  const voice = useScopedSettings((settings) => settings.textToSpeechVoice);
  const speed = useScopedSettings((settings) => settings.textToSpeechSpeed);
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();

  return (
    <SettingsSection title={gt("Text to speech")}>
      <SettingsRow
        {...searchableSetting("gemini-api-key")}
        description={gt(
          "Adds a read-aloud button next to the copy button on assistant messages. Stored on this device only.",
        )}
        resetAction={
          apiKey.length > 0 ? (
            <SettingResetButton
              ariaLabel={gt("Gemini API key")}
              onClick={() => updateSettings({ geminiApiKey: "" })}
            />
          ) : null
        }
        control={
          <DraftInput
            className="w-full sm:w-72"
            value={apiKey}
            onCommit={(value) => updateSettings({ geminiApiKey: value.trim() })}
            type="password"
            autoComplete="off"
            placeholder={gt("Gemini API key")}
            spellCheck={false}
            aria-label={gt("Gemini API key")}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("text-to-speech-voice")}
        description={gt("Gemini voice used to read messages.")}
        resetAction={
          voice !== DEFAULT_TEXT_TO_SPEECH_VOICE ? (
            <SettingResetButton
              ariaLabel={gt("voice", { $context: "text-to-speech voice setting" })}
              onClick={() => updateSettings({ textToSpeechVoice: DEFAULT_TEXT_TO_SPEECH_VOICE })}
            />
          ) : null
        }
        control={
          <Select
            value={voice}
            onValueChange={(value) => {
              if (typeof value === "string") updateSettings({ textToSpeechVoice: value });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              aria-label={gt("Voice", { $context: "text-to-speech voice setting" })}
            >
              <SelectValue>{voice}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {TEXT_TO_SPEECH_VOICES.map((option) => (
                <SelectItem hideIndicator key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("text-to-speech-speed")}
        description={gt(
          "Playback speed messages start at. Change it while listening with the speed button.",
        )}
        resetAction={
          speed !== 1 ? (
            <SettingResetButton
              ariaLabel={gt("reading speed")}
              onClick={() => updateSettings({ textToSpeechSpeed: 1 })}
            />
          ) : null
        }
        control={
          <Select
            value={speed}
            onValueChange={(value) => {
              const next = TEXT_TO_SPEECH_SPEEDS.find((option) => option === value);
              if (next !== undefined) updateSettings({ textToSpeechSpeed: next });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-28" aria-label={gt("Reading speed")}>
              <SelectValue>{`${speed}×`}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {TEXT_TO_SPEECH_SPEEDS.map((option) => (
                <SelectItem hideIndicator key={option} value={option}>
                  {`${option}×`}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
