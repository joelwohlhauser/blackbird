import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { renderErrorPage, renderMessagePage } from "../auth/mcpOAuthHtml.ts";
import { requestUrl } from "../requestUrl.ts";
import { CALLBACK_PATH, McpGateway } from "./McpGateway.ts";

const PAGE_HEADERS = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const page = (body: string, status: number) =>
  HttpServerResponse.text(body, {
    status,
    contentType: "text/html; charset=utf-8",
    headers: PAGE_HEADERS,
  });

export const layerCallbackRoute = HttpRouter.add(
  "GET",
  CALLBACK_PATH,
  Effect.gen(function* () {
    const gateway = yield* McpGateway;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = requestUrl(request);
    if (Option.isNone(url)) return page(renderErrorPage("The request was invalid."), 400);
    const param = (name: string) => url.value.searchParams.get(name) ?? undefined;
    return yield* gateway
      .completeSignIn({
        state: param("state"),
        code: param("code"),
        error: param("error"),
        issuer: param("iss"),
      })
      .pipe(
        Effect.match({
          onFailure: (error) => page(renderErrorPage(error.message), 400),
          onSuccess: (name) =>
            page(
              renderMessagePage(
                `Connected to ${name}`,
                "You can close this page and return to Blackbird.",
              ),
              200,
            ),
        }),
      );
  }),
);
