import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

interface RenameEnvironmentDialogProps {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function RenameEnvironmentDialog({
  environmentId,
  label,
  open,
  onClose,
}: RenameEnvironmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {open ? (
        <RenameEnvironmentForm environmentId={environmentId} label={label} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function RenameEnvironmentForm({
  environmentId,
  label,
  onClose,
}: Omit<RenameEnvironmentDialogProps, "open">) {
  const gt = useGT();
  const messages = useMessages();
  const rename = useAtomCommand(environmentCatalog.rename, { reportFailure: false });
  const [draft, setDraft] = useState(label);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nextLabel = draft.trim();
  const canSave = !busy && nextLabel !== "" && nextLabel !== label;

  const save = async () => {
    setBusy(true);
    setProblem(null);
    const result = await rename({ environmentId, label: nextLabel });
    setBusy(false);
    if (result._tag === "Success") {
      onClose();
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setProblem(
        error instanceof Error
          ? (errorDisplayMessage(error, messages) ?? error.message)
          : gt("Could not rename the environment."),
      );
    }
  };

  return (
    <DialogPopup className="max-w-md">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            <T>Rename environment</T>
          </DialogTitle>
          <DialogDescription>
            <T>This name is only used on this device.</T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-1.5 text-sm">
            <span>
              <T>Name</T>
            </span>
            <Input
              autoFocus
              required
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          {problem === null ? null : (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {problem}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button type="submit" disabled={!canSave}>
            {busy ? <Spinner size="xs" /> : null} <T>Save</T>
          </Button>
        </DialogFooter>
      </form>
    </DialogPopup>
  );
}
