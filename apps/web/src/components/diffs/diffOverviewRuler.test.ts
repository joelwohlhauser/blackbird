import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { compactPartialHunkOffsets } from "~/lib/diffRendering";

import { buildDiffOverviewMarkers } from "./diffOverviewRuler";

const PATCH = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 const first = true;
-const value = "old";
+const value = "new";
+const extra = true;
 const middle = true;
 const end = true;
`;

describe("buildDiffOverviewMarkers", () => {
  it("creates proportionally positioned addition and deletion markers", () => {
    const [parsedFile] = parsePatchFiles(PATCH, "diff-overview-test")[0]!.files;
    expect(parsedFile).toBeDefined();
    const fileDiff = compactPartialHunkOffsets(parsedFile!);

    const markers = buildDiffOverviewMarkers([{ fileDiff, collapsed: false }]);

    expect(markers.map((marker) => marker.kind)).toEqual(["deletion", "addition"]);
    expect(markers[0]?.topPercent).toBeGreaterThan(0);
    expect(markers[1]?.topPercent).toBeGreaterThan(markers[0]?.topPercent ?? 0);
    expect(markers[1]?.heightPercent).toBeGreaterThan(markers[0]?.heightPercent ?? 0);
  });

  it("does not show markers for collapsed files", () => {
    const [parsedFile] = parsePatchFiles(PATCH, "diff-overview-test")[0]!.files;
    expect(parsedFile).toBeDefined();

    expect(buildDiffOverviewMarkers([{ fileDiff: parsedFile!, collapsed: true }])).toEqual([]);
  });
});
