ALTER TABLE `captured_items` ADD `fact_type` text DEFAULT 'timeline' NOT NULL;--> statement-breakpoint
ALTER TABLE `moments` ADD `fact_type` text DEFAULT 'timeline' NOT NULL;