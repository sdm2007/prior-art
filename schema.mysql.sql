CREATE DATABASE IF NOT EXISTS prior_art CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'prior_art'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON prior_art.* TO 'prior_art'@'localhost';
FLUSH PRIVILEGES;
