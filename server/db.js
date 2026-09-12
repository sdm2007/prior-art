import mysql from 'mysql2/promise';

export const defaults = {
  'B.Tech CSE':['Data Structures','Database Management Systems','Operating Systems','Computer Networks','Discrete Mathematics','Object Oriented Programming'],
  'B.Tech ECE':['Signals & Systems','Digital Electronics','Analog Circuits','Control Systems','Electromagnetic Theory'],
  'BBA':['Principles of Management','Financial Accounting','Marketing Management','Business Statistics','Organizational Behavior'],
  'B.Sc Computer Science':['Data Structures','Database Management Systems','Computer Networks','Discrete Mathematics','Python Programming']
};

const requiredDb = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
for (const key of requiredDb) {
  if (!process.env[key]) throw new Error(`${key} must be set in .env`);
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  charset: 'utf8mb4'
});

export async function query(sql, params=[]) { const [rows] = await pool.execute(sql, params); return rows; }
export async function one(sql, params=[]) { const rows = await query(sql, params); return rows[0] || null; }
export async function initDb() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(40) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    course VARCHAR(120) NOT NULL,
    semester TINYINT UNSIGNED NOT NULL,
    karma INT NOT NULL DEFAULT 5,
    free_downloads_used TINYINT UNSIGNED NOT NULL DEFAULT 0,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    INDEX idx_users_course_semester(course, semester)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS subjects (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course VARCHAR(120) NOT NULL,
    name VARCHAR(180) NOT NULL,
    UNIQUE KEY uq_subject(course,name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS resources (
    id VARCHAR(40) PRIMARY KEY,
    uploader_id BIGINT UNSIGNED NOT NULL,
    course VARCHAR(120) NOT NULL,
    semester TINYINT UNSIGNED NOT NULL,
    subject VARCHAR(180) NOT NULL,
    content_type VARCHAR(40) NOT NULL,
    exam_type VARCHAR(40) NOT NULL DEFAULT '',
    paper_year VARCHAR(4) NOT NULL DEFAULT '',
    professor VARCHAR(120) NOT NULL DEFAULT '',
    title VARCHAR(180) NOT NULL,
    excerpt TEXT,
    status ENUM('processing','draft','published','rejected') NOT NULL DEFAULT 'processing',
    ai_analysis JSON NULL,
    duplicate_checked BOOLEAN NOT NULL DEFAULT FALSE,
    file_name VARCHAR(255) NOT NULL,
    stored_path VARCHAR(500) NOT NULL,
    file_hash CHAR(64) NOT NULL UNIQUE,
    downloads INT UNSIGNED NOT NULL DEFAULT 0,
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    is_removed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (uploader_id) REFERENCES users(id),
    INDEX idx_resources_scope(course,semester,is_removed,is_flagged,created_at),
    INDEX idx_resources_subject(course,semester,subject),
    INDEX idx_resources_status(status),
    FULLTEXT KEY ft_resources(title,professor,excerpt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS votes (
    resource_id VARCHAR(40) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    type ENUM('up','down') NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY(resource_id,user_id),
    FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS reports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    resource_id VARCHAR(40) NOT NULL,
    reporter_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(500) NOT NULL,
    status ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
    created_at BIGINT NOT NULL,
    UNIQUE KEY uq_open_report(resource_id,reporter_id,status),
    FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS karma_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    amount INT NOT NULL,
    reason VARCHAR(80) NOT NULL,
    resource_id VARCHAR(40),
    created_at BIGINT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_karma_user(user_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS downloads (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    resource_id VARCHAR(40) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    cost TINYINT UNSIGNED NOT NULL,
    created_at BIGINT NOT NULL,
    FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_downloads_user(user_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    resource_id VARCHAR(40) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    body VARCHAR(1000) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT,
    FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(40) PRIMARY KEY,
    type VARCHAR(40) NOT NULL,
    resource_id VARCHAR(40),
    user_id BIGINT UNSIGNED,
    status ENUM('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
    available_at BIGINT NOT NULL,
    locked_at BIGINT,
    result_json JSON NULL,
    error VARCHAR(1000),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    finished_at BIGINT,
    INDEX idx_jobs_claim(status,available_at,created_at),
    INDEX idx_jobs_resource(resource_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS agent_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    agent VARCHAR(60) NOT NULL,
    user_id BIGINT UNSIGNED,
    input_summary TEXT,
    actions_json JSON,
    output_summary TEXT,
    status VARCHAR(30) NOT NULL,
    duration_ms INT,
    created_at BIGINT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_agent_logs_created(created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Lightweight migration for databases created by Prior Art 3.0.
  const [statusColumn] = await pool.query(`
  SELECT COUNT(*) AS count
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'resources'
    AND COLUMN_NAME = 'status'
`);

if (statusColumn[0].count === 0) {
  await query(`
    ALTER TABLE resources
    ADD COLUMN status ENUM('processing','draft','published','rejected')
    NOT NULL DEFAULT 'processing'
  `);
}
const [aiAnalysisColumn] = await pool.query(`
  SELECT COUNT(*) AS count
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'resources'
    AND COLUMN_NAME = 'ai_analysis'
`);

if (aiAnalysisColumn[0].count === 0) {
  await query(`
    ALTER TABLE resources
    ADD COLUMN ai_analysis JSON NULL
  `);
}
const [duplicateCheckedColumn] = await pool.query(`
  SELECT COUNT(*) AS count
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'resources'
    AND COLUMN_NAME = 'duplicate_checked'
`);

if (duplicateCheckedColumn[0].count === 0) {
  await query(`
    ALTER TABLE resources
    ADD COLUMN duplicate_checked BOOLEAN NOT NULL DEFAULT FALSE
  `);
}
  for (const [course, subs] of Object.entries(defaults)) for (const name of subs) await query('INSERT IGNORE INTO subjects(course,name) VALUES(?,?)',[course,name]);
}
