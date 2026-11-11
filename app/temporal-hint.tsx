"use client";

import { Clock3 } from "lucide-react";
import { temporalHint, type TemporalFields } from "./temporal-facts";
import { useLocalProcessingQueue } from "./local-processing-provider";

export default function TemporalHint({ fact }: { fact: TemporalFields }) {
  const { testingOptions } = useLocalProcessingQueue();
  if (!testingOptions.showTimeHints) return null;
  const label = temporalHint(fact);
  if (!label) return null;
  return <small className="temporal-hint" title="Inferred from the conversation. Tentative dates may need checking.">
    <Clock3 size={12} aria-hidden="true"/> {label}
  </small>;
}
