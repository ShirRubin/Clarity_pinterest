// Approve stage — In Review → Approved / Needs changes / Rejected via a local
// review page. Serves the queue at 127.0.0.1:<port>, writes each decision
// straight to Notion the moment it's clicked, and exits once every pin is
// decided. Notes are appended (never overwritten) so the row keeps its history;
// a "Needs changes" note is what `clarity revise` reads to rewrite the list.
import { exec } from "node:child_process";
import { ensureStatusOptions, pinImageUrls, pinsByStatus, updatePin } from "../notion.js";
import { createApproveServer, type ApprovePin } from "../approve/server.js";
import { decisionPatch } from "../approve/decide.js";

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* best-effort — the URL is printed either way */
  });
}

export async function runApprove(port = 4178): Promise<void> {
  await ensureStatusOptions();
  const rows = await pinsByStatus("In Review");
  if (!rows.length) {
    console.log("No rows In Review — run `clarity review` first.");
    return;
  }
  const pins: ApprovePin[] = rows.map((r) => ({
    pageId: r.pageId,
    name: r.name,
    pinTitle: r.pinTitle ?? r.name,
    pinDescription: r.pinDescription ?? "",
    altText: r.altText ?? "",
    board: r.board ?? "(no board)",
    listItems: r.listItems ?? "",
    imageUrls: r.imageUrls,
  }));
  for (const p of pins) {
    if (!p.imageUrls.length) console.warn(`⚠ ${p.name} has no images — run \`clarity design\`?`);
  }
  const notesByPage = new Map(rows.map((r) => [r.pageId, r.notes]));
  const today = new Date().toISOString().slice(0, 10);
  let needsRevision = 0;
  const server = createApproveServer(
    pins,
    async (pageId, decision, note) => {
      await updatePin(pageId, decisionPatch(decision, note, notesByPage.get(pageId), today));
      if (decision === "revise") needsRevision++;
    },
    () => {
      if (needsRevision) {
        console.log(
          `${needsRevision} sent back for changes — run \`clarity revise\` to rewrite them from your notes.`,
        );
      }
      console.log("All decided — run `clarity publish` to schedule the approved pins.");
      server.close();
    },
    // Re-signed per request: Notion's file URLs expire after an hour.
    async (pageId, index) => (await pinImageUrls(pageId))[index],
  );
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is busy — is another \`clarity approve\` still running? Try \`clarity approve ${port + 1}\`.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Review queue: ${url} (${pins.length} pins) — Ctrl+C quits without finishing.`);
    openBrowser(url);
  });
}
