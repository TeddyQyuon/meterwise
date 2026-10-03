CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_workspace_meter` ON `alerts` (`workspace_id`,`meter_id`);--> statement-breakpoint
CREATE TABLE `imports` (
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
CREATE INDEX `idx_imports_workspace` ON `imports` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `meters` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`tenant_id` text NOT NULL,
	`location` text NOT NULL,
	`threshold_kwh` real NOT NULL,
	`interval_minutes` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meters_workspace_id` ON `meters` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`alert_id` text NOT NULL,
	`body` text NOT NULL,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notes_alert` ON `notes` (`alert_id`);--> statement-breakpoint
CREATE TABLE `readings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`consumption_kwh` real NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_readings_meter_timestamp` ON `readings` (`workspace_id`,`meter_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_readings_workspace_time` ON `readings` (`workspace_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	`tenant_id` text,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`floor` text NOT NULL,
	`color` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenants_workspace_id` ON `tenants` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tariff` real NOT NULL,
	`seeded` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
