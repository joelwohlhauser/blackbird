import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import type { ProjectIconOverride, SidebarSpace } from "@t3tools/contracts";
import { ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useGT } from "gt-react";
import { lazy, Suspense, useState } from "react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { randomUUID } from "~/lib/utils";
import { projectGroupsSpanEnvironments } from "~/sidebarProjectGrouping";
import { groupSpaceId } from "~/sidebarSpaces";

import { SidebarSpaceIcon } from "../sidebar/SidebarSpaceIcon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const ALL_SPACES = "all-spaces";

const ProjectIconPickerDialog = lazy(() =>
  import("./ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

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
  const sharedProjects = useClientSettings((settings) => settings.sidebarSharedProjects);
  const projectGroups = pickableProjectGroups(useSidebarProjectGroups());
  const showEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const [iconSpaceId, setIconSpaceId] = useState<string | null>(null);
  const iconSpace = spaces.find((space) => space.id === iconSpaceId);

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
  const setSpaceIcon = (id: string, icon: ProjectIconOverride | null) =>
    void updateClientSettings({
      sidebarSpaces: spaces.map((space) =>
        space.id !== id
          ? space
          : icon === null
            ? { id: space.id, name: space.name }
            : { ...space, icon },
      ),
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
  const assignProject = (projectKey: string, value: string) =>
    void updateClientSettings(
      value === ALL_SPACES
        ? { sidebarSharedProjects: [...new Set([...sharedProjects, projectKey])] }
        : {
            sidebarProjectSpaces: { ...projectSpaces, [projectKey]: value },
            sidebarSharedProjects: sharedProjects.filter((key) => key !== projectKey),
          },
    );

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
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={gt("Icon for {space}", { space: space.name })}
                onClick={() => setIconSpaceId(space.id)}
              >
                <SidebarSpaceIcon space={space} />
              </Button>
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
          {projectGroups.map((group) => {
            const spaceId = sharedProjects.includes(group.projectKey)
              ? ALL_SPACES
              : groupSpaceId(group, spaces, projectSpaces);
            return (
              <SettingsRow
                key={group.projectKey}
                title={group.displayName}
                description={
                  showEnvironments
                    ? [
                        ...new Set(
                          group.memberProjects.flatMap((member) => member.environmentLabel ?? []),
                        ),
                      ].join(", ")
                    : undefined
                }
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
                        {spaceId === ALL_SPACES
                          ? gt("All spaces")
                          : spaces.find((space) => space.id === spaceId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {spaces.map((space) => (
                        <SelectItem hideIndicator key={space.id} value={space.id}>
                          {space.name}
                        </SelectItem>
                      ))}
                      <SelectItem hideIndicator value={ALL_SPACES}>
                        {gt("All spaces")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
            );
          })}
        </SettingsSection>
      ) : null}
      {iconSpace ? (
        <Suspense fallback={null}>
          <ProjectIconPickerDialog
            subject="space"
            current={iconSpace.icon ?? null}
            projectName={iconSpace.name}
            open
            onOpenChange={(open) => {
              if (!open) setIconSpaceId(null);
            }}
            onSelect={(icon) => setSpaceIcon(iconSpace.id, icon)}
          />
        </Suspense>
      ) : null}
    </SettingsPageContainer>
  );
}
