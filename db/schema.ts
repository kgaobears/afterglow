import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  name: text("name").notNull(), context: text("context").notNull().default(""),
  tags: text("tags").notNull().default(""), note: text("note").notNull().default(""),
  lastSeen: text("last_seen").notNull().default(""), followUp: text("follow_up").notNull().default(""),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});
export const moments = sqliteTable("moments", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  contactId: text("contact_id").notNull(), body: text("body").notNull(),
  factType: text("fact_type").notNull().default("timeline"),
  temporalNature: text("temporal_nature"),
  timeStart: text("time_start"), timeEnd: text("time_end"),
  timePrecision: text("time_precision"), timeCertainty: text("time_certainty"),
  timeExpression: text("time_expression"),
  date: text("date").notNull(), createdAt: integer("created_at").notNull(),
});

export const gatherings = sqliteTable("gatherings", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  title: text("title").notNull(), groupName: text("group_name").notNull().default(""),
  date: text("date").notNull(), rawText: text("raw_text").notNull(),
  createdAt: integer("created_at").notNull(),
  // Existing gatherings default to idle; only new captures enter the queue.
  processingStatus: text("processing_status").notNull().default("idle"),
  processingPhase: text("processing_phase").notNull().default(""),
  processingUpdatedAt: integer("processing_updated_at").notNull().default(0),
  processingAttempt: integer("processing_attempt").notNull().default(0),
  processingToken: text("processing_token"),
  processingError: text("processing_error").notNull().default(""),
  processingCheckpoint: text("processing_checkpoint").notNull().default(""),
  // Opt-in per-rerun experiment. Cleared after a successful enrichment.
  reconsiderRejected: integer("reconsider_rejected", { mode: "boolean" }).notNull().default(false),
});

export const capturedItems = sqliteTable("captured_items", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  gatheringId: text("gathering_id").notNull(),
  name: text("name").notNull(), detail: text("detail").notNull(),
  factType: text("fact_type").notNull().default("timeline"),
  temporalNature: text("temporal_nature"),
  timeStart: text("time_start"), timeEnd: text("time_end"),
  timePrecision: text("time_precision"), timeCertainty: text("time_certainty"),
  timeExpression: text("time_expression"),
  contactId: text("contact_id"),
  status: text("status").notNull().default("needs_review"),
  reason: text("reason").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

// Fictional, developer-authored regression fixtures only. Never stores a
// visitor's actual gathering or contact data.
export const regressionRuns = sqliteTable("regression_runs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  requestedAt: integer("requested_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  status: text("status").notNull().default("queued"),
  processingToken: text("processing_token"),
  modelChoice: text("model_choice").notNull().default("quality"),
  fixtureId: text("fixture_id"),
  coverageEnabled: integer("coverage_enabled", { mode: "boolean" }).notNull().default(false),
  temporalEnabled: integer("temporal_enabled", { mode: "boolean" }).notNull().default(false),
  resultJson: text("result_json").notNull().default(""),
  error: text("error").notNull().default(""),
});
