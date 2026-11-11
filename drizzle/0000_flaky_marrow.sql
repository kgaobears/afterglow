CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`last_seen` text DEFAULT '' NOT NULL,
	`follow_up` text DEFAULT '' NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`body` text NOT NULL,
	`date` text NOT NULL,
	`created_at` integer NOT NULL
);
