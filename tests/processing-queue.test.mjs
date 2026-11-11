import test from "node:test";
import assert from "node:assert/strict";
import { processingCounts, processingLabel } from "../app/processing-queue.ts";

const job = (id, processingStatus, processingPhase = "") => ({ id, processingStatus, processingPhase });

test("the queue distinguishes waiting, running, failed and completed gatherings", () => {
  const jobs = [job("a", "queued"), job("b", "processing"), job("c", "completed"), job("d", "failed"), job("e", "idle")];
  assert.deepEqual(processingCounts(jobs), { queued: 1, processing: 1, completed: 1, failed: 1 });
  assert.equal(processingLabel(jobs[0]), "Queued for local AI");
  assert.equal(processingLabel(jobs[1]), "Processing locally");
  assert.equal(processingLabel(jobs[2]), "Memories ready for review");
  assert.equal(processingLabel(jobs[3]), "Processing needs attention");
  assert.equal(processingLabel(jobs[4]), "Not processed with local AI");
});

test("active processing shows its saved stage instead of claiming completion", () => {
  assert.equal(processingLabel(job("x", "processing", "Atomic memories ready")), "Atomic memories ready");
});
