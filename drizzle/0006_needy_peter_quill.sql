CREATE TABLE `regression_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`processing_token` text,
	`model_choice` text DEFAULT 'quality' NOT NULL,
	`fixture_id` text,
	`coverage_enabled` integer DEFAULT false NOT NULL,
	`temporal_enabled` integer DEFAULT false NOT NULL,
	`result_json` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL
);
