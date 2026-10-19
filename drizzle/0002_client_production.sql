CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'pro' NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_organizations_slug` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	`permitted_town` text,
	`permitted_tenant_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_members_user_workspace` ON `org_members` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_org_members_workspace` ON `org_members` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_keys_hash` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_workspace` ON `api_keys` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_policies` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`tariff_sgd_per_kwh` real DEFAULT 0.285 NOT NULL,
	`peak_tariff_sgd` real,
	`offpeak_tariff_sgd` real,
	`solar_export_rate_sgd` real DEFAULT 0.0 NOT NULL,
	`grid_factor_kg_co2` real DEFAULT 0.402 NOT NULL,
	`grid_factor_year` integer DEFAULT 2024 NOT NULL,
	`high_priority_sla_hours` integer DEFAULT 24 NOT NULL,
	`normal_priority_sla_hours` integer DEFAULT 72 NOT NULL,
	`timezone` text DEFAULT 'Asia/Singapore' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `estate_blocks` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`town` text NOT NULL,
	`block` text NOT NULL,
	`street` text NOT NULL,
	`units` integer NOT NULL,
	`floors` integer NOT NULL,
	`completed` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_estate_blocks_workspace_id` ON `estate_blocks` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `estate_meters` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`block_id` text NOT NULL,
	`service` text NOT NULL,
	`tenant_id` text NOT NULL,
	`location` text NOT NULL,
	`interval_minutes` integer DEFAULT 60 NOT NULL,
	`threshold_kwh` real NOT NULL,
	`reading_mode` text DEFAULT 'interval_kwh' NOT NULL,
	`multiplier` real DEFAULT 1.0 NOT NULL,
	`last_register_value` real,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_estate_meters_workspace_id` ON `estate_meters` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `contractor_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`specialty` text NOT NULL,
	`contact_email` text,
	`webhook_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contractor_teams_workspace` ON `contractor_teams` (`workspace_id`);
