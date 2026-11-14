import type { DesktopAwakeState } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { useState } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { getDesktopAwakeBridge, useDesktopAwakeState } from "../../lib/desktopAwake";
import { Button } from "../ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ScopedSwitch } from "./ScopedSwitch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsUnavailableGroup,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

function awakeStatus(state: DesktopAwakeState | null, enabled: boolean, always: boolean) {
  if (state?.message) return state.message;
  if (state?.level === "full") {
    return state.lowPower
      ? "Keeping the Mac awake in Low Power Mode, lid closed included."
      : "Keeping the Mac awake, lid closed included.";
  }
  if (state?.level === "base") {
    return state.installed && enabled
      ? "Agents are working, so the Mac doesn't idle-sleep."
      : "Agents are working, so the Mac doesn't idle-sleep. Closing the lid still puts it to sleep.";
  }
  if (!state?.installed) return "Needs a one-time setup with your administrator password.";
  if (!enabled) return undefined;
  return always
    ? "On. The Mac stays awake all the time."
    : "On. The Mac stays awake while agents work.";
}

function KeepAwakeWhileAgentsWorkRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      settingKeys={["keepAwakeWhileAgentsWork"]}
      {...searchableSetting("keep-awake-while-agents-work")}
      description="While agents work, the computer doesn't idle-sleep. It can sleep again a minute after they finish. Closing a laptop lid still sleeps it, unless a Mac is set up to stay awake with the lid closed."
      resetAction={
        settings.keepAwakeWhileAgentsWork !== DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork ? (
          <SettingResetButton
            label="keep awake while agents work"
            onClick={() =>
              updateSettings({
                keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
              })
            }
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={["keepAwakeWhileAgentsWork"]}
          checked={settings.keepAwakeWhileAgentsWork}
          onCheckedChange={(checked) =>
            updateSettings({ keepAwakeWhileAgentsWork: Boolean(checked) })
          }
          aria-label="Keep awake while agents work"
        />
      }
    />
  );
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
        if (action === "remove") void updateClientSettings({ awakeEnabled: false });
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
        <KeepAwakeWhileAgentsWorkRow />
      </SettingsSection>

      <SettingsSection id="awake-lid-closed" title="Lid closed">
        <SettingsUnavailableGroup
          message={available ? undefined : "Available only in the macOS desktop app."}
        >
          <SettingsRow
            {...searchableSetting("awake-enabled")}
            description="Also keep the Mac awake with the lid closed while agents work. Blackbird turns macOS sleep off and turns it back on a minute after they finish."
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
                  aria-label="Keep the Mac awake with the lid closed"
                  onCheckedChange={(checked) =>
                    void updateClientSettings({ awakeEnabled: checked })
                  }
                />
              </>
            }
          />
          <SettingsRow
            {...searchableSetting("awake-always")}
            description="Keep the Mac awake with the lid closed all the time, even when no agents are working. Battery and heat rules still apply."
            control={
              <Switch
                checked={settings.awakeAlways}
                disabled={!available || !installed || !settings.awakeEnabled}
                aria-label="Keep the Mac awake all the time"
                onCheckedChange={(checked) => void updateClientSettings({ awakeAlways: checked })}
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
              description="With the lid-closed setup, turn on Low Power Mode when the battery drops below this level."
              control={
                <PercentSetting
                  value={settings.awakeLowPowerBelowPercent}
                  label="Low Power Mode below percent"
                  onCommit={(value) =>
                    void updateClientSettings({ awakeLowPowerBelowPercent: value })
                  }
                />
              }
            />
            <SettingsRow
              {...searchableSetting("awake-sleep-below")}
              description="Let the Mac sleep when the battery drops below this level, even while agents work. 0 turns this off."
              control={
                <PercentSetting
                  value={settings.awakeSleepBelowPercent}
                  label="Sleep below percent"
                  onCommit={(value) => void updateClientSettings({ awakeSleepBelowPercent: value })}
                />
              }
            />
            <SettingsRow
              {...searchableSetting("awake-heat")}
              description="Let the Mac sleep at critical heat, even while agents work. With the lid-closed setup, also turn on Low Power Mode when it gets seriously hot."
              control={
                <Switch
                  checked={settings.awakeHeatRules}
                  aria-label="Heat rules"
                  onCheckedChange={(checked) =>
                    void updateClientSettings({ awakeHeatRules: checked })
                  }
                />
              }
            />
          </SettingsSection>

          <SettingsSection id="awake-hotspot" title="Hotspot failover">
            <SettingsRow
              {...searchableSetting("awake-hotspot")}
              description="When the internet drops while the lid-closed setup keeps the Mac awake, join the hotspot of a nearby iPhone on your Apple Account until known Wi-Fi is back. Asks once for Location Services."
              control={
                <Switch
                  checked={settings.awakeHotspotFailover}
                  aria-label="Hotspot failover"
                  onCheckedChange={(checked) =>
                    void updateClientSettings({ awakeHotspotFailover: checked })
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
