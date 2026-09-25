// src/stats.ts — which raw analytics exports are stale.
// scripts/import-analytics.ts reads every CSV in data/analytics/raw/ and the
// last one of each shape wins, so an old export left beside a new one can
// silently replace it. `clarity stats` moves these to raw/archive/ first.

type Kind = { group: string; stamp: string };

/** The export's group (overview, or one audience view) and a sortable date stamp. */
function classify(file: string): Kind | undefined {
  const overview = /^Pinterest Analytics overview (\d{8})-(\d{8})\.csv$/i.exec(file);
  if (overview) return { group: "overview", stamp: overview[2] };
  const audience = /^audience-insights-(.+)-(\d{4}-\d{2}-\d{2})\.csv$/i.exec(file);
  if (audience) return { group: `audience:${audience[1]}`, stamp: audience[2].replace(/-/g, "") };
  return undefined;
}

/** Every recognised export that a newer export of the same group supersedes. */
export function staleExports(files: string[]): string[] {
  const newest = new Map<string, string>();
  for (const f of files) {
    const k = classify(f);
    if (k && (newest.get(k.group) ?? "") < k.stamp) newest.set(k.group, k.stamp);
  }
  return files.filter((f) => {
    const k = classify(f);
    return k !== undefined && k.stamp < newest.get(k.group)!;
  });
}
