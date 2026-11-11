export type TestingOption = "reconsiderRejected" | "runCoveragePass" | "runTemporalPass" | "showDiagnostics" | "showTimeHints" | "allowRemoteRegression";
export type TestingOptions = Record<TestingOption, boolean>;

export const DEFAULT_TESTING_OPTIONS: TestingOptions = {
  reconsiderRejected: false,
  runCoveragePass: false,
  runTemporalPass: false,
  showDiagnostics: true,
  showTimeHints: true,
  allowRemoteRegression: true,
};

// Refresh previously enabled experimental passes after the extraction prompt
// rollback; users can opt back in individually on the Settings page.
export const TESTING_OPTIONS_STORAGE_KEY = "afterglow-testing-options-v2";
export const PRIOR_TESTING_OPTIONS_STORAGE_KEY = "afterglow-testing-options-v1";

export function parseTestingOptions(raw: string | null): TestingOptions {
  if (!raw) return { ...DEFAULT_TESTING_OPTIONS };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_TESTING_OPTIONS };
    const record = value as Record<string, unknown>;
    const next = { ...DEFAULT_TESTING_OPTIONS };
    for (const key of Object.keys(DEFAULT_TESTING_OPTIONS) as TestingOption[]) {
      if (typeof record[key] === "boolean") next[key] = record[key];
    }
    return next;
  } catch {
    return { ...DEFAULT_TESTING_OPTIONS };
  }
}

export function migratePreviousTestingOptions(raw: string | null): TestingOptions {
  const previous = parseTestingOptions(raw);
  return { ...previous, runCoveragePass: false, runTemporalPass: false };
}
