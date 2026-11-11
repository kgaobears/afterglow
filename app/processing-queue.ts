export type ProcessingStatus = "idle" | "queued" | "processing" | "completed" | "failed";

export type ProcessingJob = {
  id: string;
  title: string;
  date?: string;
  rawText: string;
  createdAt: number;
  processingStatus: ProcessingStatus;
  processingPhase: string;
  processingUpdatedAt: number;
  processingAttempt: number;
  processingToken: string | null;
  processingError: string;
  processingCheckpoint: string;
};

export function processingLabel(job: Pick<ProcessingJob, "processingStatus" | "processingPhase">): string {
  if (job.processingStatus === "queued") return "Queued for local AI";
  if (job.processingStatus === "processing") return job.processingPhase || "Processing locally";
  if (job.processingStatus === "completed") return "Memories ready for review";
  if (job.processingStatus === "failed") return "Processing needs attention";
  return "Not processed with local AI";
}

export function processingCounts(jobs: ProcessingJob[]) {
  return jobs.reduce((counts, job) => {
    if (job.processingStatus === "queued") counts.queued++;
    if (job.processingStatus === "processing") counts.processing++;
    if (job.processingStatus === "completed") counts.completed++;
    if (job.processingStatus === "failed") counts.failed++;
    return counts;
  }, { queued: 0, processing: 0, completed: 0, failed: 0 });
}
