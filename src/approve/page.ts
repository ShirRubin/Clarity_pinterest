// The review page: one self-contained HTML string — inline CSS/JS, no
// build step, no CDN. Pin text is our own generated content rendered
// into our own local page, so innerHTML is acceptable here.
import type { ApprovePin } from "./server.js";

export function renderApprovePage(pins: ApprovePin[]): string {
  // Ship an image COUNT, never the URLs: Notion signs them for an hour, so the
  // captured ones are stale by the time a long review session reaches them. The
  // page requests /img/<pageId>/<i> and the server re-signs per request.
  const forPage = pins.map(({ imageUrls, ...rest }) => ({ ...rest, imageCount: imageUrls.length }));
  const data = JSON.stringify(forPage).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Clarity — review queue</title>
<style>
  :root { --paper:#faf7f2; --ink:#3a3340; --accent:#b8a1e3; --ok:#7fb69b; --no:#e39a9a; --maybe:#e8b87f; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:"Segoe UI",system-ui,sans-serif; background:var(--paper); color:var(--ink); padding:2rem 1rem 4rem; }
  header { max-width:960px; margin:0 auto 1.5rem; display:flex; justify-content:space-between; align-items:baseline; }
  h1 { font-size:1.4rem; }
  #progress { font-weight:600; color:var(--accent); }
  .card { max-width:960px; margin:0 auto 2rem; background:#fff; border-radius:16px; padding:1.2rem; box-shadow:0 2px 12px rgba(58,51,64,.08); outline:none; }
  .card:focus { box-shadow:0 0 0 3px var(--accent); }
  .card.decided { opacity:.45; }
  .imgs { display:flex; gap:1rem; margin-bottom:1rem; }
  .imgs img { width:50%; border-radius:10px; background:#eee; }
  .board { display:inline-block; background:var(--accent); color:#fff; border-radius:999px; padding:.15rem .7rem; font-size:.8rem; margin-bottom:.4rem; }
  h2 { font-size:1.1rem; margin:.2rem 0 .4rem; }
  p.desc { font-size:.92rem; white-space:pre-wrap; }
  p.alt { font-size:.8rem; color:#8a8292; margin-top:.4rem; }
  details { margin-top:.5rem; font-size:.85rem; }
  details pre { white-space:pre-wrap; }
  .actions { display:flex; gap:.8rem; margin-top:1rem; align-items:center; flex-wrap:wrap; }
  button { border:0; border-radius:10px; padding:.6rem 1.4rem; font-size:1rem; font-weight:600; color:#fff; cursor:pointer; }
  .approve { background:var(--ok); } .reject { background:var(--no); } .revise { background:var(--maybe); }
  textarea.note { width:100%; margin-top:.6rem; min-height:3.2rem; resize:vertical; font-family:inherit;
    border:1px solid #ddd; border-radius:10px; padding:.55rem .8rem; font-size:.9rem; color:inherit; }
  textarea.note:focus { outline:none; border-color:var(--accent); }
  .hint { font-size:.78rem; color:#8a8292; margin-top:.3rem; }
  .verdict { font-weight:700; }
  .err { color:#c0392b; font-size:.85rem; margin-top:.4rem; }
  #summary { max-width:960px; margin:0 auto; text-align:center; font-size:1.2rem; display:none; padding:2rem; }
</style></head><body>
<header><h1>Clarity review queue</h1><div id="progress"></div></header>
<main id="cards"></main>
<div id="summary"></div>
<script>
const pins = ${data};
let decided = 0, approved = 0, revised = 0;
const cards = document.getElementById("cards");
const progress = document.getElementById("progress");
function updateProgress() {
  progress.textContent = decided + " of " + pins.length + " decided";
  if (decided === pins.length) {
    const s = document.getElementById("summary");
    s.style.display = "block";
    const rejected = decided - approved - revised;
    s.textContent = approved + " approved, " + rejected + " rejected, " + revised +
      " sent back for changes." +
      (revised ? " Run clarity revise to rewrite those and put them back in this queue." : "") +
      " Run clarity publish to schedule the approved ones. You can close this tab.";
  }
}
for (const pin of pins) {
  const el = document.createElement("section");
  el.className = "card"; el.tabIndex = 0; el.dataset.id = pin.pageId;
  el.innerHTML =
    '<div class="imgs">' + Array.from({ length: pin.imageCount }, (_, i) =>
      '<img loading="lazy" src="/img/' + pin.pageId + '/' + i + '">').join("") + '</div>' +
    '<span class="board">' + pin.board + '</span>' +
    '<h2>' + (pin.pinTitle || pin.name) + '</h2>' +
    '<p class="desc">' + pin.pinDescription + '</p>' +
    '<p class="alt">alt: ' + pin.altText + '</p>' +
    '<details><summary>List items</summary><pre>' + pin.listItems + '</pre></details>' +
    '<div class="actions">' +
      '<button class="approve">✓ Approve (A)</button>' +
      '<button class="revise">↻ Needs changes (M)</button>' +
      '<button class="reject">✗ Reject (R)</button>' +
    '</div>' +
    '<textarea class="note" placeholder="notes — required for Needs changes: say what to fix (e.g. items 3 and 7 are vague, make the title less clickbaity)"></textarea>' +
    '<div class="hint">Needs changes keeps the list and rewrites it from your notes, then sends it back to this queue.</div>' +
    '<div class="err"></div>';
  el.querySelector(".approve").onclick = () => decide(el, pin, "approve");
  el.querySelector(".revise").onclick = () => decide(el, pin, "revise");
  el.querySelector(".reject").onclick = () => decide(el, pin, "reject");
  cards.appendChild(el);
}
const VERDICT = { approve: "✓ Approved", reject: "✗ Rejected", revise: "↻ Sent back for changes" };
async function decide(el, pin, decision) {
  if (el.dataset.busy === "1") return;
  const err = el.querySelector(".err");
  err.textContent = "";
  const note = el.querySelector(".note").value.trim();
  if (decision === "revise" && !note) {
    err.textContent = "Say what to change first — the rewrite runs off these notes.";
    el.querySelector(".note").focus();
    return;
  }
  el.dataset.busy = "1";
  el.querySelectorAll("button").forEach(b => b.disabled = true);
  try {
    const res = await fetch("/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageId: pin.pageId, decision, note }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    el.classList.add("decided");
    el.querySelector(".actions").innerHTML =
      '<span class="verdict">' + VERDICT[decision] + "</span>";
    el.querySelector(".note").disabled = true;
    decided++;
    if (decision === "approve") approved++;
    if (decision === "revise") revised++;
    updateProgress();
    const next = el.nextElementSibling;
    if (next && next.classList && next.classList.contains("card")) next.focus();
  } catch (e) {
    err.textContent = "Notion said no: " + e.message + " — try again.";
  } finally {
    el.dataset.busy = "";
    el.querySelectorAll("button").forEach(b => b.disabled = false);
  }
}
document.addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA") return;
  const el = document.activeElement && document.activeElement.closest
    ? document.activeElement.closest(".card") : null;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    const list = [...cards.children];
    const i = el ? list.indexOf(el) : -1;
    const next = list[i + (ev.key === "ArrowDown" ? 1 : -1)];
    if (next) { next.focus(); ev.preventDefault(); }
    return;
  }
  if (!el || el.classList.contains("decided")) return;
  const pin = pins.find(p => p.pageId === el.dataset.id);
  if (ev.key === "a" || ev.key === "A") decide(el, pin, "approve");
  if (ev.key === "r" || ev.key === "R") decide(el, pin, "reject");
  if (ev.key === "m" || ev.key === "M") decide(el, pin, "revise");
});
updateProgress();
if (cards.firstElementChild) cards.firstElementChild.focus();
</script></body></html>`;
}
