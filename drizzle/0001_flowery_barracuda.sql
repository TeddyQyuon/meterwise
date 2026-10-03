CREATE TABLE `estate_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`order_id` text NOT NULL,
	`action` text NOT NULL,
	`body` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_estate_events_order` ON `estate_events` (`workspace_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `estate_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`file_name` text NOT NULL,
	`accepted` integer NOT NULL,
	`skipped` integer NOT NULL,
	`rejected` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_estate_imports_workspace` ON `estate_imports` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `estate_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`block_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`title` text NOT NULL,
	`priority` text NOT NULL,
	`status` text NOT NULL,
	`assignee` text NOT NULL,
	`due_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL,
	`mutation_id` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_estate_orders_workspace` ON `estate_orders` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `estate_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`consumption_kwh` real NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_estate_readings_interval` ON `estate_readings` (`workspace_id`,`meter_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_estate_readings_time` ON `estate_readings` (`workspace_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `estate_state` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`end_day` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
