# Changes to stored data

Follow these rules when a change adds, renames, or reshapes stored data, or when records need a repair.

## Before writing the script

- List every collection or table the change touches and label each one:
  - **source:** the data of record.
  - **derived:** an index, cache, search copy, or projection rebuilt from the source.
  - **audit:** an event log or history that must stay as it was written.
  - **unknown:** stop and ask.
- Don't update derived data or audit logs just because they hold the same value. Rebuild derived data the way the system already does.
- Check the real data shapes read-only first: how many records have the old shape, the new shape, both, or neither.

## The script

- Dry run by default. Applying is an explicit flag.
- Safe to run twice: a second run changes nothing.
- Prints counts before and after, and for a dry run what it would change.
- Handles records that already have the new shape, and records with both shapes.
- Never fills a missing value with a placeholder or a guess. Leave it empty and report it.

## Running it

Running a script against production is a change to production. Do it only when the brief names it, or with the user's OK. Dry run first, then apply, then run the counts again to confirm. Ship runs it after the merge, so the code that reads the new shape is live first unless the brief says otherwise.
