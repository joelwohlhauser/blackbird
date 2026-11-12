import type { SlackMessage } from "@t3tools/contracts";
import { PaperclipIcon, SendIcon, XIcon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";

import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useSlackDirectory } from "./slackDirectory";
import { uploadSlackFile } from "./slackUpload";

export function SlackComposer({
  conversationId,
  threadTs,
  placeholder,
  textareaRef,
  onSent,
}: {
  readonly conversationId: string;
  readonly threadTs?: string | undefined;
  readonly placeholder: string;
  readonly textareaRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  readonly onSent: (message: SlackMessage) => void;
}) {
  const { environmentId } = useSlackDirectory();
  const postMessage = useAtomCommand(slackEnvironment.postMessage);
  const upload = useAtomCommand(slackEnvironment.upload);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<ReadonlyArray<File>>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (added: ReadonlyArray<File>) => {
    if (added.length > 0) setFiles((current) => [...current, ...added]);
  };

  const send = async () => {
    const body = text.trim();
    if (sending || (body.length === 0 && files.length === 0)) return;
    setSending(true);
    setError(null);
    const target = { conversationId, ...(threadTs === undefined ? {} : { threadTs }) };
    if (files.length === 0) {
      const result = await postMessage({ environmentId, input: { ...target, text: body } });
      setSending(false);
      if (result._tag !== "Success") {
        setError("The message could not be sent. Try again.");
        return;
      }
      setText("");
      onSent(result.value);
      return;
    }
    const uploads = await Promise.all(files.map((file) => uploadSlackFile(environmentId, file)));
    const [first, ...rest] = uploads.flatMap((entry) =>
      entry.status === "uploaded" ? [{ attachmentId: entry.attachmentId, name: entry.name }] : [],
    );
    if (first === undefined || rest.length + 1 !== uploads.length) {
      setSending(false);
      setError("A file could not be uploaded. Try again.");
      return;
    }
    const result = await upload({
      environmentId,
      input: {
        ...target,
        files: [first, ...rest],
        ...(body.length === 0 ? {} : { comment: body }),
      },
    });
    setSending(false);
    if (result._tag !== "Success") {
      setError("The files could not be sent. Try again.");
      return;
    }
    setText("");
    setFiles([]);
  };

  return (
    <div
      className="shrink-0 px-4 pt-1 pb-3"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        addFiles([...event.dataTransfer.files]);
      }}
    >
      {files.length === 0 ? null : (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              // oxlint-disable-next-line react/no-array-index-key -- picked files have no identity besides their position
              key={index}
              className="flex h-6 items-center gap-1 rounded-md border border-border/60 bg-muted/40 pr-0.5 pl-2 text-xs text-muted-foreground"
            >
              <span className="max-w-48 truncate">{file.name}</span>
              <Button
                aria-label={`Remove ${file.name}`}
                size="icon-micro"
                variant="ghost-muted"
                onClick={() => setFiles((current) => current.toSpliced(index, 1))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileInputRef}
          aria-label="Attach files"
          className="hidden"
          multiple
          type="file"
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <Button
          aria-label="Attach files"
          size="icon-sm"
          variant="ghost-muted"
          onClick={() => fileInputRef.current?.click()}
        >
          <PaperclipIcon />
        </Button>
        <Textarea
          ref={textareaRef}
          aria-label={placeholder}
          placeholder={placeholder}
          rows={1}
          size="sm"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            if (event.clipboardData.files.length === 0) return;
            event.preventDefault();
            addFiles([...event.clipboardData.files]);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          aria-label="Send message"
          disabled={sending || (text.trim().length === 0 && files.length === 0)}
          size="icon-sm"
          onClick={() => void send()}
        >
          <SendIcon />
        </Button>
      </div>
      {error === null ? null : <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
