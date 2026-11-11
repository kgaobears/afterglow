ALTER TABLE `gatherings` ADD `processing_status` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `gatherings` ADD `processing_phase` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `gatherings` ADD `processing_updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `gatherings` ADD `processing_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `gatherings` ADD `processing_token` text;--> statement-breakpoint
ALTER TABLE `gatherings` ADD `processing_error` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `gatherings` ADD `processing_checkpoint` text DEFAULT '' NOT NULL;