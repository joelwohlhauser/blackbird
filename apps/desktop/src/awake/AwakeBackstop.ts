export const SUDOERS_PATH = "/etc/sudoers.d/blackbird-awake";
export const PMSET = "/usr/bin/pmset";
export const JOURNAL_STALE_SECONDS = 45;

const PMSET_COMMANDS = [
  `${PMSET} -a disablesleep 1`,
  `${PMSET} -a disablesleep 0`,
  `${PMSET} -a lowpowermode 1`,
  `${PMSET} -a lowpowermode 0`,
];

export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const xmlEscape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const sudoersRule = (user: string) =>
  `${user} ALL=(root) NOPASSWD: ${PMSET_COMMANDS.join(", ")}\n`;

export const backstopScript = (journalPath: string, sudo = "/usr/bin/sudo") => `#!/bin/sh
journal=${shellQuote(journalPath)}
[ -f "$journal" ] || exit 0
age=$(( $(/bin/date +%s) - $(/usr/bin/stat -f %m "$journal") ))
[ "$age" -lt ${JOURNAL_STALE_SECONDS} ] && exit 0
if /usr/bin/grep -q '"sleepDisabled":true' "$journal"; then
  ${sudo} -n ${PMSET} -a disablesleep 0 || exit 1
fi
if /usr/bin/grep -q '"lowPower":true' "$journal"; then
  ${sudo} -n ${PMSET} -a lowpowermode 0 || exit 1
fi
/bin/rm -f "$journal"
`;

export const backstopPlist = (
  label: string,
  scriptPath: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${xmlEscape(scriptPath)}</string>
  </array>
  <key>StartInterval</key>
  <integer>15</integer>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
