import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  createAssistantTextSelector,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import { readHtmlRenderTextSelection } from "@t3tools/shared/htmlRender";
import { useGT } from "gt-react";
import { QuoteIcon } from "lucide-react";
import { use, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";
import { Popover, PopoverPopup } from "../ui/popover";
import { AssistantCitationCommentEditor } from "./AssistantCitationCommentEditor";
import { resolveAssistantCitationCommentDismissal } from "./assistantCitationCommentDismissal";
import { observeAssistantCitationCommentSource } from "./AssistantCitationSource";
import { BackgroundThreadContext } from "./backgroundThread";

type SelectionAnchor =
  | {
      kind: "text";
      sourceAnchor: AssistantCitationSourceAnchor;
      position: SelectionActionPoint;
    }
  | {
      kind: "frame";
      frame: HTMLIFrameElement;
      rect: { x: number; y: number; width: number; height: number };
    };

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, options?: { readonly send?: boolean }) => boolean;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    anchor: SelectionAnchor;
    commenting: boolean;
  } | null>(null);
  const toolbarRef = useRef<HTMLButtonElement>(null);
  const commentPopupRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const draftCommentRef = useRef<string | null>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const backgroundThread = use(BackgroundThreadContext);
  const gt = useGT();

  const closeComment = () => {
    draftCommentRef.current = null;
    setSelection(null);
  };
  const citeWithComment = (comment: string, send = false) => {
    if (
      !selection ||
      !onCite(withAssistantCitationComment(selection.citation, comment), { send })
    ) {
      return false;
    }
    closeComment();
    return true;
  };
  const settleComment = (reason: string) => {
    const dismissal = resolveAssistantCitationCommentDismissal({
      reason,
      draft: draftCommentRef.current,
      savedComment: undefined,
    });
    if (dismissal.kind === "keep-open") return false;
    if (dismissal.kind === "commit") return citeWithComment(dismissal.comment);
    closeComment();
    return true;
  };
  const onSourceUnavailable = useEffectEvent(() => {
    settleComment("none");
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches the cited DOM text for removal while the comment is open
  useEffect(() => {
    if (!selection?.commenting) return;
    const { anchor } = selection;
    if (anchor.kind === "text") {
      return observeAssistantCitationCommentSource({
        anchor: anchor.sourceAnchor,
        citation: selection.citation,
        onUnavailable: onSourceUnavailable,
      });
    }
    if (!viewport) return;
    const observer = new MutationObserver(() => {
      if (!anchor.frame.isConnected) onSourceUnavailable();
    });
    observer.observe(viewport, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selection, viewport]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the toolbar DOM node and clamps its position inside the window before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection || selection.commenting || selection.anchor.kind !== "text") return;
    const { position } = selection.anchor;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange and keydown to track text selections in the viewport
  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection((current) => (current?.commenting ? current : null));
    const update = (pointer: SelectionActionPoint | null) => {
      if (draftCommentRef.current?.trim()) return;
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      // A selection can cross blocks with different clipping ancestors.
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
        for (
          let element = node.parentElement;
          element && element !== viewport;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const bounds = element.getBoundingClientRect();
          const left = bounds.left + element.clientLeft;
          const top = bounds.top + element.clientTop;
          clips.push({
            left: clipX ? left : -Infinity,
            right: clipX ? left + element.clientWidth : Infinity,
            top: clipY ? top : -Infinity,
            bottom: clipY ? top + element.clientHeight : Infinity,
          });
        }
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      const sourceAnchor = { source: captured.source, range: captured.range, viewport };
      const citation: AssistantCitation = {
        version: 1,
        ...threadRef,
        messageId: MessageId.make(messageId),
        ...captured.selector,
      };
      const commentRightAway =
        pointer !== null && citation.text.length <= ASSISTANT_CITATION_MAX_TEXT_LENGTH;
      if (commentRightAway) {
        actions.cancel();
        window.getSelection()?.removeAllRanges();
      }
      draftCommentRef.current = null;
      setSelection({
        citation,
        commenting: commentRightAway,
        anchor: {
          kind: "text",
          sourceAnchor,
          position: resolveSelectionActionPosition({
            bounds: viewportRect,
            selectionRect: rects.item(rects.length - 1) ?? rect,
            pointer: pointerOnText ? pointer : null,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          }),
        },
      });
    };
    const commentOnFrameSelection = (event: MessageEvent) => {
      const selected = readHtmlRenderTextSelection(event.data);
      if (!selected || draftCommentRef.current?.trim()) return;
      const frame = [...viewport.querySelectorAll("iframe")].find(
        (candidate) => candidate.contentWindow === event.source,
      );
      const messageId = frame?.closest<HTMLElement>("[data-assistant-citation-source]")?.dataset
        .assistantCitationSource;
      if (
        !frame ||
        !messageId ||
        document.activeElement !== frame ||
        navigator.userActivation?.isActive === false
      ) {
        return;
      }
      const text = selected.text.trim();
      const before = selected.before + selected.text.slice(0, selected.text.indexOf(text));
      const selector = createAssistantTextSelector(
        `${before}${selected.text}${selected.after}`,
        before.length,
        before.length + text.length,
      );
      if (!selector || selector.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) return;
      draftCommentRef.current = null;
      setSelection({
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...selector,
        },
        commenting: true,
        anchor: { kind: "frame", frame, rect: selected.rect },
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => commentPopupRef.current ?? toolbarRef.current,
      restoreAfterScroll: true,
      immediateMultiClick: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      if (toolbar.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      toolbar.focus({ preventScroll: true });
    };
    // Tab belongs to the foreground chat; a background timeline only follows its selection.
    if (!backgroundThread) document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    window.addEventListener("message", commentOnFrameSelection);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      window.removeEventListener("message", commentOnFrameSelection);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [backgroundThread, threadRef, viewport]);

  if (!selection) return null;
  if (selection.commenting || selection.anchor.kind === "frame") {
    const { anchor } = selection;
    const { messageId, start, end } = selection.citation;
    return (
      <Popover
        key={`${messageId}:${start}:${end}`}
        open
        onOpenChange={(open, eventDetails) => {
          if (!open && !settleComment(eventDetails.reason)) eventDetails.cancel();
        }}
      >
        <PopoverPopup
          side="bottom"
          align="end"
          anchor={{
            contextElement: anchor.kind === "text" ? anchor.sourceAnchor.source : anchor.frame,
            getBoundingClientRect: () => {
              if (anchor.kind === "frame") {
                const frame = anchor.frame.getBoundingClientRect();
                const { x, y, width, height } = anchor.rect;
                return new DOMRect(frame.left + x, frame.top + y, width, height);
              }
              const { range, source } = anchor.sourceAnchor;
              const rects = range.getClientRects();
              const rect = rects.item(rects.length - 1) ?? range.getBoundingClientRect();
              // Code blocks and tables scroll sideways inside the message, so the cited
              // text can end in their hidden overflow. Base UI only shifts the popup while
              // it still touches the anchor, so clamp the anchor to the message's width.
              const bounds = source.getBoundingClientRect();
              const left = Math.min(Math.max(rect.left, bounds.left), bounds.right);
              const right = Math.max(Math.min(rect.right, bounds.right), left);
              return new DOMRect(left, rect.top, right - left, rect.height);
            },
          }}
          initialFocus={() => {
            commentInputRef.current?.focus({ preventScroll: true });
            return false;
          }}
          finalFocus={false}
          ref={commentPopupRef}
          aria-label={gt("Comment on citation")}
          width="md"
          padding="compact"
        >
          <AssistantCitationCommentEditor
            citation={selection.citation}
            inputRef={commentInputRef}
            onDraftChange={(comment) => {
              draftCommentRef.current = comment;
            }}
            onSubmit={(comment) => citeWithComment(comment)}
            onSubmitAndSend={(comment) => citeWithComment(comment, true)}
            onCancel={closeComment}
          />
        </PopoverPopup>
      </Popover>
    );
  }
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = () => {
    if (tooLong) return;
    actionsRef.current?.cancel();
    window.getSelection()?.removeAllRanges();
    draftCommentRef.current = null;
    setSelection({ ...selection, commenting: true });
  };
  return createPortal(
    <Button
      ref={toolbarRef}
      type="button"
      size="xs"
      variant="glass"
      disabled={tooLong}
      aria-label={tooLong ? gt("Selection is too long to cite") : gt("Cite selection in composer")}
      className="fixed z-50 max-w-[calc(100vw-1rem)]"
      style={{ left: selection.anchor.position.x, top: selection.anchor.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={cite}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <QuoteIcon aria-hidden="true" className="size-3.5" />
      {tooLong
        ? gt("Shorten selection")
        : gt("Cite", { $context: "verb, button that quotes the selected text" })}
    </Button>,
    document.body,
  );
}
