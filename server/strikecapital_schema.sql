-- =============================================================
-- StrikeCapital MySQL Schema
-- Generated from Knex migrations
-- =============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------
-- Migration 1: users
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`                 VARCHAR(255) NOT NULL,
  `password_hash`         VARCHAR(255) NOT NULL,
  `full_name`             VARCHAR(255) NOT NULL,
  `role`                  VARCHAR(20)  NOT NULL DEFAULT 'investor',
  `phone`                 VARCHAR(50)           DEFAULT NULL,
  `reset_token`           VARCHAR(255)          DEFAULT NULL,
  `reset_token_expires`   TIMESTAMP             DEFAULT NULL,
  `is_active`             TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  CONSTRAINT `chk_users_role` CHECK (`role` IN ('investor', 'admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 2: refresh_tokens
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `token`       VARCHAR(255) NOT NULL,
  `expires_at`  TIMESTAMP    NOT NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_refresh_tokens_token`   (`token`),
  KEY `idx_refresh_tokens_user_id` (`user_id`),
  CONSTRAINT `fk_refresh_tokens_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 3: fund_settings
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fund_settings` (
  `id`                        INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `fund_name`                 VARCHAR(255)            DEFAULT 'StrikeCapital by WYR',
  `total_fund_capital`        DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  `max_capital_utilization`   DECIMAL(5, 2)           DEFAULT 80.00,
  `max_single_position`       DECIMAL(5, 2)           DEFAULT 15.00,
  `max_ticker_concentration`  DECIMAL(5, 2)           DEFAULT 25.00,
  `risk_free_rate`            DECIMAL(5, 4)           DEFAULT 0.0525,
  `max_capital_per_position`  DECIMAL(15, 2)          DEFAULT 50000.00,
  `max_positions`             INT                     DEFAULT 20,
  `default_alert_threshold`   DECIMAL(5, 2)           DEFAULT 5.00,
  `updated_by`                INT UNSIGNED            DEFAULT NULL,
  `created_at`                TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_fund_settings_updated_by`
    FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 4: positions
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `positions` (
  `id`                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `ticker`            VARCHAR(20)    NOT NULL,
  `position_type`     VARCHAR(20)    NOT NULL DEFAULT 'option',
  `strike_price`      DECIMAL(10, 2) NOT NULL,
  `premium_received`  DECIMAL(10, 2) NOT NULL,
  `contracts`         INT            NOT NULL DEFAULT 1,
  `shares`            INT                     DEFAULT NULL,
  `cost_basis`        DECIMAL(10, 2)          DEFAULT NULL,
  `expiration_date`   DATE                    DEFAULT NULL,
  `open_date`         DATE           NOT NULL DEFAULT (CURRENT_DATE),
  `close_date`        DATE                    DEFAULT NULL,
  `status`            VARCHAR(20)    NOT NULL DEFAULT 'OPEN',
  `resolution_type`   VARCHAR(30)             DEFAULT NULL,
  `current_price`     DECIMAL(10, 2)          DEFAULT NULL,
  `implied_volatility`DECIMAL(8, 4)           DEFAULT NULL,
  `last_price_update` TIMESTAMP               DEFAULT NULL,
  `collateral`        DECIMAL(15, 2) NOT NULL,
  `break_even`        DECIMAL(10, 2) NOT NULL,
  `max_profit`        DECIMAL(10, 2) NOT NULL,
  `realized_pnl`      DECIMAL(10, 2)          DEFAULT NULL,
  `close_premium`     DECIMAL(10, 2)          DEFAULT NULL,
  `assignment_loss`   DECIMAL(10, 2)          DEFAULT NULL,
  `rolled_from_id`    INT UNSIGNED            DEFAULT NULL,
  `rolled_to_id`      INT UNSIGNED            DEFAULT NULL,
  `assigned_from_id`  INT UNSIGNED            DEFAULT NULL,
  `assigned_to_id`    INT UNSIGNED            DEFAULT NULL,
  `notes`             TEXT                    DEFAULT NULL,
  `created_by`        INT UNSIGNED   NOT NULL,
  `created_at`        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_positions_ticker`          (`ticker`),
  KEY `idx_positions_status`          (`status`),
  KEY `idx_positions_position_type`   (`position_type`),
  KEY `idx_positions_expiration_date` (`expiration_date`),
  KEY `idx_positions_open_date`       (`open_date`),
  CONSTRAINT `fk_positions_rolled_from_id`
    FOREIGN KEY (`rolled_from_id`)   REFERENCES `positions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_positions_rolled_to_id`
    FOREIGN KEY (`rolled_to_id`)     REFERENCES `positions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_positions_assigned_from_id`
    FOREIGN KEY (`assigned_from_id`) REFERENCES `positions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_positions_assigned_to_id`
    FOREIGN KEY (`assigned_to_id`)   REFERENCES `positions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_positions_created_by`
    FOREIGN KEY (`created_by`)       REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 5: investor_allocations
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `investor_allocations` (
  `id`              INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED   NOT NULL,
  `invested_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  `allocation_pct`  DECIMAL(5, 2)  NOT NULL DEFAULT 0.00,
  `start_date`      DATE           NOT NULL,
  `end_date`        DATE                    DEFAULT NULL,
  `is_active`       TINYINT(1)              DEFAULT 1,
  `notes`           TEXT                    DEFAULT NULL,
  `created_by`      INT UNSIGNED            DEFAULT NULL,
  `created_at`      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_investor_allocations_user_id`   (`user_id`),
  KEY `idx_investor_allocations_is_active` (`is_active`),
  CONSTRAINT `fk_investor_allocations_user_id`
    FOREIGN KEY (`user_id`)    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_investor_allocations_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 6: pnl_records
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `pnl_records` (
  `id`          INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `position_id` INT UNSIGNED   NOT NULL,
  `record_date` DATE           NOT NULL,
  `pnl_amount`  DECIMAL(10, 2) NOT NULL,
  `pnl_type`    VARCHAR(30)    NOT NULL,
  `description` TEXT                    DEFAULT NULL,
  `created_by`  INT UNSIGNED            DEFAULT NULL,
  `created_at`  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pnl_records_position_id` (`position_id`),
  KEY `idx_pnl_records_record_date` (`record_date`),
  KEY `idx_pnl_records_pnl_type`   (`pnl_type`),
  CONSTRAINT `fk_pnl_records_position_id`
    FOREIGN KEY (`position_id`) REFERENCES `positions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pnl_records_created_by`
    FOREIGN KEY (`created_by`)  REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 7: announcements
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `announcements` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`        VARCHAR(255) NOT NULL,
  `content`      TEXT         NOT NULL,
  `priority`     VARCHAR(20)           DEFAULT 'normal',
  `is_active`    TINYINT(1)            DEFAULT 1,
  `published_at` TIMESTAMP             DEFAULT NULL,
  `expires_at`   TIMESTAMP             DEFAULT NULL,
  `created_by`   INT UNSIGNED NOT NULL,
  `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_announcements_is_active`    (`is_active`),
  KEY `idx_announcements_published_at` (`published_at`),
  CONSTRAINT `fk_announcements_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 8: notifications
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `type`       VARCHAR(30)  NOT NULL,
  `title`      VARCHAR(255) NOT NULL,
  `message`    TEXT         NOT NULL,
  `is_read`    TINYINT(1)            DEFAULT 0,
  `metadata`   JSON                  DEFAULT NULL,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_id`    (`user_id`),
  KEY `idx_notifications_is_read`    (`is_read`),
  KEY `idx_notifications_type`       (`type`),
  KEY `idx_notifications_created_at` (`created_at`),
  CONSTRAINT `fk_notifications_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 9: audit_logs
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED          DEFAULT NULL,
  `action`      VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50)  NOT NULL,
  `entity_id`   INT                   DEFAULT NULL,
  `old_values`  JSON                  DEFAULT NULL,
  `new_values`  JSON                  DEFAULT NULL,
  `ip_address`  VARCHAR(45)           DEFAULT NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_user_id`     (`user_id`),
  KEY `idx_audit_logs_action`      (`action`),
  KEY `idx_audit_logs_entity_type` (`entity_type`),
  KEY `idx_audit_logs_created_at`  (`created_at`),
  CONSTRAINT `fk_audit_logs_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- Migration 10: market_data_cache
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `market_data_cache` (
  `id`            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `ticker`        VARCHAR(20)    NOT NULL,
  `current_price` DECIMAL(10, 2) NOT NULL,
  `previous_close`DECIMAL(10, 2)          DEFAULT NULL,
  `day_change_pct`DECIMAL(6, 2)           DEFAULT NULL,
  `fetched_at`    TIMESTAMP      NOT NULL,
  `source`        VARCHAR(50)             DEFAULT 'manual',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_market_data_cache_ticker` (`ticker`),
  KEY `idx_market_data_cache_ticker`     (`ticker`),
  KEY `idx_market_data_cache_fetched_at` (`fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrations 11 & 12 columns are already included in the
-- fund_settings and positions CREATE TABLE statements above.

SET FOREIGN_KEY_CHECKS = 1;
