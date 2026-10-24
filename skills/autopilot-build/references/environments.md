# Environments

The autopilot uses Blackbird's tools when they exist. On a host without them, such as a headless agent gateway, use the fallback.

| Capability                            | In Blackbird                                     | Without Blackbird                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interview form, proposal, proof pages | `html_render`                                    | Numbered questions with recommendations; text with one small diagram; proof as links or attachments in the pull request                                                |
| Move into a worktree                  | `t3_worktree_handoff`                            | The host's own workspace switch command, or `git worktree add` and continue from that path                                                                             |
| Subagents on another model            | `delegate_task` with `orchestrator_capabilities` | The other model's CLI in read-only mode, for example `codex exec -s read-only` or `claude -p`                                                                          |
| Wake on pull request events           | `watch_pull_request`                             | Check in the same turn every couple of minutes with `gh pr checks` and `gh pr view`, for at most 30 minutes. If the bots still aren't done, report the state and stop. |
| Pull request guide                    | `write_pull_request_guides`                      | Skip it; the description has to carry the tour                                                                                                                         |
| Later regression checks               | `schedule_task`                                  | The host's own scheduled jobs, if it has them; otherwise list the checks in the report for the user                                                                    |
| Hand the thread back                  | `unwatch_pull_request`                           | End with the report                                                                                                                                                    |

Authorization rules from the host's instructions always win. A host that only investigates by default keeps doing that until someone explicitly asks it to fix something.
