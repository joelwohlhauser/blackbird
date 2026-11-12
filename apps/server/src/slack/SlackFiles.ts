import {
  SlackError,
  type SlackFileUrlInput,
  type SlackFileUrlResult,
  type SlackFileVariant,
  type SlackUploadInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { HttpServerResponse } from "effect/http";

import { issueSlackFileUrl } from "../assets/AssetAccess.ts";
import * as AssetSigner from "../assets/AssetSigner.ts";
import { deletePendingAttachment } from "../assets/AttachmentUpload.ts";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as SlackApi from "./SlackApi.ts";

const MAX_REMEMBERED_FILES = 5000;
const INLINE_CONTENT_TYPE_PATTERN = /^(?:image|video|audio)\/[\w!#$&^.+-]+$/i;
const FORWARDED_REQUEST_HEADERS = ["range", "if-range"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

interface RememberedFile {
  readonly name: string;
  readonly mimetype: string;
  readonly full: string;
  readonly thumb: string;
}

const encodeUploadedFiles = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))),
);

export class SlackFiles extends Context.Service<
  SlackFiles,
  {
    readonly remember: (raw: SlackApi.RawSlackFile) => void;
    readonly clear: () => void;
    readonly fileUrl: (input: SlackFileUrlInput) => Effect.Effect<SlackFileUrlResult, SlackError>;
    readonly upload: (
      session: SlackApi.SlackSession,
      input: SlackUploadInput,
    ) => Effect.Effect<void, SlackError>;
    readonly fileResponse: (
      session: SlackApi.SlackSession | undefined,
      file: { readonly fileId: string; readonly variant: SlackFileVariant },
      requestHeaders: Readonly<Record<string, string | undefined>>,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope>;
  }
>()("t3/slack/SlackFiles") {}

const make = Effect.gen(function* () {
  const api = yield* SlackApi.SlackApi;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const signer = yield* AssetSigner.AssetSigner;
  const files = new Map<string, RememberedFile>();

  const remember = (raw: SlackApi.RawSlackFile): RememberedFile | undefined => {
    if (!raw.url_private) return undefined;
    const file = SlackApi.normalizeSlackFile(raw);
    const remembered = {
      name: file.name,
      mimetype: file.mimetype,
      full: raw.url_private,
      thumb:
        (file.isImage ? (raw.thumb_720 ?? raw.thumb_480 ?? raw.thumb_360) : undefined) ??
        raw.url_private,
    };
    files.delete(raw.id);
    files.set(raw.id, remembered);
    if (files.size > MAX_REMEMBERED_FILES) {
      const oldest = files.keys().next().value;
      if (oldest !== undefined) files.delete(oldest);
    }
    return remembered;
  };

  return SlackFiles.of({
    remember,
    clear: () => files.clear(),

    fileUrl: Effect.fnUntraced(function* (input) {
      return yield* issueSlackFileUrl({
        fileId: input.fileId,
        variant: input.variant,
        fileName: files.get(input.fileId)?.name ?? input.fileId,
      }).pipe(
        Effect.provideService(AssetSigner.AssetSigner, signer),
        Effect.mapError(
          () =>
            new SlackError({
              reason: "slack_api",
              message: "Blackbird could not sign the Slack file link.",
            }),
        ),
      );
    }),

    upload: Effect.fnUntraced(function* (session, input) {
      const uploaded: Array<{ readonly id: string; readonly title: string }> = [];
      for (const file of input.files) {
        const attachmentPath = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: file.attachmentId,
        });
        const bytes =
          attachmentPath === null
            ? undefined
            : yield* fileSystem
                .readFile(attachmentPath)
                .pipe(Effect.orElseSucceed(() => undefined));
        if (bytes === undefined) {
          return yield* new SlackError({
            reason: "not_found",
            message: `The upload ${file.name} is no longer available.`,
          });
        }
        const target = yield* api.call({
          token: session.userToken,
          method: "files.getUploadURLExternal",
          decode: SlackApi.SlackResponses.uploadUrl,
          params: { filename: file.name, length: bytes.byteLength },
        });
        yield* api.upload({ url: target.upload_url, bytes });
        uploaded.push({ id: target.file_id, title: file.name });
      }
      yield* api.call({
        token: session.userToken,
        method: "files.completeUploadExternal",
        decode: SlackApi.SlackResponses.empty,
        params: {
          files: encodeUploadedFiles(uploaded),
          channel_id: input.conversationId,
          thread_ts: input.threadTs,
          initial_comment: input.comment?.trim() || undefined,
        },
      });
      for (const file of input.files) {
        yield* deletePendingAttachment(file.attachmentId).pipe(
          Effect.provideService(ServerConfig.ServerConfig, config),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        );
      }
    }),

    fileResponse: Effect.fnUntraced(function* (session, asset, requestHeaders) {
      const headers: Record<string, string> = {
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      };
      const failed = (status: number) =>
        HttpServerResponse.empty({
          status,
          headers: { ...headers, "cache-control": "private, no-store" },
        });
      if (session === undefined) return failed(404);
      const file =
        files.get(asset.fileId) ??
        (yield* api
          .call({
            token: session.userToken,
            method: "files.info",
            decode: SlackApi.SlackResponses.file,
            params: { file: asset.fileId },
          })
          .pipe(
            Effect.map((info) => remember(info.file)),
            Effect.orElseSucceed(() => undefined),
          ));
      if (file === undefined) return failed(404);
      const forwarded: Record<string, string> = {};
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = requestHeaders[name];
        if (value !== undefined) forwarded[name] = value;
      }
      const response = yield* api
        .fetchFile({
          token: session.userToken,
          url: asset.variant === "thumb" ? file.thumb : file.full,
          headers: forwarded,
        })
        .pipe(Effect.orElseSucceed(() => undefined));
      if (response === undefined || (response.status >= 300 && response.status < 400)) {
        return failed(502);
      }
      if (response.status >= 400) return failed(response.status >= 500 ? 502 : response.status);
      const upstreamType =
        response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (upstreamType === "text/html" && file.mimetype !== "text/html") return failed(502);
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = response.headers[name];
        if (value !== undefined) headers[name] = value;
      }
      const inline =
        INLINE_CONTENT_TYPE_PATTERN.test(upstreamType) && upstreamType !== "image/svg+xml";
      const contentType = inline ? upstreamType : "application/octet-stream";
      if (!inline) {
        headers["content-disposition"] =
          `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`;
      }
      return HttpServerResponse.stream(response.stream, {
        status: response.status,
        headers,
        contentType,
      });
    }),
  });
});

export const layer = Layer.effect(SlackFiles, make);
