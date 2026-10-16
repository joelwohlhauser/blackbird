import type { DesktopAwakeState } from "@t3tools/contracts";
import { useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { getDesktopAwakeBridge, useDesktopAwakeState } from "../../lib/desktopAwake";
import { Button } from "../ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsUnavailableGroup,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

function awakeStatus(state: DesktopAwakeState | null, enabled: boolean, always: boolean) {
  if (!state?.installed) return "Needs a one-time setup with your administrator password.";
  if (state.message) return state.message;
  if (state.active) {
    return state.lowPower ? "Keeping the Mac awake in Low Power Mode." : "Keeping the Mac awake.";
  }
  if (!enabled) return undefined;
  return always
    ? "On. The Mac stays awake all the time."
    : "On. The Mac stays awake while local agents work.";
}

function PercentSetting({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (value: number) => void;
}) {
  return (
    <NumberField
      value={value}
      min={0}
      max={100}
      size="sm"
      className="w-20"
      onValueCommitted={(next) => {
        if (next !== null && next !== value) onCommit(Math.round(next));
      }}
    >
      <NumberFieldGroup>
        <NumberFieldInput aria-label={label} />
      </NumberFieldGroup>
    </NumberField>
  );
}

export function AwakeSettings() {
  const settings = useClientSettings();
  const updateSettings = useUpdateClientSettings();
  const bridge = getDesktopAwakeBridge();
  const [state, setState] = useDesktopAwakeState();
  const [pending, setPending] = useState(false);
  const available = Boolean(bridge) && state?.supported !== false;
  const installed = state?.installed ?? false;

  const change = (action: "setup" | "remove") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then((next) => {
        setState(next);
        if (action === "remove") void updateSettings({ awakeEnabled: false });
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              action === "setup" ? "Could not set up Keep awake" : "Could not remove Keep awake",
            description: error instanceof Error ? error.message : "Something went wrong.",
          }),
        );
      })
      .finally(() => setPending(false));
  };

  return (
    <SettingsPageContainer>
      <SettingsSection id="awake" title="Keep awake">
        <SettingsUnavailableGroup
          message={available ? undefined : "Available only in the macOS desktop app."}
        >
          <SettingsRow
            {...searchableSetting("awake-enabled")}
            description="Keep the Mac awake, lid closed included, while local chats are working and for 3 minutes after."
            status={
              available
                ? awakeStatus(state, settings.awakeEnabled, settings.awakeAlways)
                : undefined
            }
            control={
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!available || pending}
                  onClick={() => change(installed ? "remove" : "setup")}
                >
                  {installed ? "Remove" : "Set up…"}
                </Button>
                <Switch
                  checked={installed && settings.awakeEnabled}
                  disabled={!available || !installed}
                  aria-label="Keep the Mac awake while agents work"
                  onCheckedChange={(checked) => void updateSettings({ awakeEnabled: checked })}
                />
              </>
            }
          />
          <SettingsRow
            {...searchableSetting("awake-always")}
            description="Keep the Mac awake all the time, even when no agents are working. Battery and heat rules still apply."
            control={
              <Switch
                checked={settings.awakeAlways}
                disabled={!available || !installed || !settings.awakeEnabled}
                aria-label="Keep the Mac awake all the time"
                onCheckedChange={(checked) => void updateSettings({ awakeAlways: checked })}
              />
            }
          />
        </SettingsUnavailableGroup>
      </SettingsSection>

      {available ? (
        <>
          <SettingsSection id="awake-power" title="Battery and heat">
            <SettingsRow
              {...searchableSetting("awake-low-power")}
              description="Turn on Low Power Mode when the battery drops below this level."
              control={
                <PercentSetting
                  value={settings.awakeLowPowerBelowPercent}
                  label="Low Power Mode below percent"
                  onCommit={(value) => void updateSettings({ awakeLowPowerBelowPercent: value })}
                />
              }
            />
            <SettingsRow
              {...searchableSetting("awake-sleep-below")}
              description="Let the Mac sleep when the battery drops below this level. 0 turns this off."
              control={
                <PercentSetting
                  value={settings.awakeSleepBelowPercent}
                  label="Sleep below percent"
                  onCommit={(value) => void updateSettings({ awakeSleepBelowPercent: value })}
                />
              }
            />
            <SettingsRow
              {...searchableSetting("awake-heat")}
              description="Turn on Low Power Mode when the Mac gets seriously hot, and let it sleep at critical heat."
              control={
                <Switch
                  checked={settings.awakeHeatRules}
                  aria-label="Heat rules"
                  onCheckedChange={(checked) => void updateSettings({ awakeHeatRules: checked })}
                />
              }
            />
          </SettingsSection>

          <SettingsSection id="awake-hotspot" title="Hotspot failover">
            <SettingsRow
              {...searchableSetting("awake-hotspot")}
              description="When the internet drops while the Mac is kept awake, turn on Personal Hotspot on your iPhone and join it, then switch back once a known Wi-Fi network is in range. The iPhone needs to be nearby and signed in to the same Apple Account. Blackbird Hotspot asks once for Location Services to see Wi-Fi names."
              control={
                <Switch
                  checked={settings.awakeHotspotFailover}
                  aria-label="Hotspot failover"
                  onCheckedChange={(checked) =>
                    void updateSettings({ awakeHotspotFailover: checked })
                  }
                />
              }
            />
          </SettingsSection>
        </>
      ) : null}
    </SettingsPageContainer>
  );
}
