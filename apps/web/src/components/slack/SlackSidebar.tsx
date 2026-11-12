import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type ContextMenuItem,
  type SlackConversation,
  SlackInboxMode,
  type SlackSidebarEdit,
  type SlackSidebarSection,
} from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BellOffIcon, ChevronRightIcon, ClockIcon, InboxIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useRef, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useSlackSpaceStore } from "../../slackSpaceStore";
import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Badge } from "../ui/badge";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { SlackSnapshotProvider } from "./SlackDirectoryProvider";
import { useSlackDirectory } from "./slackDirectory";
import { isSlackChannel, isSlackChannelMuted, SLACK_INBOX_MODE_LABELS } from "./slackInbox.logic";
import { SlackConversationIcon } from "./SlackPanes";
import type { SlackSearch } from "./slackSearch";
import { validateSlackSearch } from "./slackSearch";

function SidebarCount({ count }: { readonly count: number }) {
  return count > 0 ? (
    <Badge size="sm" variant="secondary">
      {count}
    </Badge>
  ) : null;
}

type SectionNaming =
  | { readonly type: "rename"; readonly sectionId: string }
  | { readonly type: "create"; readonly conversationId: string };

interface SidebarLayoutControls {
  readonly editable: boolean;
  readonly sections: ReadonlyArray<SlackSidebarSection>;
  readonly naming: SectionNaming | null;
  readonly onEdit: (edit: SlackSidebarEdit) => Promise<string | null>;
  readonly onName: (naming: SectionNaming | null) => void;
}

function ConversationRow({
  conversation,
  section,
  layout,
  active,
  onOpen,
}: {
  readonly conversation: SlackConversation;
  readonly section: SlackSidebarSection | undefined;
  readonly layout: SidebarLayoutControls;
  readonly active: boolean;
  readonly onOpen: (search: SlackSearch) => void;
}) {
  const { environmentId } = useSlackDirectory();
  const setInboxMode = useAtomCommand(slackEnvironment.setInboxMode);
  const unread = conversation.unreadItemCount > 0;
  const muted = isSlackChannelMuted(conversation);
  const conversationId = conversation.id;

  const openMenu = (event: MouseEvent) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const modes = isSlackChannel(conversation) ? SlackInboxMode.literals : [];
    if (!layout.editable && modes.length === 0) return;
    const actions = new Map<string, () => void>();
    const item = (label: string, run: () => void, options: Partial<ContextMenuItem> = {}) => {
      const id = String(actions.size);
      actions.set(id, run);
      return { id, label, ...options };
    };
    const modeItems = modes.map((mode) =>
      item(
        SLACK_INBOX_MODE_LABELS[mode],
        () => void setInboxMode({ environmentId, input: { conversationId, mode } }),
        { checked: mode === conversation.inboxMode },
      ),
    );
    const layoutItems: ContextMenuItem[] = layout.editable
      ? [
          {
            id: "move",
            label: "Move to section",
            separatorBefore: modes.length > 0,
            children: [
              ...layout.sections.map((target) =>
                item(
                  target.name,
                  () =>
                    void layout.onEdit({
                      type: "moveConversation",
                      conversationId,
                      sectionId: target.id,
                    }),
                  { checked: target.id === section?.id },
                ),
              ),
              item("New section…", () => layout.onName({ type: "create", conversationId }), {
                separatorBefore: layout.sections.length > 0,
              }),
            ],
          },
          ...(section === undefined
            ? []
            : [
                item(
                  "Remove from section",
                  () =>
                    void layout.onEdit({
                      type: "moveConversation",
                      conversationId,
                      sectionId: null,
                    }),
                ),
              ]),
          item(
            "Hide from sidebar",
            () => void layout.onEdit({ type: "hideConversation", conversationId }),
          ),
        ]
      : [];
    void api.contextMenu
      .show([...modeItems, ...layoutItems], { x: event.clientX, y: event.clientY })
      .then((id) => (id === null ? undefined : actions.get(id)?.()));
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        size="sm"
        onClick={() => onOpen({ c: conversation.id })}
        onContextMenu={openMenu}
      >
        <SlackConversationIcon
          conversation={conversation}
          className={cn("size-3.5 shrink-0", muted && !unread && "opacity-50")}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            unread && "font-semibold text-sidebar-foreground",
            muted && !unread && "opacity-50",
          )}
        >
          {conversation.name}
        </span>
        {muted ? <BellOffIcon aria-label="Muted" className="size-3 shrink-0 opacity-50" /> : null}
        <SidebarCount count={conversation.unreadItemCount} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const SECTION_HEADER_CLASS =
  "mx-[var(--sidebar-row-content-inset)] mb-1 flex flex-col items-start text-xs font-medium text-sidebar-muted-foreground/60";

