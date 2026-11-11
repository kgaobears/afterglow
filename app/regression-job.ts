import { EXTRACTION_FIXTURES, scoreExtraction, type ExtractionMemory } from "./extraction-regression";

export type RegressionJobOptions = {
  modelChoice: "quality" | "light";
  fixtureId: string | null;
  coverageEnabled: boolean;
  temporalEnabled: boolean;
};

export type RegressionRunStatus = "queued" | "running" | "completed" | "failed";

export function parseRegressionJobOptions(value: Record<string, unknown>): RegressionJobOptions {
  const fixtureId = value.fixtureId === null || value.fixtureId === undefined || value.fixtureId === ""
    ? null : value.fixtureId;
  if (fixtureId !== null && (typeof fixtureId !== "string" || !EXTRACTION_FIXTURES.some(item => item.id === fixtureId))) {
    throw new Error("Unknown regression fixture");
  }
  if (value.modelChoice !== undefined && value.modelChoice !== "quality" && value.modelChoice !== "light") {
    throw new Error("Unknown offline model");
  }
  return {
    modelChoice: value.modelChoice === "light" ? "light" : "quality",
    fixtureId: fixtureId as string | null,
    coverageEnabled: value.coverageEnabled === true,
    temporalEnabled: value.temporalEnabled === true,
  };
}

export function fixturesForRun(fixtureId: string | null) {
  return fixtureId ? EXTRACTION_FIXTURES.filter(item => item.id === fixtureId) : EXTRACTION_FIXTURES;
}

// The browser reports the raw model replies, not the final verdict. Always
// rescore against trusted, source-controlled fixtures on the server.
export function scoreReportedRun(options: RegressionJobOptions, entries: unknown) {
  if (!Array.isArray(entries)) throw new Error("Expected regression results array");
  const expected = fixturesForRun(options.fixtureId);
  if (entries.length !== expected.length) throw new Error("Some regression cases are missing");
  return expected.map(fixture => {
    const entry = entries.find(item => item && typeof item === "object" && item.id === fixture.id) as Record<string, unknown> | undefined;
    if (!entry || !Array.isArray(entry.memories)) throw new Error(`Missing results for ${fixture.id}`);
    const memories = entry.memories.slice(0, 40).filter((item): item is ExtractionMemory =>
      Boolean(item && typeof item === "object" && typeof item.name === "string" && typeof item.detail === "string"))
      .map(item => ({ name: item.name.slice(0, 120), detail: item.detail.slice(0, 1000), factType: item.factType }));
    const score = scoreExtraction(fixture, memories);
    return {
      id: fixture.id, title: fixture.title, sourceNote: fixture.note, gatheringDate: fixture.date,
      model: options.modelChoice, coverageEnabled: options.coverageEnabled, temporalEnabled: options.temporalEnabled,
      durationMs: typeof entry.durationMs === "number" ? Math.max(0, Math.floor(entry.durationMs)) : 0,
      progress: Array.isArray(entry.progress) ? entry.progress.slice(0, 100) : [],
      diagnostics: entry.diagnostics && typeof entry.diagnostics === "object" && !Array.isArray(entry.diagnostics) ? entry.diagnostics : {},
      memories, score,
      ...(typeof entry.error === "string" && entry.error ? { error: entry.error.slice(0, 500) } : {}),
    };
  });
}

export function regressionSummary(results: ReturnType<typeof scoreReportedRun>) {
  const passed = results.every(result => !result.error && result.score.covered === result.score.total && result.score.correctlyTyped === result.score.total);
  return { passed, covered: results.reduce((sum, result) => sum + result.score.covered, 0),
    total: results.reduce((sum, result) => sum + result.score.total, 0),
    correctlyTyped: results.reduce((sum, result) => sum + result.score.correctlyTyped, 0) };
}
