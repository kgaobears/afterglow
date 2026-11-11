CREATE TABLE `captured_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`gathering_id` text NOT NULL,
	`name` text NOT NULL,
	`detail` text NOT NULL,
	`contact_id` text,
	`status` text DEFAULT 'needs_review' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gatherings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`group_name` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`raw_text` text NOT NULL,
	`created_at` integer NOT NULL
);
