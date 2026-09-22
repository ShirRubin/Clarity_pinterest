// Builds exports/RELINK_WORKLIST.html — the hand-editing worklist for pins that
// still don't point at their blog post. Input: exports/relink-worklist.json.
import fs from "node:fs";

const rows = JSON.parse(fs.readFileSync("exports/relink-worklist.json", "utf8"));
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nBoard = rows.filter((r) => r.kind === "board").length;
const nNone = rows.filter((r) => r.kind === "none").length;
const nImp = rows.filter((r) => r.imp).length;

const items = rows
  .map(
    (r, i) => `  <li class="row" data-kind="${r.kind}" data-imp="${r.imp}" data-id="${r.id}">
    <input type="checkbox" class="chk" id="c${i}">
    <label class="num" for="c${i}">${i + 1}</label>
    <div class="meta">
      <a class="title" href="${r.pin}" target="_blank" rel="noopener">${esc(r.title)}</a>
      <div class="sub"><span class="tag ${r.kind}">${r.kind === "board" ? "goes to a board" : "no link at all"}</span>${r.imp ? `<span class="imp">${r.imp.toLocaleString()} impressions</span>` : ""}</div>
    </div>
    <div class="link"><code>${esc(r.blog)}</code><button class="copy" data-url="${esc(r.blog)}">Copy</button></div>
  </li>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clarity Relink Worklist</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Quicksand:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--paper:#faf8ff;--card:#fff;--ink:#2b2440;--ink-soft:#6b6383;--accent:#8d7bd4;--accent-soft:#e9e4fa;--accent-deep:#5d4ba8;--line:#e5e0f2;--good:#3e8e6c;font-size:16px}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Quicksand',system-ui,sans-serif;line-height:1.6}
  .wrap{max-width:980px;margin:0 auto;padding:2.5rem 1rem 5rem}
  h1{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:2.2rem;margin:.2rem 0 .3rem}
  .kicker{color:var(--accent);font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:.72rem}
  .lede{color:var(--ink-soft);max-width:62ch}
  .note{background:var(--accent-soft);border:1px solid var(--line);border-radius:12px;padding:.85rem 1.1rem;margin:1rem 0}
  .note.warn{background:#fbf3e4;border-color:#eadfc4;color:#5c451a}
  code{font-family:ui-monospace,Consolas,monospace;font-size:.82em;background:var(--accent-soft);border-radius:6px;padding:.1em .45em;color:var(--accent-deep);word-break:break-all}
  .bar{position:sticky;top:0;z-index:5;background:var(--paper);padding:.7rem 0;border-bottom:1px solid var(--line);margin-bottom:.5rem}
  .prog{height:9px;background:var(--accent-soft);border-radius:99px;overflow:hidden;margin-bottom:.5rem}
  .prog i{display:block;height:100%;background:var(--accent);width:0;transition:width .25s}
  .bar .st{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;font-size:.82rem;font-weight:600;color:var(--ink-soft)}
  .f{border:1.5px solid var(--line);background:var(--card);color:var(--ink-soft);border-radius:99px;padding:.25rem .75rem;font:inherit;font-size:.78rem;font-weight:600;cursor:pointer}
  .f.on{border-color:var(--accent);color:var(--accent-deep);background:var(--accent-soft)}
  ul{list-style:none;padding:0;margin:0}
  .row{display:grid;grid-template-columns:auto auto 1fr minmax(240px,auto);gap:.7rem;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.6rem .8rem;margin:.4rem 0}
  .row.done{opacity:.45}
  .row.done .title{text-decoration:line-through}
  .chk{width:19px;height:19px;accent-color:var(--accent);cursor:pointer;margin:0}
  .num{font-size:.75rem;color:var(--ink-soft);font-weight:700;min-width:1.9rem;cursor:pointer}
  .title{font-weight:600;color:var(--ink);text-decoration:none}
  .title:hover{color:var(--accent-deep);text-decoration:underline}
  .sub{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.15rem}
  .tag{font-size:.7rem;font-weight:700;border-radius:99px;padding:.05rem .5rem}
  .tag.board{background:#fbf3e4;color:#8a6518}
  .tag.none{background:#fbe4e8;color:#8f2740}
  .imp{font-size:.7rem;font-weight:700;color:var(--good)}
  .link{display:flex;gap:.4rem;align-items:center;justify-content:flex-end}
  .copy{border:1.5px solid var(--accent);background:var(--card);color:var(--accent-deep);border-radius:8px;padding:.3rem .7rem;font:inherit;font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap}
  .copy:hover{background:var(--accent-soft)}
  .copy.ok{background:var(--good);border-color:var(--good);color:#fff}
  @media(max-width:760px){.row{grid-template-columns:auto auto 1fr}.link{grid-column:1/-1;justify-content:flex-start}}
</style>
</head>
<body>
<div class="wrap">
  <div class="kicker">Clarity &middot; Pinterest &middot; 22 September 2026</div>
  <h1>Relink Worklist</h1>
  <p class="lede">${rows.length} published pins that don&rsquo;t point at their blog post yet. Tick them off as you go &mdash; progress is saved in this browser.</p>

  <div class="note">
    <strong>For each pin:</strong> click the title to open it &rarr; <code>&hellip;</code> &rarr; <strong>Edit Pin</strong> &rarr; select the <strong>Link</strong> field &rarr; paste &rarr; <strong>Save</strong> &rarr; <strong>Save</strong> again on the &ldquo;Heads up!&rdquo; dialog.
  </div>
  <div class="note warn">
    <strong>Pace yourself.</strong> After roughly <strong>8 edits in a burst</strong> Pinterest blocks link editing with &ldquo;you&rsquo;ve hit a block to combat spam&rdquo; &mdash; the Save then fails <em>silently</em> and the panel just stays open. That block is what stopped the automated run. Do about 8, take a break, come back. <strong>Editing a link resets that pin&rsquo;s click stats</strong>, which costs nothing here: ${nNone} of these have no link at all, and the other ${nBoard} only point at a board page.
  </div>

  <div class="bar">
    <div class="prog"><i id="pbar"></i></div>
    <div class="st">
      <span id="count">0 / ${rows.length} done</span>
      <button class="f on" data-f="all">All ${rows.length}</button>
      <button class="f" data-f="imp">Has traffic ${nImp}</button>
      <button class="f" data-f="none">No link ${nNone}</button>
      <button class="f" data-f="board">Board link ${nBoard}</button>
      <button class="f" data-f="todo">Remaining</button>
    </div>
  </div>

  <ul id="list">
${items}
  </ul>
</div>
<script>
(function(){
  var KEY='clarityRelinkDone';
  function load(){ try { return JSON.parse(localStorage.getItem(KEY)||'{}'); } catch(e) { return {}; } }
  function save(s){ try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e) {} }
  var state=load(), rows=[].slice.call(document.querySelectorAll('.row')), filter='all';
  function refresh(){
    var done=0;
    rows.forEach(function(r){
      var id=r.dataset.id, isDone=!!state[id];
      if(isDone) done++;
      r.classList.toggle('done', isDone);
      r.querySelector('.chk').checked=isDone;
      var show = filter==='all' || (filter==='imp' && +r.dataset.imp>0) || (filter===r.dataset.kind) || (filter==='todo' && !isDone);
      r.style.display = show ? '' : 'none';
    });
    document.getElementById('count').textContent = done+' / '+rows.length+' done';
    document.getElementById('pbar').style.width = (rows.length? (done/rows.length*100):0)+'%';
  }
  rows.forEach(function(r){
    r.querySelector('.chk').addEventListener('change', function(e){
      if(e.target.checked) state[r.dataset.id]=1; else delete state[r.dataset.id];
      save(state); refresh();
    });
  });
  document.querySelectorAll('.copy').forEach(function(b){
    b.addEventListener('click', function(){
      var t=b.dataset.url;
      function ok(){ var o=b.textContent; b.textContent='Copied'; b.classList.add('ok'); setTimeout(function(){ b.textContent=o; b.classList.remove('ok'); },1100); }
      function fallback(){ var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); ok(); }catch(e){} ta.remove(); }
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(ok, fallback); } else { fallback(); }
    });
  });
  document.querySelectorAll('.f').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('.f').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on'); filter=b.dataset.f; refresh();
    });
  });
  refresh();
})();
</script>
</body>
</html>`;

fs.writeFileSync("exports/RELINK_WORKLIST.html", html);
console.log("wrote exports/RELINK_WORKLIST.html", (html.length / 1024).toFixed(1) + "KB");
