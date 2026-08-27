// Approve stage — In Review → Approved/Rejected via a local review page.
// Serves the queue at 127.0.0.1:<port>, writes each decision straight to
// Notion the moment it's clicked, and exits once every pin is decided.
// Rejection notes land in the row's Notes so generation can learn later.
import { exec } from "node:child_process";
import { pinsByStatus, updatePin } from "../notion.js";
import { createApproveServer, type ApprovePin } from "../approve/server.js";

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
  const today = new Date().toISOString().slice(0, 10);
  const server = createApproveServer(
    pins,
    async (pageId, decision, note) => {
      await updatePin(pageId, {
        status: decision === "approve" ? "Approved" : "Rejected",
        ...(note ? { notes: `review ${today}: ${note}` } : {}),
      });
    },
    () => {
      console.log("All decided — run `clarity publish` to schedule the approved pins.");
      server.close();
    },
  );
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Review queue: ${url} (${pins.length} pins) — Ctrl+C quits without finishing.`);
    openBrowser(url);
  });
}