function SectionNameInput({
  name,
  onCommit,
  onClose,
}: {
  readonly name: string;
  readonly onCommit: (name: string) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const close = () => {
    busyRef.current = true;
    onClose();
  };
  const commit = async () => {
    if (busyRef.current) return;
    const next = value.trim();
    if (next.length === 0 || next === name) return close();
    busyRef.current = true;
    const problem = await onCommit(next);
    if (problem === null) return onClose();
    busyRef.current = false;
    setError(problem);
  };
  return (
    <>
      <input
        autoFocus
        value={value}
        dir="auto"
        aria-label="Section name"
        aria-invalid={error !== null}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") void commit();
          else if (event.key === "Escape") close();
        }}
        onBlur={() => (error === null ? void commit() : close())}
        className="w-full min-w-0 rounded-sm border border-input bg-card px-1 text-xs font-medium text-card-foreground outline-none focus:border-foreground"
      />
      {error === null ? null : (
        <p role="alert" className="mt-1 font-normal text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function ConversationGroup({
  id,
  title,
  conversations,
  section,
  layout,
  activeConversationId,
  onOpen,
}: {
  readonly id: string;
  readonly title: string;
  readonly conversations: ReadonlyArray<SlackConversation>;
  readonly section?: SlackSidebarSection;
  readonly layout: SidebarLayoutControls;
  readonly activeConversationId: string | undefined;
  readonly onOpen: (search: SlackSearch) => void;
}) {
  const collapsed = useSlackSpaceStore((state) => state.collapsedSidebarGroups.includes(id));
  const toggle = useSlackSpaceStore((state) => state.toggleSidebarGroup);
  if (section === undefined && conversations.length === 0) return null;
  const shown = collapsed
    ? conversations.filter((conversation) => conversation.unreadItemCount > 0)
    : conversations;

  const openSectionMenu = (event: MouseEvent) => {
    const api = readLocalApi();
    if (!api || section === undefined || !layout.editable) return;
    event.preventDefault();
    const index = layout.sections.findIndex((candidate) => candidate.id === section.id);
    void api.contextMenu
      .show(
        [
          { id: "rename", label: "Rename…" },
          { id: "up", label: "Move up", disabled: index === 0 },
          { id: "down", label: "Move down", disabled: index === layout.sections.length - 1 },
          { id: "delete", label: "Delete section", destructive: true, separatorBefore: true },
        ] as const,
        { x: event.clientX, y: event.clientY },
      )
      .then((action) => {
        if (action === "rename") layout.onName({ type: "rename", sectionId: section.id });
        else if (action === "delete") {
          void layout.onEdit({ type: "deleteSection", sectionId: section.id });
        } else if (action !== null) {
          void layout.onEdit({ type: "moveSection", sectionId: section.id, direction: action });
        }
      });
  };

  return (
    <SidebarGroup>
      <h3 className={SECTION_HEADER_CLASS}>
        {section !== undefined &&
        layout.naming?.type === "rename" &&
        layout.naming.sectionId === section.id ? (
          <SectionNameInput
            name={section.name}
            onCommit={(name) =>
              layout.onEdit({ type: "renameSection", sectionId: section.id, name })
            }
            onClose={() => layout.onName(null)}
          />
        ) : (
          <button
            type="button"
            aria-expanded={!collapsed}
            className="group/section flex min-w-0 cursor-pointer items-center gap-1 hover:text-sidebar-foreground"
            onClick={() => toggle(id)}
            onContextMenu={openSectionMenu}
          >
            <span className="truncate">{title}</span>
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3 shrink-0",
                !collapsed && "rotate-90 opacity-0 group-hover/section:opacity-100",
              )}
            />
          </button>
        )}
      </h3>
      <SidebarMenu>
        {shown.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            section={section}
            layout={layout}
            active={conversation.id === activeConversationId}
            onOpen={onOpen}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function ViewRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} size="sm" onClick={onClick}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <SidebarCount count={count} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SlackSidebar() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environmentId, snapshot } = useSlackSnapshot();
  const setFocusMode = useAtomCommand(slackEnvironment.setFocusMode);
  const editSidebar = useAtomCommand(slackEnvironment.editSidebar, { reportFailure: false });
  const [naming, setNaming] = useState<SectionNaming | null>(null);
  const location = useLocation({
    select: ({ pathname, search }) =>
      pathname === "/slack" ? validateSlackSearch(search as Record<string, unknown>) : null,
    structuralSharing: true,
  });

  const open = (search: SlackSearch) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/slack", search });
  };

  if (environmentId === null || snapshot === null) {
    return (
      <>
        <SidebarChromeHeader isElectron={isElectron} />
        <SidebarContent />
        <SidebarChromeFooter />
      </>
    );
  }

  const { sidebar } = snapshot;
  const conversationsById = new Map(
    snapshot.conversations.map((conversation) => [conversation.id, conversation]),
  );
  const conversationsOf = (conversationIds: ReadonlyArray<string>) =>
    conversationIds.flatMap((id) => conversationsById.get(id) ?? []);
  const layout: SidebarLayoutControls = {
    editable: !sidebar.followsSlack,
    sections: sidebar.sections,
    naming,
    onEdit: async (input) => {
      const result = await editSidebar({ environmentId, input });
      if (result._tag === "Success") return null;
      const failure = squashAtomCommandFailure(result);
      return failure instanceof Error ? failure.message : "The sidebar could not be changed.";
    },
    onName: setNaming,
  };
  const unreadCount = snapshot.items.filter((item) => item.state === "unread").length;
  const snoozedCount = snapshot.items.filter((item) => item.state === "snoozed").length;
  const inboxActive = location !== null && location.c === undefined;

  return (
    <SlackSnapshotProvider environmentId={environmentId} snapshot={snapshot}>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        fixedHeader={
          <SidebarGroup>
            <SidebarMenu>
              <ViewRow
                icon={<InboxIcon />}
                label="Activity"
                count={unreadCount}
                active={inboxActive && location.view !== "snoozed"}
                onClick={() => open({})}
              />
              <ViewRow
                icon={<ClockIcon />}
                label="Snoozed"
                count={snoozedCount}
                active={inboxActive && location.view === "snoozed"}
                onClick={() => open({ view: "snoozed" })}
              />
            </SidebarMenu>
          </SidebarGroup>
        }
      >
        {sidebar.sections.map((section) => (
          <ConversationGroup
            key={section.id}
            id={section.id}
            title={section.name}
            conversations={conversationsOf(section.conversationIds)}
            section={section}
            layout={layout}
            activeConversationId={location?.c}
            onOpen={open}
          />
        ))}
        {naming?.type === "create" ? (
          <SidebarGroup>
            <h3 className={SECTION_HEADER_CLASS}>
              <SectionNameInput
                key={naming.conversationId}
                name=""
                onCommit={(name) =>
                  layout.onEdit({
                    type: "createSection",
                    name,
                    conversationId: naming.conversationId,
                  })
                }
                onClose={() => setNaming(null)}
              />
            </h3>
          </SidebarGroup>
        ) : null}
        {(
          [
            ["starred", "Starred"],
            ["channels", "Channels"],
            ["directMessages", "Direct messages"],
          ] as const
        ).map(([group, title]) => (
          <ConversationGroup
            key={group}
            id={group}
            title={title}
            conversations={conversationsOf(sidebar[group])}
            layout={layout}
            activeConversationId={location?.c}
            onOpen={open}
          />
        ))}
      </SidebarContent>
      <div className="shrink-0 border-t border-sidebar-border">
        <label className="mx-[calc(var(--sidebar-content-inset)+var(--sidebar-row-content-inset))] flex h-8 cursor-pointer items-center justify-between gap-2 text-xs font-medium text-sidebar-muted-foreground/80">
          Focus mode
          <Switch
            checked={snapshot.focusMode}
            size="sm"
            onCheckedChange={(on) => void setFocusMode({ environmentId, input: { on } })}
          />
        </label>
      </div>
      <SidebarChromeFooter />
    </SlackSnapshotProvider>
  );
}
