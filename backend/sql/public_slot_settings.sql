CREATE TABLE IF NOT EXISTS `public_slot_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `calendar` varchar(16) NOT NULL,
  `slot_minutes` int NOT NULL DEFAULT 60,
  `weeks_ahead` int NOT NULL DEFAULT 2,
  `days_json` longtext NOT NULL,
  `closed_days_json` longtext,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_calendar` (`calendar`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `public_slot_settings` (`calendar`, `slot_minutes`, `weeks_ahead`, `days_json`, `closed_days_json`)
VALUES
  (
    '60h',
    60,
    2,
    '{"monday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"tuesday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"wednesday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"thursday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"friday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"saturday":[],"sunday":[]}',
    '[]'
  )
ON DUPLICATE KEY UPDATE
  slot_minutes = VALUES(slot_minutes),
  weeks_ahead = VALUES(weeks_ahead),
  days_json = VALUES(days_json),
  closed_days_json = VALUES(closed_days_json);

INSERT INTO `public_slot_settings` (`calendar`, `slot_minutes`, `weeks_ahead`, `days_json`, `closed_days_json`)
VALUES
  (
    'amm',
    60,
    2,
    '{"monday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"tuesday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"wednesday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"thursday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"friday":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}],"saturday":[],"sunday":[]}',
    '[]'
  )
ON DUPLICATE KEY UPDATE
  slot_minutes = VALUES(slot_minutes),
  weeks_ahead = VALUES(weeks_ahead),
  days_json = VALUES(days_json),
  closed_days_json = VALUES(closed_days_json);
