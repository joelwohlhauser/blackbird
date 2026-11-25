import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { SettingsSecretValue } from "./settingsSecretValue.ts";

export const McpGatewayServiceId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/),
);
export type McpGatewayServiceId = typeof McpGatewayServiceId.Type;

export const McpGatewayService = Schema.Struct({
  id: McpGatewayServiceId,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString.check(Schema.isPattern(/^https:\/\/[^\s/]+/)),
  scopes: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  tools: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  /** For services without dynamic client registration. */
  oauthClientId: Schema.optionalKey(TrimmedNonEmptyString),
  /** Kept in the secret store, or the secret provider to read it from. */
  oauthClientSecret: Schema.optionalKey(
    SettingsSecretValue.pipe(Schema.annotateKey({ settingsSecret: true })),
  ),
});
export type McpGatewayService = typeof McpGatewayService.Type;

const { oauthClientSecret: _secret, ...publicServiceFields } = McpGatewayService.fields;

export const McpGatewayServiceStatus = Schema.Struct({
  ...publicServiceFields,
  signedIn: Schema.Boolean,
});
export type McpGatewayServiceStatus = typeof McpGatewayServiceStatus.Type;

export const McpGatewaySignInResult = Schema.Struct({ authorizationUrl: Schema.String });
export type McpGatewaySignInResult = typeof McpGatewaySignInResult.Type;

export class McpGatewayError extends Schema.TaggedError<McpGatewayError>()("McpGatewayError", {
  message: Schema.String,
}) {}
