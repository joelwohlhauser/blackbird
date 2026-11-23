import type { EnvironmentId, McpGatewayServiceStatus } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useEffect, useEffectEvent, useState } from "react";

import { isLoopbackHostname } from "../../environments/primary/target";
import { isElectron } from "../../env";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const SIGN_IN_POLL_MS = 2_000;
const SIGN_IN_WAIT_MS = 5 * 60 * 1_000;

const serviceIdFromName = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 40);

const splitList = (value: string) => value.split(/[\s,]+/u).filter(Boolean);

export function McpGatewaySettingsPanel() {
  const setting = useSearchableSetting();
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment?.connection.phase === "connected" ? (
        <ConnectedServices
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ) : (
        <SettingsSection {...setting("connected-services")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            <T>Connect an environment to manage its connected services.</T>
          </p>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function ConnectedServices({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const setting = useSearchableSetting();
  const gt = useGT();
  const list = useAtomCommand(serverEnvironment.listMcpGatewayServices);
  const save = useAtomCommand(serverEnvironment.saveMcpGatewayService);
  const remove = useAtomCommand(serverEnvironment.removeMcpGatewayService);
  const signIn = useAtomCommand(serverEnvironment.signInMcpGatewayService);
  const signOut = useAtomCommand(serverEnvironment.signOutMcpGatewayService);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const canSignInHere =
    environmentId === primaryEnvironmentId &&
    (isElectron || isLoopbackHostname(window.location.hostname));
  const [services, setServices] = useState<ReadonlyArray<McpGatewayServiceStatus>>([]);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [scopes, setScopes] = useState("");
  const [tools, setTools] = useState("");

  const fetchServices = useEffectEvent(() => list({ environmentId, input: {} }));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Sign-in finishes in the system browser, outside React.
  useEffect(() => {
    const refresh = () =>
      void fetchServices().then((result) => {
        if (result._tag !== "Success") return;
        setServices(result.value);
        setWaitingFor((current) =>
          result.value.some((service) => service.id === current && service.signedIn)
            ? null
            : current,
        );
      });
    refresh();
    if (waitingFor === null) return;
    const poll = setInterval(refresh, SIGN_IN_POLL_MS);
    const giveUp = setTimeout(() => setWaitingFor(null), SIGN_IN_WAIT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [waitingFor]);

  const applyList = (result: Awaited<ReturnType<typeof list>>, failureMessage: string): boolean => {
    if (result._tag !== "Success") {
      setError(failureMessage);
      return false;
    }
    setError(null);
    setServices(result.value);
    return true;
  };

  const startSignIn = async (id: string) => {
    const result = await signIn({ environmentId, input: { id } });
    if (result._tag !== "Success") {
      setError(gt("Could not start the sign-in. Check the service URL and try again."));
      return;
    }
    setError(null);
    setWaitingFor(id);
    setSignInUrl(result.value.authorizationUrl);
    await ensureLocalApi().shell.openExternal(result.value.authorizationUrl);
  };

  const addService = async () => {
    const id = serviceIdFromName(name);
    const scopeList = splitList(scopes);
    const toolList = splitList(tools);
    const result = await save({
      environmentId,
      input: {
        id,
        name: name.trim(),
        url: url.trim(),
        ...(scopeList.length === 0 ? {} : { scopes: scopeList }),
        ...(toolList.length === 0 ? {} : { tools: toolList }),
      },
    });
    if (applyList(result, gt("Could not save the service. Use a name and an https URL."))) {
      setName("");
      setUrl("");
      setScopes("");
      setTools("");
    }
  };

  return (
    <>
      <SettingsSection {...setting("connected-services")}>
        {services.length === 0 ? (
          <SettingsRow
            title={gt("No connected services.")}
            description={gt(
              "Add a remote MCP service and sign in once. Every agent in this environment can then use it.",
            )}
          />
        ) : (
          services.map((service) => (
            <SettingsRow
              key={service.id}
              title={service.name}
              description={service.url}
              status={
                waitingFor === service.id
                  ? gt("Waiting for sign-in")
                  : service.signedIn
                    ? gt("Signed in")
                    : gt("Not signed in")
              }
              control={
                <div className="flex items-center gap-2">
                  {waitingFor === service.id && signInUrl !== null ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void ensureLocalApi().shell.openExternal(signInUrl)}
                    >
                      <T>Open sign-in page</T>
                    </Button>
                  ) : null}
                  {service.signedIn ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={async () =>
                        applyList(
                          await signOut({ environmentId, input: { id: service.id } }),
                          gt("Could not sign out."),
                        )
                      }
                    >
                      <T>Sign out</T>
                    </Button>
                  ) : canSignInHere ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void startSignIn(service.id)}
                    >
                      <T>Sign in</T>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      <T>Sign in on the computer running this environment</T>
                    </span>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () =>
                      applyList(
                        await remove({ environmentId, input: { id: service.id } }),
                        gt("Could not remove the service."),
                      )
                    }
                  >
                    <T>Remove</T>
                  </Button>
                </div>
              }
            />
          ))
        )}
        {error === null ? null : <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      </SettingsSection>
      <SettingsSection title={gt("Add a service")}>
        <div className="grid gap-2 px-4 py-3">
          <Input
            aria-label={gt("Service name")}
            placeholder={gt("Name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label={gt("Service URL")}
            placeholder="https://mcp.example.com/mcp"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Input
            aria-label={gt("OAuth scopes")}
            placeholder={gt("OAuth scopes, if the service needs them")}
            value={scopes}
            onChange={(event) => setScopes(event.target.value)}
          />
          <Input
            aria-label={gt("Allowed tools")}
            placeholder={gt("Allowed tools, comma separated. Empty allows all.")}
            value={tools}
            onChange={(event) => setTools(event.target.value)}
          />
          <div>
            <Button
              size="xs"
              variant="outline"
              disabled={serviceIdFromName(name) === "" || url.trim() === ""}
              onClick={() => void addService()}
            >
              <T>Add service</T>
            </Button>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
