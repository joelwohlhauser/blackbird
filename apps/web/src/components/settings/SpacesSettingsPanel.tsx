import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import type { SidebarSpace } from "@t3tools/contracts";
import { ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useGT } from "gt-react";
import { useState } from "react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { randomUUID } from "~/lib/utils";
import { groupSpaceId } from "~/sidebarSpaces";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function SpaceNameInput({
  space,
  onRename,
}: {
  readonly space: SidebarSpace;
  readonly onRename: (name: string) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(space.name);
  const commit = () => {
    const name = draft.trim();
    if (name.length === 0) setDraft(space.name);
    else if (name !== space.name) onRename(name);
  };
  return (
    <Input
      size="sm"
      aria-label={gt("Space name")}
      maxLength={24}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function SpacesSettingsPanel() {
  const gt = useGT();
  const spaces = useClientSettings((settings) => settings.sidebarSpaces);
  const projectSpaces = useClientSettings((settings) => settings.sidebarProjectSpaces);
  const projectGroups = pickableProjectGroups(useSidebarProjectGroups()).flatMap((group) => {
    const spaceId = groupSpaceId(group, spaces, projectSpaces);
    return spaceId === null ? [] : [{ group, spaceId }];
  });

  const addSpace = () =>
    void updateClientSettings({
      sidebarSpaces: [
        ...spaces,
        {
          id: randomUUID(),
          name:
            spaces.length === 0 ? gt("Work") : gt("Space {number}", { number: spaces.length + 1 }),
        },
      ],
    });
  const renameSpace = (id: string, name: string) =>
    void updateClientSettings({
      sidebarSpaces: spaces.map((space) => (space.id === id ? { ...space, name } : space)),
    });
  const moveSpaceUp = (index: number) => {
    const next = [...spaces];
    const [space] = next.splice(index, 1);
    if (!space) return;
    next.splice(index - 1, 0, space);
    void updateClientSettings({ sidebarSpaces: next });
  };
  const deleteSpace = (id: string) =>
    void updateClientSettings({
      sidebarSpaces: spaces.filter((space) => space.id !== id),
      sidebarProjectSpaces: Object.fromEntries(
        Object.entries(projectSpaces).filter(([, spaceId]) => spaceId !== id),
      ),
    });
  const assignProject = (projectKey: string, spaceId: string) =>
    void updateClientSettings({
      sidebarProjectSpaces: { ...projectSpaces, [projectKey]: spaceId },
    });

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="sidebar-spaces"
        title={gt("Spaces")}
        headerAction={
          <Button size="xs" variant="outline" onClick={addSpace}>
            <PlusIcon />
            {gt("Add space")}
          </Button>
        }
      >
        {spaces.length === 0 ? (
          <SettingsRow
            title={gt("No spaces yet")}
            description={gt(
              "Add two spaces to swipe between them in the sidebar. Projects without a space appear in the first one.",
            )}
          />
        ) : (
          spaces.map((space, index) => (
            <div key={space.id} className="flex items-center gap-1.5 px-4 py-2">
              <div className="min-w-0 flex-1">
                <SpaceNameInput space={space} onRename={(name) => renameSpace(space.id, name)} />
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={index === 0}
                aria-label={gt("Move {space} up", { space: space.name })}
                onClick={() => moveSpaceUp(index)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Delete {space}", { space: space.name })}
                onClick={() => deleteSpace(space.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))
        )}
      </SettingsSection>
      {spaces.length > 1 ? (
        <SettingsSection title={gt("Projects")}>
          {projectGroups.map(({ group, spaceId }) => {
            return (
              <SettingsRow
                key={group.projectKey}
                title={group.displayName}
                control={
                  <Select
                    value={spaceId}
                    onValueChange={(value) => {
                      if (value) assignProject(group.projectKey, value);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-40"
                      aria-label={gt("Space for {project}", { project: group.displayName })}
                    >
                      <SelectValue>
                        {spaces.find((space) => space.id === spaceId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {spaces.map((space) => (
                        <SelectItem hideIndicator key={space.id} value={space.id}>
                          {space.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
            );
          })}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
