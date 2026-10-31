import type { ConversationImportProgress } from "@t3tools/contracts";

export type StartupProgress =
  | ConversationImportProgress
  | { readonly stage: "connecting" | "opening" | "failed" };

function progressView(progress: StartupProgress) {
  const base = {
    title: "Importing your conversations",
    step: "Step 1 of 4",
    status: "Preparing your T3 Code history",
    detail: "Large histories can take several minutes.",
    value: null,
    note: "Keep Blackbird open. Your T3 Code data stays unchanged.",
  };
  switch (progress.stage) {
    case "preparing":
      return base;
    case "snapshot": {
      const value = progress.totalPages === 0 ? 0 : progress.completedPages / progress.totalPages;
      return {
        ...base,
        status: "Taking a copy of your history",
        detail: `${Math.round(value * 100)}% of the database copied`,
        value,
      };
    }
    case "conversations":
      return {
        ...base,
        step: "Step 2 of 4",
        status: "Copying conversations and attachments",
        detail: `${progress.completedConversations.toLocaleString()} of ${progress.totalConversations.toLocaleString()} conversations · ${progress.importedMessageCount.toLocaleString()} messages copied`,
        value:
          progress.totalConversations === 0
            ? 1
            : progress.completedConversations / progress.totalConversations,
      };
    case "saving":
      return {
        ...base,
        step: "Step 3 of 4",
        status: "Saving your imported history",
        detail: "Your conversations are copied. Finishing up…",
      };
    case "complete":
      return {
        ...base,
        title: "Your conversations are imported",
        step: "Step 4 of 4",
        status: "Opening Blackbird…",
        detail: `${progress.importedThreadCount.toLocaleString()} conversations · ${progress.importedMessageCount.toLocaleString()} messages imported`,
      };
    case "opening":
      return {
        ...base,
        title: "Opening Blackbird",
        step: "",
        status: "Starting your workspace…",
        detail: "",
      };
    case "failed":
      return {
        ...base,
        title: "Import paused",
        step: "",
        status: "The import could not finish",
        detail: "Choose Retry or Start fresh in the dialog to continue.",
      };
    case "connecting":
      return {
        ...base,
        title: "Opening Blackbird",
        step: "",
        status: "Connecting to WSL…",
        detail: "",
        note: "",
      };
  }
}

export function buildStartupProgressDataUrl(progress: StartupProgress, dark: boolean): string {
  const view = progressView(progress);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Blackbird</title><style>
:root{color-scheme:${dark ? "dark" : "light"};--bg:${dark ? "#151515" : "#fafafa"};--fg:${dark ? "#f1f1f1" : "#191919"};--muted:${dark ? "#aaa" : "#666"};--track:${dark ? "#333" : "#dedede"}}
*{box-sizing:border-box}body{margin:0;padding:32px;background:var(--bg);color:var(--fg);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:drag;user-select:none}
.brand{font-size:12px;font-weight:600;color:var(--muted);margin-bottom:28px}h1{font-size:22px;font-weight:600;letter-spacing:-.5px;margin:0 0 24px}.step{font-size:11px;color:var(--muted);min-height:16px;margin-bottom:6px}.status{font-weight:500;margin-bottom:12px;display:flex;align-items:center;gap:8px}.spinner{width:12px;height:12px;border:1.5px solid var(--track);border-top-color:var(--fg);border-radius:50%;animation:spin .8s linear infinite;flex:none}@keyframes spin{to{transform:rotate(360deg)}}.detail{font-size:12px;color:var(--muted);min-height:32px;line-height:1.6;margin-top:10px}.note{font-size:11px;color:var(--muted);line-height:1.6;margin:20px 0 0}progress{display:block;appearance:none;width:100%;height:4px;border:0;background:var(--track);border-radius:4px;overflow:hidden}progress::-webkit-progress-bar{background:var(--track)}progress::-webkit-progress-value{background:var(--fg);border-radius:4px}progress:indeterminate{background:linear-gradient(90deg,var(--track) 0%,var(--fg) 50%,var(--track) 100%);background-size:200% 100%;animation:working 1.8s linear infinite}progress:indeterminate::-webkit-progress-bar{background:transparent}@keyframes working{to{background-position:-200% 0}}@media(prefers-reduced-motion:reduce){progress:indeterminate,.spinner{animation:none}}
</style></head><body><div class="brand">Blackbird</div><h1 id="title">${view.title}</h1>
<section role="status" aria-live="polite"><div class="step" id="step">${view.step}</div><div class="status"><span class="spinner" aria-hidden="true"></span><span id="status">${view.status}</span></div><progress id="progress" aria-label="${view.status}" max="1"${view.value === null ? "" : ` value="${view.value}"`}></progress><div class="detail" id="detail">${view.detail}</div></section><p class="note" id="note">${view.note}</p></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function startupProgressUpdateScript(progress: StartupProgress): string {
  return `(() => {
    const view = ${JSON.stringify(progressView(progress))};
    for (const id of ["title", "step", "status", "detail", "note"]) document.getElementById(id).textContent = view[id];
    const bar = document.getElementById("progress");
    bar.setAttribute("aria-label", view.status);
    if (view.value === null) bar.removeAttribute("value"); else bar.value = view.value;
  })()`;
}
