// src/templates.ts — the design-template registry, kept free of playwright so
// the pure modules (notionPage, variants, the review Worker) can import it.
//
// "soft-editorial" (serif) existed briefly — user rejected it on the Phase 2 pilot.
// Two more chosen 2026-09-06 from a six-candidate pilot (sticky-note, big-numbers won;
// split-poster, pill-chips, night-mode, blog-sticker rejected and deleted).
export const TEMPLATE_NAMES = ["classic-checklist", "bold-panel", "sticky-note", "big-numbers"] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
