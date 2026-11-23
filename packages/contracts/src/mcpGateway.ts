import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

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
});
export type McpGatewayService = typeof McpGatewayService.Type;

export const McpGatewayServiceStatus = Schema.Struct({
  ...McpGatewayService.fields,
  signedIn: Schema.Boolean,
});
export type McpGatewayServiceStatus = typeof McpGatewayServiceStatus.Type;

export const McpGatewaySignInResult = Schema.Struct({ authorizationUrl: Schema.String });
export type McpGatewaySignInResult = typeof McpGatewaySignInResult.Type;

export class McpGatewayError extends Schema.TaggedError<McpGatewayError>()("McpGatewayError", {
  message: Schema.String,
}) {}
