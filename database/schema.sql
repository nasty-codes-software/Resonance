-- Resonance Database Schema
-- MySQL 8.0+ / MariaDB 10.5+
-- Includes: Categories, Roles, Enhanced User Profiles, Friends, DMs

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Users table (enhanced with profile fields)
-- ----------------------------
CREATE TABLE `users` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `display_name` VARCHAR(100) DEFAULT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `avatar` VARCHAR(255) DEFAULT NULL,
    `banner` VARCHAR(255) DEFAULT NULL,
    `banner_color` VARCHAR(7) DEFAULT '#5865F2',
    `bio` VARCHAR(500) DEFAULT NULL,
    `custom_status` VARCHAR(128) DEFAULT NULL,
    `status` ENUM('online', 'idle', 'dnd', 'invisible', 'offline') NOT NULL DEFAULT 'offline',
    `voice_sensitivity` INT UNSIGNED NOT NULL DEFAULT 30,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`),
    UNIQUE KEY `uk_email` (`email`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Permissions table (extensible permission system)
-- ----------------------------
CREATE TABLE `permissions` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) DEFAULT NULL,
    `category` VARCHAR(50) NOT NULL DEFAULT 'general',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Roles table
-- ----------------------------
CREATE TABLE `roles` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `color` VARCHAR(7) DEFAULT '#99AAB5',
    `position` INT NOT NULL DEFAULT 0,
    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_position` (`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Role Permissions (many-to-many)
-- ----------------------------
CREATE TABLE `role_permissions` (
    `role_id` INT UNSIGNED NOT NULL,
    `permission_id` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`role_id`, `permission_id`),
    CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_role_permissions_perm` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- User Roles (many-to-many)
-- ----------------------------
CREATE TABLE `user_roles` (
    `user_id` INT UNSIGNED NOT NULL,
    `role_id` INT UNSIGNED NOT NULL,
    `assigned_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`user_id`, `role_id`),
    CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_user_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Categories table
-- ----------------------------
CREATE TABLE `categories` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `position` INT NOT NULL DEFAULT 0,
    `collapsed` TINYINT(1) NOT NULL DEFAULT 0,
    `created_by` INT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_position` (`position`),
    CONSTRAINT `fk_categories_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Text Channels table (with category and type support)
-- type: 'public' = normal server channel, 'dm' = private DM channel
-- ----------------------------
CREATE TABLE `text_channels` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) DEFAULT NULL,
    `category_id` INT UNSIGNED DEFAULT NULL,
    `type` ENUM('public', 'dm') NOT NULL DEFAULT 'public',
    `created_by` INT UNSIGNED NOT NULL,
    `position` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_position` (`position`),
    KEY `idx_category` (`category_id`),
    KEY `idx_type` (`type`),
    CONSTRAINT `fk_text_channels_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_text_channels_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Voice Channels table (with category and type support)
-- type: 'public' = normal server channel, 'dm' = private call channel
-- ----------------------------
CREATE TABLE `voice_channels` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `category_id` INT UNSIGNED DEFAULT NULL,
    `type` ENUM('public', 'dm') NOT NULL DEFAULT 'public',
    `max_users` INT UNSIGNED DEFAULT 0,
    `bitrate` INT UNSIGNED DEFAULT 64000,
    `created_by` INT UNSIGNED NOT NULL,
    `position` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_position` (`position`),
    KEY `idx_category` (`category_id`),
    KEY `idx_type` (`type`),
    CONSTRAINT `fk_voice_channels_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_voice_channels_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Channel Participants (for DM channels — tracks which users belong to a private channel)
-- ----------------------------
CREATE TABLE `channel_participants` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `channel_id` INT UNSIGNED NOT NULL,
    `channel_type` ENUM('text', 'voice') NOT NULL DEFAULT 'text',
    `user_id` INT UNSIGNED NOT NULL,
    `joined_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_channel_type_user` (`channel_id`, `channel_type`, `user_id`),
    KEY `idx_user` (`user_id`),
    KEY `idx_channel` (`channel_id`, `channel_type`),
    CONSTRAINT `fk_channel_participants_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Messages table
-- ----------------------------
CREATE TABLE `messages` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `channel_id` INT UNSIGNED NOT NULL,
    `user_id` INT UNSIGNED NOT NULL,
    `content` TEXT NOT NULL,
    `attachment_url` VARCHAR(500) NULL DEFAULT NULL,
    `attachment_type` ENUM('image', 'file') NULL DEFAULT NULL,
    `attachment_name` VARCHAR(255) NULL DEFAULT NULL,
    `edited` TINYINT(1) NOT NULL DEFAULT 0,
    `pinned` TINYINT(1) NOT NULL DEFAULT 0,
    `pinned_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_channel_created` (`channel_id`, `created_at`),
    KEY `idx_user` (`user_id`),
    KEY `idx_pinned` (`channel_id`, `pinned`),
    CONSTRAINT `fk_messages_channel` FOREIGN KEY (`channel_id`) REFERENCES `text_channels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_messages_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Voice Channel Members
-- ----------------------------
CREATE TABLE `voice_members` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `channel_id` INT UNSIGNED NOT NULL,
    `user_id` INT UNSIGNED NOT NULL,
    `muted` TINYINT(1) NOT NULL DEFAULT 0,
    `deafened` TINYINT(1) NOT NULL DEFAULT 0,
    `joined_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_channel` (`user_id`, `channel_id`),
    KEY `idx_channel` (`channel_id`),
    CONSTRAINT `fk_voice_members_channel` FOREIGN KEY (`channel_id`) REFERENCES `voice_channels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_voice_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Friend Requests table
-- ----------------------------
CREATE TABLE `friend_requests` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sender_id` INT UNSIGNED NOT NULL,
    `receiver_id` INT UNSIGNED NOT NULL,
    `status` ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_sender_receiver` (`sender_id`, `receiver_id`),
    KEY `idx_receiver_status` (`receiver_id`, `status`),
    KEY `idx_sender_status` (`sender_id`, `status`),
    CONSTRAINT `fk_friend_requests_sender` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_friend_requests_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Friendships table (mutual; always store lower user_id as user1)
-- ----------------------------
CREATE TABLE `friendships` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user1_id` INT UNSIGNED NOT NULL,
    `user2_id` INT UNSIGNED NOT NULL,
    `dm_channel_id` INT UNSIGNED DEFAULT NULL,
    `voice_channel_id` INT UNSIGNED DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_users` (`user1_id`, `user2_id`),
    KEY `idx_user1` (`user1_id`),
    KEY `idx_user2` (`user2_id`),
    KEY `idx_dm_channel` (`dm_channel_id`),
    KEY `idx_voice_channel` (`voice_channel_id`),
    CONSTRAINT `fk_friendships_user1` FOREIGN KEY (`user1_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_friendships_user2` FOREIGN KEY (`user2_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_friendships_dm_channel` FOREIGN KEY (`dm_channel_id`) REFERENCES `text_channels` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_friendships_voice_channel` FOREIGN KEY (`voice_channel_id`) REFERENCES `voice_channels` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Soundboard Sounds table
-- ----------------------------
CREATE TABLE `sounds` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `filename` VARCHAR(255) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `size` INT UNSIGNED NOT NULL,
    `duration` FLOAT DEFAULT NULL,
    `uploaded_by` INT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_uploaded_by` (`uploaded_by`),
    CONSTRAINT `fk_sounds_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Invite Codes table
-- ----------------------------
CREATE TABLE `invite_codes` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `created_by` INT UNSIGNED NOT NULL,
    `max_uses` INT UNSIGNED DEFAULT NULL,
    `uses` INT UNSIGNED NOT NULL DEFAULT 0,
    `expires_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_code` (`code`),
    KEY `idx_created_by` (`created_by`),
    CONSTRAINT `fk_invite_codes_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Invite Code Uses (tracking who used which code)
-- ----------------------------
CREATE TABLE `invite_code_uses` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `invite_code_id` INT UNSIGNED NOT NULL,
    `user_id` INT UNSIGNED NOT NULL,
    `used_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_invite_code` (`invite_code_id`),
    KEY `idx_user` (`user_id`),
    CONSTRAINT `fk_invite_uses_code` FOREIGN KEY (`invite_code_id`) REFERENCES `invite_codes` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_invite_uses_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Default Permissions
-- ----------------------------
INSERT INTO `permissions` (`id`, `name`, `description`, `category`) VALUES
-- General Server Permissions
(1, 'administrator', 'Full access to all server settings and features', 'general'),
(2, 'manage_channels', 'Create, edit, and delete channels', 'general'),
(3, 'manage_roles', 'Create, edit, and delete roles', 'general'),

-- Membership
(4, 'kick_members', 'Kick members from the server', 'membership'),
(5, 'ban_members', 'Ban members from the server', 'membership'),

-- Text Channels
(6, 'send_messages', 'Send messages in text channels', 'text'),
(7, 'manage_messages', 'Delete and pin messages from other users', 'text'),
(8, 'embed_links', 'Embed links in messages', 'text'),
(9, 'attach_files', 'Upload files and images', 'text'),
(10, 'read_history', 'Read message history', 'text'),
(11, 'mention_everyone', 'Use @everyone and @here mentions', 'text'),

-- Voice Channels
(12, 'use_voice', 'Connect to voice channels', 'voice'),
(13, 'speak', 'Speak in voice channels', 'voice'),
(14, 'mute_members', 'Mute other members in voice', 'voice'),
(15, 'deafen_members', 'Deafen other members in voice', 'voice'),
(16, 'move_members', 'Move members between voice channels', 'voice'),
(17, 'manage_sounds', 'Manage soundboard sounds', 'voice');

-- ----------------------------
-- Default Roles
-- ----------------------------
INSERT INTO `roles` (`id`, `name`, `color`, `position`, `is_default`) VALUES
(1, 'Admin', '#E74C3C', 100, 0),
(2, 'Moderator', '#3498DB', 50, 0),
(3, 'Member', '#99AAB5', 0, 1);

-- ----------------------------
-- Default Role Permissions
-- ----------------------------
-- Admin gets administrator permission (grants all)
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 1);

-- Moderator permissions
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
(2, 4), (2, 7), (2, 14), (2, 15), (2, 16);

-- Member permissions (basic access)
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
(3, 6), (3, 8), (3, 9), (3, 10), (3, 12), (3, 13);

-- ----------------------------
-- Default Admin User (password: password)
-- ----------------------------
INSERT INTO `users` (`id`, `username`, `display_name`, `email`, `password`, `status`) VALUES
(1, 'admin', 'Administrator', 'admin@resonance.local', '$2y$12$6O9BbK8AESef65kJD8LeuuUZ.cU2sSGJDW5XwcrpIgcW8x4hTCsJm', 'offline');

INSERT INTO `user_roles` (`user_id`, `role_id`) VALUES (1, 1);

-- ----------------------------
-- Default Category
-- ----------------------------
INSERT INTO `categories` (`id`, `name`, `position`, `created_by`) VALUES
(1, 'Text Channels', 0, 1),
(2, 'Voice Channels', 1, 1);

-- ----------------------------
-- Default Channels
-- ----------------------------
INSERT INTO `text_channels` (`id`, `name`, `description`, `category_id`, `created_by`, `position`) VALUES
(1, 'general', 'General discussion', 1, 1, 0),
(2, 'random', 'Random stuff', 1, 1, 1);

INSERT INTO `voice_channels` (`id`, `name`, `category_id`, `created_by`, `position`) VALUES
(1, 'General Voice', 2, 1, 0),
(2, 'Gaming', 2, 1, 1);

SET FOREIGN_KEY_CHECKS = 1;
