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
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const SYNC_LABELS: Record<SkillSourceSyncMode, string> = {
  none: "No git sync",
  pull: "Pull only",
  "two-way": "Two-way sync",
};

const INSTRUCTIONS_LABELS: Record<SkillSourceInstructionsMode, string> = {
  none: "No instructions",
  inject: "Add AGENTS.md to every session",
  link: "Use AGENTS.md as global instructions",
};

export function SkillsSettingsPanel() {
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment) {
    return (
      <SettingsPageContainer>
        <SettingsScopeNotice target="environment">
          Choose one environment to manage its skills.
        </SettingsScopeNotice>
      </SettingsPageContainer>
    );
  }
  if (environment.serverConfig?.environment.capabilities.skillSync !== true) {
    return (
      <SettingsPageContainer>
        <SettingsScopeNotice target="environment">
          Update this environment to manage its skills.
        </SettingsScopeNotice>
      </SettingsPageContainer>
    );
  }
  return (
    <SkillsSettingsForm key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function SkillsSettingsForm({ environmentId }: { readonly environmentId: EnvironmentId }) {
  useRelativeTimeTick(60_000);
  const sources = useScopedSettings((settings) => settings.skillSources);
  const disabledSkills = useScopedSettings((settings) => settings.disabledSkills);
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
        title: "Could not sync skills",
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };

  const skillRows = [
    ...builtIns,
    ...sources.flatMap((source) => statusById.get(source.id) ?? []),
  ].flatMap((source) => source.skills.map((name) => ({ source, name })));

  return (
    <SettingsPageContainer>
      {status !== null && status.conflicts.length > 0 && (
        <SettingsSection id="skills-conflicts" title="Conflicts">
          {status.conflicts.map((conflict) => (
            <SettingsRow key={conflict} title={conflict} />
          ))}
        </SettingsSection>
      )}
      <SettingsSection
        {...searchableSetting("skills-sources")}
        title="Sources"
        headerAction={
          <Button
            variant="outline"
            size="sm"
            disabled={syncing || !canSync}
            onClick={() => void runSync()}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        }
      >
        {builtIns.map((source) => (
          <SettingsRow key={source.id} title={source.label} description={describe(source)} />
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
              description={describe(statusById.get(source.id), source)}
              control={
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setEditing(source.id)}>
                    Edit
                  </Button>
                  <Button
                    variant="destructive-outline"
                    size="sm"
                    onClick={() => saveSources(sources.filter((entry) => entry.id !== source.id))}
                  >
                    Remove
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
            title="Add a source"
            description="A folder or git checkout with skills/<name>/SKILL.md and an optional AGENTS.md."
            control={
              <Button variant="outline" size="sm" onClick={() => setEditing("")}>
                Add source
              </Button>
            }
          />
        )}
      </SettingsSection>
      <SettingsSection {...searchableSetting("skills-list")} title="Skills">
        {skillRows.length === 0 ? (
          <SettingsRow title="No skills found yet" />
        ) : (
          skillRows.map(({ source, name }) => (
            <SettingsRow
              key={`${source.id}:${name}`}
              title={name}
              description={source.label}
              control={
                <Switch
                  aria-label={`Use ${name}`}
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

function describe(status: SkillSourceStatus | undefined, config?: SkillSourceConfig) {
  const details = [
    status?.path ?? (config?.path || null),
    config ? SYNC_LABELS[config.sync] : null,
    config && config.instructions !== "none" ? INSTRUCTIONS_LABELS[config.instructions] : null,
    status === undefined
      ? "Not synced yet"
      : !status.available
        ? "Not found on this environment"
        : status.lastSyncedAt
          ? `Synced ${formatRelativeTimeLabel(status.lastSyncedAt)}`
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
      ? "Enter a folder, a git remote, or both."
      : instructions === "link" && otherLinkSource
        ? `${otherLinkSource.label || otherLinkSource.id} already provides the global instructions.`
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
      title={initial ? `Edit ${initial.label || initial.id}` : "New source"}
      description={
        error ?? "Leave the folder empty to clone the remote into Blackbird's data folder."
      }
    >
      <div className="grid max-w-2xl gap-2 pb-3.5 sm:grid-cols-2">
        <Input
          aria-label="Label"
          placeholder="Label, for example Team"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Input
          aria-label="Folder"
          placeholder="Folder, for example ~/repositories/agent-config"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <Input
          aria-label="Git remote"
          placeholder="Git remote (optional)"
          value={remote}
          onChange={(event) => setRemote(event.target.value)}
        />
        <Select
          value={sync}
          onValueChange={(next) => {
            if (next) setSync(next);
          }}
        >
          <SelectTrigger size="sm" aria-label="Git sync">
            <SelectValue>{SYNC_LABELS[sync]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {(Object.keys(SYNC_LABELS) as SkillSourceSyncMode[]).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {SYNC_LABELS[mode]}
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
          <SelectTrigger size="sm" aria-label="Instructions">
            <SelectValue>{INSTRUCTIONS_LABELS[instructions]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {(Object.keys(INSTRUCTIONS_LABELS) as SkillSourceInstructionsMode[]).map((mode) => (
              <SelectItem
                key={mode}
                value={mode}
                disabled={mode === "link" && otherLinkSource !== undefined}
              >
                {INSTRUCTIONS_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <div className="flex gap-1.5">
          <Button size="sm" disabled={error !== null} onClick={save}>
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}
