import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ScopedThreadRef,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const SCRATCH_ROOT = "/home/user";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
  folder: "",
  pullRequests: [] as unknown[],
  configLoaded: true,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProject: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "project",
          environmentId: "environment",
          title: state.workspaceRoot === SCRATCH_ROOT ? "Quick chats" : "plain",
          workspaceRoot: state.workspaceRoot,
          scripts: [],
        }) as never,
  useProjects: (() => []) as never,
  useQuietThreadShell: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "thread",
          environmentId: "environment",
          projectId: "project",
          worktreePath: state.folder,
          branch: null,
          pullRequests: state.pullRequests,
        }) as never,
  useServerConfigs: (() =>
    new Map(
      state.configLoaded
        ? [
            [
              EnvironmentId.make("environment"),
              {
                scratchWorkspaceRoot: SCRATCH_ROOT,
                environment: { capabilities: { pullRequests: true } },
              },
            ],
          ]
        : [],
    )) as never,
}));
// Neither folder is a repository, which is what the server reports for both.
vi.mock(import("~/state/vcs"), async (importOriginal) => {
  const actual = await importOriginal();
  const notARepo = Atom.make(
    AsyncResult.success({
      isRepo: false,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      aheadOfDefaultCount: 0,
      pr: null,
    }),
  );
  return {
    ...actual,
    vcsEnvironment: { ...actual.vcsEnvironment, status: (() => notARepo) as never },
  };
});

import { render } from "../../../test/render";
import { ThreadDetailsPanel } from "./ThreadDetailsPanel";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const linkedPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "pingdotgg/t3code",
  number: 27513,
  url: "https://github.com/pingdotgg/t3code/pull/27513",
  source: "manual",
  linkedAt: "2026-10-30T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

function Panel() {
  const noop = () => {};
  const scriptResult = async () => ({ ok: true }) as never;
  return (
    <ThreadDetailsPanel
      environmentId={threadRef.environmentId}
      threadId={threadRef.threadId}
      projectId={ProjectId.make("project")}
      composerDraftTarget={threadRef}
      worktreePath={state.folder}
      isServerThread
      activeProjectScripts={undefined}
      preferredScriptId={null}
      keybindings={[]}
      availableEditors={[]}
      showOpenInPicker={false}
      openInShortcutEnabled={false}
      gitCwd={state.folder}
      isGitRepo={false}
      envLocked
      availableEnvironments={[]}
      onEnvModeChange={noop}
      envMode="local"
      startFromOrigin={false}
      onStartFromOriginChange={noop}
      newBranchName=""
      onNewBranchNameChange={noop}
      onComposerFocusRequest={noop}
      onRunProjectScript={noop}
      onAddProjectScript={scriptResult}
      onUpdateProjectScript={scriptResult}
      onDeleteProjectScript={scriptResult}
      usage={{} as never}
    />
  );
}

it.each([
  { name: "a Quick chat", workspaceRoot: SCRATCH_ROOT, folder: SCRATCH_ROOT },
  {
    name: "a folder that is not a git repository",
    workspaceRoot: "/work/plain",
    folder: "/work/plain",
  },
])("shows a linked pull request in $name", async ({ workspaceRoot, folder }) => {
  state.configLoaded = true;
  state.workspaceRoot = workspaceRoot;
  state.folder = folder;
  state.pullRequests = [linkedPullRequest];
  await using _screen = await render(<Panel />);
  await expect.element(page.getByText("#27513")).toBeVisible();
});
