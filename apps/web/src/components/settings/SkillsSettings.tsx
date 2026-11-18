import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  SkillSourceConfig,
  SkillSourceInstructionsMode,
  SkillSourceStatus,
  SkillSourceSyncMode,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { msg, T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import type { MessageResolver } from "../../i18n/messages";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { useNowMinute } from "../../hooks/useNowMinute";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const SYNC_LABELS: Record<SkillSourceSyncMode, string> = {
  none: msg("No git sync"),
  pull: msg("Pull only"),
  "two-way": msg("Two-way sync"),
};

const INSTRUCTIONS_LABELS: Record<SkillSourceInstructionsMode, string> = {
  none: msg("No instructions"),
  inject: msg("Add AGENTS.md to every session"),
  link: msg("Use AGENTS.md as global instructions"),
};

export function SkillsSettingsPanel() {
  const gt = useGT();
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment) {
    return (
      <SettingsScopeNotice target="environment">
        {gt("Choose one environment to manage its skills.")}
      </SettingsScopeNotice>
    );
  }
  if (environment.serverConfig?.environment.capabilities.skillSync !== true) {
    return (
      <SettingsScopeNotice target="environment">
        {gt("Update this environment to manage its skills.")}
      </SettingsScopeNotice>
    );
  }
  return (
    <SkillsSettingsForm key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function SkillsSettingsForm({ environmentId }: { readonly environmentId: EnvironmentId }) {
  useNowMinute();
  const gt = useGT();
  const messages = useMessages();
  const sources = useScopedSettings((settings) => settings.skillSources);
  const disabledSkills = useScopedSettings((settings) => settings.disabledSkills);
  const autopilotEnabled = useScopedSettings((settings) => settings.autopilotEnabled);
  const updateSettings = useUpdateScopedSettings();
  const statusResult = useAtomValue(
    serverEnvironment.skillSyncStatus({ environmentId, input: {} }),
  );
  const status = statusResult._tag === "Success" ? statusResult.value : null;
  const syncNow = useAtomCommand(serverEnvironment.syncSkills);
  const canSync = useAtomValue(serverEnvironment.syncSkills.permissionAtom(environmentId));
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const statusById = new Map(status?.sources.map((source) => [source.id, source]));
  const builtIns = status?.sources.filter((source) => source.kind !== "configured") ?? [];
  const saveSources = (next: ReadonlyArray<SkillSourceConfig>) => {
    updateSettings({ skillSources: next });
    setEditing(null);
  };
  const setSkillEnabled = (name: string, enabled: boolean) =>
    updateSettings({
      disabledSkills: enabled
        ? disabledSkills.filter((skill) => skill !== name)
        : [...disabledSkills, name].toSorted(),
    });
  const runSync = async () => {
    setSyncing(true);
    const result = await syncNow({ environmentId, input: {} });
    setSyncing(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: gt("Could not sync skills"),
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };

  const skillRows = [
    ...builtIns.filter((source) => autopilotEnabled || source.kind !== "bundled"),
    ...sources.flatMap((source) => statusById.get(source.id) ?? []),
  ].flatMap((source) => source.skills.map((name) => ({ source, name })));

  return (
    <SettingsPageContainer>
      {status !== null && status.conflicts.length > 0 && (
        <SettingsSection id="skills-conflicts" title={gt("Conflicts")}>
          {status.conflicts.map((conflict) => (
            <SettingsRow key={conflict} title={conflict} />
          ))}
        </SettingsSection>
      )}
      <SettingsSection {...searchableSetting("skills-autopilot")} title={gt("Autopilot")}>
        <SettingsRow
          title={gt("Autopilot")}
          description={gt(
            "Gives agents Blackbird's shape, build, and ship skills and the instructions on when to use them.",
          )}
          control={
            <Switch
              aria-label={gt("Use autopilot")}
              checked={autopilotEnabled}
              onCheckedChange={(enabled) => updateSettings({ autopilotEnabled: enabled })}
            />
          }
        />
      </SettingsSection>
      <SettingsSection
        {...searchableSetting("skills-sources")}
        title={gt("Sources")}
        headerAction={
          <Button
            variant="outline"
            size="sm"
            disabled={syncing || !canSync}
            onClick={() => void runSync()}
          >
            {syncing ? <T>Syncing…</T> : <T>Sync now</T>}
          </Button>
        }
      >
        {builtIns.map((source) => (
          <SettingsRow
            key={source.id}
            title={source.label}
            description={describe(messages, source)}
          />
        ))}
        {sources.map((source) =>
          editing === source.id ? (
            <SourceEditor
              key={source.id}
              initial={source}
              sources={sources}
              onCancel={() => setEditing(null)}
              onSave={(next) =>
                saveSources(sources.map((entry) => (entry.id === source.id ? next : entry)))
              }
            />
          ) : (
            <SettingsRow
              key={source.id}
              title={source.label || source.id}
              description={describe(messages, statusById.get(source.id), source)}
              control={
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setEditing(source.id)}>
                    <T>Edit</T>
                  </Button>
                  <Button
                    variant="destructive-outline"
                    size="sm"
                    onClick={() => saveSources(sources.filter((entry) => entry.id !== source.id))}
                  >
                    <T>Remove</T>
                  </Button>
                </div>
              }
            />
          ),
        )}
        {editing === "" ? (
          <SourceEditor
            initial={null}
            sources={sources}
            onCancel={() => setEditing(null)}
            onSave={(next) => saveSources([...sources, next])}
          />
        ) : (
          <SettingsRow
            title={gt("Add a source")}
            description={gt(
              "A folder or git checkout with {skillPath} and an optional AGENTS.md.",
              { skillPath: "skills/<name>/SKILL.md" },
            )}
            control={
              <Button variant="outline" size="sm" onClick={() => setEditing("")}>
                <T>Add source</T>
              </Button>
            }
          />
        )}
      </SettingsSection>
      <SettingsSection {...searchableSetting("skills-list")} title={gt("Skills")}>
        {skillRows.length === 0 ? (
          <SettingsRow title={gt("No skills found yet")} />
        ) : (
          skillRows.map(({ source, name }) => (
            <SettingsRow
              key={`${source.id}:${name}`}
              title={name}
              description={source.label}
              control={
                <Switch
                  aria-label={gt("Use {name}", { name })}
                  checked={!disabledSkills.includes(name)}
                  onCheckedChange={(enabled) => setSkillEnabled(name, enabled)}
                />
              }
            />
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function describe(
  resolve: MessageResolver,
  status: SkillSourceStatus | undefined,
  config?: SkillSourceConfig,
) {
  const details = [
    status?.path ?? (config?.path || null),
    config ? resolve(SYNC_LABELS[config.sync]) : null,
    config && config.instructions !== "none"
      ? resolve(INSTRUCTIONS_LABELS[config.instructions])
      : null,
    status === undefined
      ? resolve(msg("Not synced yet"))
      : !status.available
        ? resolve(msg("Not found on this environment"))
        : status.lastSyncedAt
          ? resolve(
              msg("Synced {time}", {
                time: formatRelativeTimeLabel(status.lastSyncedAt, undefined, resolve),
              }),
            )
          : null,
  ].filter((detail): detail is string => detail !== null && detail.length > 0);
  return (
    <span>
      <span className="block">{details.join(" · ")}</span>
      {status?.lastError && <span className="block text-destructive">{status.lastError}</span>}
    </span>
  );
}

function sourceId(label: string, sources: ReadonlyArray<SkillSourceConfig>) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+|-+$/g, "") || "source";
  let id = base;
  for (let suffix = 2; sources.some((source) => source.id === id); suffix++)
    id = `${base}-${suffix}`;
  return id;
}

function SourceEditor({
  initial,
  sources,
  onSave,
  onCancel,
}: {
  readonly initial: SkillSourceConfig | null;
  readonly sources: ReadonlyArray<SkillSourceConfig>;
  readonly onSave: (source: SkillSourceConfig) => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [remote, setRemote] = useState(initial?.remote ?? "");
  const [sync, setSync] = useState<SkillSourceSyncMode>(initial?.sync ?? "none");
  const [instructions, setInstructions] = useState<SkillSourceInstructionsMode>(
    initial?.instructions ?? "none",
  );
  const otherLinkSource = sources.find(
    (source) => source.id !== initial?.id && source.instructions === "link",
  );
  const error =
    path.trim() === "" && remote.trim() === ""
      ? gt("Enter a folder, a git remote, or both.")
      : instructions === "link" && otherLinkSource
        ? gt("{source} already provides the global instructions.", {
            source: otherLinkSource.label || otherLinkSource.id,
          })
        : null;
  const save = () => {
    if (error !== null) return;
    const trimmedLabel = label.trim();
    onSave({
      id: initial?.id ?? sourceId(trimmedLabel || path || remote, sources),
      label: trimmedLabel,
      path: path.trim(),
      remote: remote.trim() === "" ? null : remote.trim(),
      sync,
      instructions,
    });
  };

  return (
    <SettingsRow
      title={
        initial ? gt("Edit {source}", { source: initial.label || initial.id }) : gt("New source")
      }
      description={
        error ?? gt("Leave the folder empty to clone the remote into Blackbird's data folder.")
      }
    >
      <div className="grid max-w-2xl gap-2 pb-3.5 sm:grid-cols-2">
        <Input
          aria-label={gt("Label")}
          placeholder={gt("Label, for example Team")}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Input
          aria-label={gt("Folder")}
          placeholder={gt("Folder, for example {path}", { path: "~/repositories/agent-config" })}
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <Input
          aria-label={gt("Git remote")}
          placeholder={gt("Git remote (optional)")}
          value={remote}
          onChange={(event) => setRemote(event.target.value)}
        />
        <Select
          value={sync}
          onValueChange={(next) => {
            if (next) setSync(next);
          }}
        >
          <SelectTrigger size="sm" aria-label={gt("Git sync")}>
            <SelectValue>{messages(SYNC_LABELS[sync])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {(Object.keys(SYNC_LABELS) as SkillSourceSyncMode[]).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {messages(SYNC_LABELS[mode])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={instructions}
          onValueChange={(next) => {
            if (next) setInstructions(next);
          }}
        >
          <SelectTrigger size="sm" aria-label={gt("Instructions")}>
            <SelectValue>{messages(INSTRUCTIONS_LABELS[instructions])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {(Object.keys(INSTRUCTIONS_LABELS) as SkillSourceInstructionsMode[]).map((mode) => (
              <SelectItem
                key={mode}
                value={mode}
                disabled={mode === "link" && otherLinkSource !== undefined}
              >
                {messages(INSTRUCTIONS_LABELS[mode])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <div className="flex gap-1.5">
          <Button size="sm" disabled={error !== null} onClick={save}>
            <T>Save</T>
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            <T>Cancel</T>
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}
