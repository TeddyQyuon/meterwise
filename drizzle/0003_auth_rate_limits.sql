CREATE TABLE `auth_rate_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_rate_buckets_expiry` ON `auth_rate_buckets` (`expires_at`);
