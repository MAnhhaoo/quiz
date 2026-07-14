const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const mammoth = require('mammoth');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// DATABASE SETUP (Supabase PostgreSQL via pg Pool)
// =============================================
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || !!process.env.VERCEL;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres.mihdndnyfkxxsgwtlrmg:Macanhhao123@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';

const sslConfig = (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'))
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl: sslConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Convert SQLite placeholders (?) to PostgreSQL placeholders ($1, $2, ...)
function formatSqlForPostgres(sql) {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

// DB HELPERS
async function queryAll(sql, params = []) {
  const pgSql = formatSqlForPostgres(sql);
  const res = await pool.query(pgSql, params);
  return res.rows;
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function execute(sql, params = []) {
  let pgSql = formatSqlForPostgres(sql);
  // Automatically append RETURNING id for INSERT statements if not present (except for settings table which has no id column)
  if (/^\s*INSERT\s+INTO/i.test(pgSql) && !/RETURNING/i.test(pgSql) && !/INSERT\s+INTO\s+settings/i.test(pgSql)) {
    pgSql += ' RETURNING id';
  }
  const res = await pool.query(pgSql, params);
  return res.rows[0]?.id || res.rowCount;
}

// Ensure database tables are created before handling requests
let dbInitPromise = null;
function ensureDbInitialized() {
  if (!dbInitPromise) {
    dbInitPromise = initDatabase().catch(err => {
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

async function initDatabase() {
  console.log('⏳ Đang kiểm tra và khởi tạo các bảng trên Supabase PostgreSQL...');

  // Create tables using PostgreSQL syntax
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS topics (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      user_id INTEGER DEFAULT 1,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      option_a TEXT NOT NULL DEFAULT '',
      option_b TEXT NOT NULL DEFAULT '',
      option_c TEXT NOT NULL DEFAULT '',
      option_d TEXT NOT NULL DEFAULT '',
      correct_answer TEXT NOT NULL DEFAULT 'A',
      question_type TEXT DEFAULT 'multiple_choice',
      explanation TEXT DEFAULT '',
      example_sentence TEXT DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ---- MIGRATION: Add columns if they don't exist ----
  const columnsToAdd = [
    { table: 'topics', column: 'user_id', type: 'INTEGER DEFAULT 1' },
    { table: 'topics', column: 'is_review', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'topics', column: 'source_topic_id', type: 'INTEGER DEFAULT NULL' },
    { table: 'questions', column: 'question_type', type: "TEXT DEFAULT 'multiple_choice'" },
    { table: 'questions', column: 'explanation', type: "TEXT DEFAULT ''" },
    { table: 'questions', column: 'example_sentence', type: "TEXT DEFAULT ''" },
  ];

  for (const col of columnsToAdd) {
    try {
      await pool.query(`ALTER TABLE ${col.table} ADD COLUMN IF NOT EXISTS ${col.column} ${col.type}`);
    } catch (e) {
      // Ignore
    }
  }

  // Ensure default admin user exists
  const defaultUser = await queryOne('SELECT id FROM users WHERE id = 1');
  if (!defaultUser) {
    const hash = hashPassword('admin');
    await execute('INSERT INTO users (id, username, password_hash, display_name) VALUES (1, ?, ?, ?)',
      ['admin', hash, 'Admin']);
    console.log('  👤 Đã tạo user mặc định: admin / admin trên Supabase');
  }

  // Assign existing topics without user_id to default user
  await execute('UPDATE topics SET user_id = 1 WHERE user_id IS NULL');

  console.log('✅ Kết nối Supabase PostgreSQL thành công & Database đã sẵn sàng!');
}

// Middleware to initialize database before any API call
app.use('/api', async (req, res, next) => {
  try {
    await ensureDbInitialized();
    next();
  } catch (err) {
    console.error('Database init error:', err);
    res.status(500).json({ error: 'Lỗi kết nối cơ sở dữ liệu Supabase: ' + (err.message || String(err)) });
  }
});

// =============================================
// AUTH HELPERS
// =============================================
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'quizmaster_salt_2024').digest('hex');
}

function generateToken(userId) {
  const payload = `${userId}:${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload + 'token_secret').digest('hex').substring(0, 16);
  return Buffer.from(`${payload}:${hash}`).toString('base64');
}

async function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    const userId = parseInt(parts[0]);
    if (isNaN(userId)) return null;
    const user = await queryOne('SELECT id, username, display_name FROM users WHERE id = ?', [userId]);
    return user;
  } catch (e) {
    return null;
  }
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  }
  const token = authHeader.substring(7);
  const user = await verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
  }
  req.user = user;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.id !== 1) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này' });
  }
  next();
}

// =============================================
// API ROUTES — AUTH
// =============================================

// POST register
app.post('/api/auth/register', async (req, res) => {
  const { username, password, display_name } = req.body;

  if (!username || !username.trim() || username.trim().length < 3) {
    return res.status(400).json({ error: 'Tên đăng nhập phải có ít nhất 3 ký tự' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 4 ký tự' });
  }
  if (!display_name || !display_name.trim()) {
    return res.status(400).json({ error: 'Tên hiển thị không được để trống' });
  }

  const existing = await queryOne('SELECT id FROM users WHERE username = ?', [username.trim().toLowerCase()]);
  if (existing) {
    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }

  const hash = hashPassword(password);
  const id = await execute('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
    [username.trim().toLowerCase(), hash, display_name.trim()]);
  const token = generateToken(id);

  res.status(201).json({
    token,
    user: { id, username: username.trim().toLowerCase(), display_name: display_name.trim() }
  });
});

// POST login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
  }

  const hash = hashPassword(password);
  const user = await queryOne('SELECT id, username, display_name FROM users WHERE username = ? AND password_hash = ?',
    [username.trim().toLowerCase(), hash]);

  if (!user) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  }

  const token = generateToken(user.id);
  res.json({ token, user });
});

// GET current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// GET system status (check Supabase connection)
app.get('/api/status', async (req, res) => {
  let dbConnected = false;
  let dbError = null;
  try {
    await pool.query('SELECT 1');
    dbConnected = true;
  } catch (err) {
    dbError = err.message;
    console.error('Lỗi kiểm tra status Supabase:', err);
  }
  res.json({
    isVercel,
    database: 'Supabase PostgreSQL',
    connected: dbConnected,
    error: dbError
  });
});

// =============================================
// API ROUTES — SETTINGS
// =============================================

app.get('/api/settings/:key', authMiddleware, adminMiddleware, async (req, res) => {
  const setting = await queryOne('SELECT value FROM settings WHERE key = ?', [req.params.key]);
  res.json({ value: setting ? setting.value : '' });
});

app.put('/api/settings/:key', authMiddleware, adminMiddleware, async (req, res) => {
  const { value } = req.body;
  const existing = await queryOne('SELECT key FROM settings WHERE key = ?', [req.params.key]);
  if (existing) {
    await execute('UPDATE settings SET value = ? WHERE key = ?', [value || '', req.params.key]);
  } else {
    await execute('INSERT INTO settings (key, value) VALUES (?, ?)', [req.params.key, value || '']);
  }
  res.json({ success: true });
});

// =============================================
// API ROUTES — TOPICS (with user filtering)
// =============================================

// GET all topics for current user
app.get('/api/topics', authMiddleware, async (req, res) => {
  const topics = await queryAll(`
    SELECT t.*, COUNT(q.id) as question_count
    FROM topics t
    LEFT JOIN questions q ON q.topic_id = t.id
    WHERE t.user_id = ?
    GROUP BY t.id, t.name, t.description, t.user_id, t.created_at, t.is_review, t.source_topic_id
    ORDER BY t.is_review ASC, t.created_at DESC
  `, [req.user.id]);
  res.json(topics);
});

// GET single topic
app.get('/api/topics/:id', authMiddleware, async (req, res) => {
  const topic = await queryOne('SELECT * FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });
  res.json(topic);
});

// POST create topic
app.post('/api/topics', authMiddleware, async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên chủ đề không được để trống' });
  }
  const id = await execute('INSERT INTO topics (name, description, user_id) VALUES (?, ?, ?)', [name.trim(), description || '', req.user.id]);
  const topic = await queryOne('SELECT * FROM topics WHERE id = ?', [id]);
  res.status(201).json(topic);
});

// PUT update topic
app.put('/api/topics/:id', authMiddleware, async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên chủ đề không được để trống' });
  }
  const existing = await queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  await execute('UPDATE topics SET name = ?, description = ? WHERE id = ?', [name.trim(), description || '', Number(req.params.id)]);
  const topic = await queryOne('SELECT * FROM topics WHERE id = ?', [Number(req.params.id)]);
  res.json(topic);
});

// DELETE topic
app.delete('/api/topics/:id', authMiddleware, async (req, res) => {
  const existing = await queryOne('SELECT id, is_review FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  // Block non-admin users from deleting review topics
  if (existing.is_review && req.user.id !== 1) {
    return res.status(403).json({ error: 'Bạn không thể xóa chủ đề ôn lại. Hãy làm đúng tất cả câu hỏi để chủ đề tự động bị xóa!' });
  }

  await execute('DELETE FROM questions WHERE topic_id = ?', [Number(req.params.id)]);
  await execute('DELETE FROM topics WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Đã xóa chủ đề thành công' });
});

// =============================================
// API ROUTES — QUESTIONS
// =============================================

// GET questions by topic
app.get('/api/topics/:id/questions', authMiddleware, async (req, res) => {
  const topic = await queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  const questions = await queryAll('SELECT * FROM questions WHERE topic_id = ? ORDER BY created_at ASC', [Number(req.params.id)]);
  res.json(questions);
});

// POST add question to topic
app.post('/api/topics/:id/questions', authMiddleware, async (req, res) => {
  const { content, option_a, option_b, option_c, option_d, correct_answer, question_type, explanation, example_sentence } = req.body;
  const qType = question_type || 'multiple_choice';

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Nội dung câu hỏi không được để trống' });
  }

  if (qType === 'multiple_choice') {
    if (!option_a || !option_b || !option_c || !option_d) {
      return res.status(400).json({ error: 'Phải nhập đủ 4 phương án A, B, C, D' });
    }
    if (!['A', 'B', 'C', 'D'].includes(correct_answer)) {
      return res.status(400).json({ error: 'Đáp án đúng phải là A, B, C hoặc D' });
    }
  } else if (qType === 'essay') {
    if (!correct_answer || !correct_answer.trim()) {
      return res.status(400).json({ error: 'Phải nhập đáp án mẫu cho câu tự luận' });
    }
  }

  const topic = await queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  const id = await execute(
    `INSERT INTO questions (topic_id, content, option_a, option_b, option_c, option_d, correct_answer, question_type, explanation, example_sentence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(req.params.id),
      content.trim(),
      (option_a || '').trim(),
      (option_b || '').trim(),
      (option_c || '').trim(),
      (option_d || '').trim(),
      qType === 'essay' ? (correct_answer || '').trim() : (correct_answer || 'A'),
      qType,
      (explanation || '').trim(),
      (example_sentence || '').trim()
    ]
  );
  const question = await queryOne('SELECT * FROM questions WHERE id = ?', [id]);
  res.status(201).json(question);
});

// PUT update question
app.put('/api/questions/:id', authMiddleware, async (req, res) => {
  const { content, option_a, option_b, option_c, option_d, correct_answer, question_type, explanation, example_sentence } = req.body;
  const qType = question_type || 'multiple_choice';

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Nội dung câu hỏi không được để trống' });
  }

  if (qType === 'multiple_choice') {
    if (!option_a || !option_b || !option_c || !option_d) {
      return res.status(400).json({ error: 'Phải nhập đủ 4 phương án A, B, C, D' });
    }
    if (!['A', 'B', 'C', 'D'].includes(correct_answer)) {
      return res.status(400).json({ error: 'Đáp án đúng phải là A, B, C hoặc D' });
    }
  }

  const existing = await queryOne(`
    SELECT q.id FROM questions q
    JOIN topics t ON q.topic_id = t.id
    WHERE q.id = ? AND t.user_id = ?
  `, [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  await execute(
    `UPDATE questions SET content = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?,
     correct_answer = ?, question_type = ?, explanation = ?, example_sentence = ? WHERE id = ?`,
    [
      content.trim(),
      (option_a || '').trim(),
      (option_b || '').trim(),
      (option_c || '').trim(),
      (option_d || '').trim(),
      qType === 'essay' ? (correct_answer || '').trim() : (correct_answer || 'A'),
      qType,
      (explanation || '').trim(),
      (example_sentence || '').trim(),
      Number(req.params.id)
    ]
  );
  const question = await queryOne('SELECT * FROM questions WHERE id = ?', [Number(req.params.id)]);
  res.json(question);
});

// DELETE question
app.delete('/api/questions/:id', authMiddleware, async (req, res) => {
  const existing = await queryOne(`
    SELECT q.id FROM questions q
    JOIN topics t ON q.topic_id = t.id
    WHERE q.id = ? AND t.user_id = ?
  `, [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  await execute('DELETE FROM questions WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Đã xóa câu hỏi thành công' });
});

// =============================================
// API — PARSE WORD (.docx) FILE
// =============================================

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST parse Word document -> extract raw text
app.post('/api/parse-docx', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Vui lòng upload file .docx' });
  }

  try {
    const result = await mammoth.extractRawText({ buffer: req.file.buffer });
    const text = result.value || '';

    if (!text.trim()) {
      return res.status(400).json({ error: 'File Word không có nội dung text' });
    }

    res.json({ text, messages: result.messages || [] });
  } catch (err) {
    console.error('Error parsing .docx:', err);
    res.status(500).json({ error: 'Lỗi đọc file Word: ' + (err.message || String(err)) });
  }
});

// =============================================
// API — IMPORT / EXPORT QUESTIONS
// =============================================

// POST import questions from JSON
app.post('/api/topics/:id/import', authMiddleware, async (req, res) => {
  const { questions } = req.body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Dữ liệu import phải là mảng câu hỏi' });
  }

  const topic = await queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  let imported = 0;
  let errors = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    try {
      const qType = q.type || 'multiple_choice';
      if (!q.content || !q.content.trim()) {
        errors.push(`Câu ${i + 1}: Thiếu nội dung`);
        continue;
      }

      if (qType === 'multiple_choice') {
        if (!q.option_a || !q.option_b || !q.option_c || !q.option_d) {
          errors.push(`Câu ${i + 1}: Thiếu phương án`);
          continue;
        }
        if (!['A', 'B', 'C', 'D'].includes(q.correct_answer)) {
          errors.push(`Câu ${i + 1}: Đáp án đúng không hợp lệ`);
          continue;
        }
      } else if (qType === 'essay') {
        if (!q.correct_answer || !q.correct_answer.trim()) {
          errors.push(`Câu ${i + 1}: Thiếu đáp án mẫu`);
          continue;
        }
      }

      await execute(
        `INSERT INTO questions (topic_id, content, option_a, option_b, option_c, option_d, correct_answer, question_type, explanation, example_sentence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(req.params.id),
          q.content.trim(),
          (q.option_a || '').trim(),
          (q.option_b || '').trim(),
          (q.option_c || '').trim(),
          (q.option_d || '').trim(),
          (q.correct_answer || 'A').trim(),
          qType,
          (q.explanation || '').trim(),
          (q.example_sentence || '').trim()
        ]
      );
      imported++;
    } catch (e) {
      errors.push(`Câu ${i + 1}: ${e.message}`);
    }
  }

  res.json({
    message: `Đã import ${imported}/${questions.length} câu hỏi`,
    imported,
    total: questions.length,
    errors
  });
});

// GET export questions as JSON
app.get('/api/topics/:id/export', authMiddleware, async (req, res) => {
  const topic = await queryOne('SELECT * FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  const questions = await queryAll('SELECT * FROM questions WHERE topic_id = ? ORDER BY created_at ASC', [Number(req.params.id)]);

  const exported = questions.map(q => {
    const base = {
      type: q.question_type || 'multiple_choice',
      content: q.content,
      correct_answer: q.correct_answer,
      explanation: q.explanation || '',
      example_sentence: q.example_sentence || ''
    };
    if (base.type === 'multiple_choice') {
      base.option_a = q.option_a;
      base.option_b = q.option_b;
      base.option_c = q.option_c;
      base.option_d = q.option_d;
    }
    return base;
  });

  res.json({ topic_name: topic.name, questions: exported });
});

// =============================================
// API ROUTE — QUIZ (with shuffling)
// =============================================

app.get('/api/topics/:id/quiz', authMiddleware, async (req, res) => {
  const topic = await queryOne('SELECT id, name FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  const questions = await queryAll('SELECT * FROM questions WHERE topic_id = ?', [Number(req.params.id)]);

  if (questions.length === 0) {
    return res.status(400).json({ error: 'Chủ đề này chưa có câu hỏi nào' });
  }

  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const quizQuestions = shuffled.map(q => {
    const qType = q.question_type || 'multiple_choice';

    if (qType === 'essay') {
      return {
        id: q.id,
        content: q.content,
        question_type: 'essay',
        correct_answer: q.correct_answer,
        explanation: q.explanation || '',
        example_sentence: q.example_sentence || '',
        topic_name: topic.name,
      };
    }

    const options = [
      { key: 'A', text: q.option_a },
      { key: 'B', text: q.option_b },
      { key: 'C', text: q.option_c },
      { key: 'D', text: q.option_d },
    ];

    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    const correctOptionText = q[`option_${q.correct_answer.toLowerCase()}`];
    const correctIndex = options.findIndex(o => o.text === correctOptionText);
    const labels = ['A', 'B', 'C', 'D'];

    return {
      id: q.id,
      content: q.content,
      question_type: 'multiple_choice',
      options: options.map((o, idx) => ({
        label: labels[idx],
        text: o.text,
      })),
      correct_answer: labels[correctIndex],
      explanation: q.explanation || '',
      example_sentence: q.example_sentence || '',
      topic_name: topic.name,
    };
  });

  res.json(quizQuestions);
});

// GET combined quiz across all (or selected) topics of current user
app.get('/api/quiz/all', authMiddleware, async (req, res) => {
  let querySql = `
    SELECT q.*, t.name as topic_name
    FROM questions q
    JOIN topics t ON q.topic_id = t.id
    WHERE t.user_id = ?
  `;
  const params = [req.user.id];

  if (req.query.topics && req.query.topics.trim()) {
    const topicIds = req.query.topics.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
    if (topicIds.length > 0) {
      const placeholders = topicIds.map(() => '?').join(',');
      querySql += ` AND t.id IN (${placeholders})`;
      params.push(...topicIds);
    }
  }

  const questions = await queryAll(querySql, params);

  if (questions.length === 0) {
    return res.status(400).json({ error: 'Các chủ đề được chọn chưa có câu hỏi nào' });
  }

  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const quizQuestions = shuffled.map(q => {
    const qType = q.question_type || 'multiple_choice';

    if (qType === 'essay') {
      return {
        id: q.id,
        content: q.content,
        question_type: 'essay',
        correct_answer: q.correct_answer,
        explanation: q.explanation || '',
        example_sentence: q.example_sentence || '',
        topic_name: q.topic_name || '',
      };
    }

    const options = [
      { key: 'A', text: q.option_a },
      { key: 'B', text: q.option_b },
      { key: 'C', text: q.option_c },
      { key: 'D', text: q.option_d },
    ];

    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    const correctOptionText = q[`option_${q.correct_answer.toLowerCase()}`];
    const correctIndex = options.findIndex(o => o.text === correctOptionText);
    const labels = ['A', 'B', 'C', 'D'];

    return {
      id: q.id,
      content: q.content,
      question_type: 'multiple_choice',
      options: options.map((o, idx) => ({
        label: labels[idx],
        text: o.text,
      })),
      correct_answer: labels[correctIndex],
      explanation: q.explanation || '',
      example_sentence: q.example_sentence || '',
      topic_name: q.topic_name || '',
    };
  });

  res.json(quizQuestions);
});

// =============================================
// API — AI GRADING & REVIEW (Google Gemini)
// =============================================

// Helper to call Google Gemini API with clear error handling & Vietnamese translation
async function callGeminiApi(prompt, apiKey, temperature = 0.3) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error('Gemini API error status:', response.status, errText);
    let rawMsg = 'AI API lỗi';
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error && errJson.error.message) {
        rawMsg = errJson.error.message;
      }
    } catch (e) {
      rawMsg = errText || 'Lỗi kết nối AI';
    }

    // Translate specific quota and API key errors to friendly Vietnamese
    if (response.status === 429 || rawMsg.includes('Quota exceeded') || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('free_tier_requests') || rawMsg.includes('rate-limit')) {
      let retryHint = 'Vui lòng chờ khoảng 30 - 60 giây rồi thử lại';
      const matchRetry = rawMsg.match(/retry in ([0-9.]+)s/i);
      if (matchRetry && matchRetry[1]) {
        const secs = Math.ceil(parseFloat(matchRetry[1]));
        retryHint = `Vui lòng thử lại sau khoảng ${secs} giây`;
      }
      throw new Error(`⏳ Bạn đã vượt quá giới hạn lượt dùng miễn phí (Free Tier Quota) của Google Gemini (${retryHint}). Hoặc bạn có thể sử dụng API Key khác / nâng cấp tài khoản Google AI lên trả phí (Pay-as-you-go).`);
    } else if (response.status === 400 || response.status === 403 || rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('API key not valid')) {
      throw new Error('❌ API Key Google Gemini không hợp lệ hoặc đã bị thu hồi. Vui lòng vào mục Cài đặt để kiểm tra và cập nhật lại API Key!');
    } else {
      throw new Error(`⚠️ Lỗi từ Google AI (${response.status}): ${rawMsg}`);
    }
  }

  const data = await response.json();
  const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return aiText;
}

app.post('/api/ai/grade', authMiddleware, async (req, res) => {
  const { question, correct_answer, student_answer, explanation, example_sentence } = req.body;

  if (!student_answer || !student_answer.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập đáp án' });
  }

  const setting = await queryOne("SELECT value FROM settings WHERE key = 'gemini_api_key'");
  const apiKey = setting ? setting.value : '';

  if (!apiKey) {
    const normalize = (s) => s.toLowerCase().trim().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
    const studentNorm = normalize(student_answer);
    const correctNorm = normalize(correct_answer);

    const isExact = studentNorm === correctNorm;
    const studentWords = new Set(studentNorm.split(' '));
    const correctWords = new Set(correctNorm.split(' '));
    let matches = 0;
    for (const w of correctWords) {
      if (studentWords.has(w)) matches++;
    }
    const similarity = correctWords.size > 0 ? Math.round((matches / correctWords.size) * 100) : 0;
    const isClose = similarity >= 70;

    return res.json({
      is_correct: isExact || isClose,
      score: isExact ? 100 : similarity,
      feedback: isExact
        ? '✅ Chính xác!'
        : isClose
          ? `👍 Gần đúng! (${similarity}% trùng khớp). Đáp án mẫu: "${correct_answer}"`
          : `❌ Chưa đúng. Đáp án mẫu: "${correct_answer}"`,
      explanation: explanation || '',
      example_sentence: example_sentence || '',
      ai_powered: false,
    });
  }

  try {
    const prompt = `You are a language teacher grading a student's answer. Compare the student's answer with the correct answer.

Question: ${question}
Correct Answer: ${correct_answer}
Student's Answer: ${student_answer}

Consider the answer correct if the meaning is the same, even if the wording is slightly different. Minor spelling mistakes or synonyms should still be considered correct or partially correct.

Respond ONLY with a valid JSON object (no markdown, no code blocks):
{"is_correct": true or false, "score": 0 to 100, "feedback": "brief feedback in Vietnamese explaining why the answer is correct or what the student got wrong"}`;

    const aiText = await callGeminiApi(prompt, apiKey, 0.3);

    let aiResult;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      aiResult = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch (e) {
      aiResult = { is_correct: false, score: 0, feedback: 'Không thể phân tích kết quả AI. ' + aiText };
    }

    res.json({
      is_correct: aiResult.is_correct || false,
      score: aiResult.score || 0,
      feedback: aiResult.feedback || '',
      explanation: explanation || '',
      example_sentence: example_sentence || '',
      ai_powered: true,
    });
  } catch (err) {
    console.error('AI grading error:', err.message);
    const normalize = (s) => s.toLowerCase().trim().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
    const isExact = normalize(student_answer) === normalize(correct_answer);

    let fallbackMsg = isExact ? '✅ Chính xác!' : `❌ Đáp án mẫu: "${correct_answer}" (AI tạm thời không khả dụng: ${err.message})`;
    if (err.message && (err.message.includes('vượt quá giới hạn') || err.message.includes('API Key') || err.message.includes('Lỗi từ Google AI'))) {
      fallbackMsg = `${isExact ? '✅ Chính xác!' : `❌ Đáp án mẫu: "${correct_answer}"`} \n\n${err.message}`;
    }

    res.json({
      is_correct: isExact,
      score: isExact ? 100 : 0,
      feedback: fallbackMsg,
      explanation: explanation || '',
      example_sentence: example_sentence || '',
      ai_powered: false,
    });
  }
});

app.post('/api/ai/review', authMiddleware, async (req, res) => {
  const { word, context, user_text } = req.body;

  if (!user_text || !user_text.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập ví dụ hoặc giải thích của bạn' });
  }

  const setting = await queryOne("SELECT value FROM settings WHERE key = 'gemini_api_key'");
  const apiKey = setting ? setting.value : '';

  if (!apiKey) {
    return res.json({
      review: '⚠️ Chưa cài đặt API Key. Vui lòng vào Cài đặt để nhập Gemini API Key để AI có thể nhận xét bài viết của bạn.',
      ai_powered: false,
    });
  }

  try {
    const prompt = `You are a friendly and encouraging English language teacher. A student just answered a quiz question about the word/phrase: "${word || 'unknown'}".
${context ? `Context of the question: ${context}` : ''}

The student wrote the following example or explanation about this word/phrase:
"${user_text}"

Please review their writing and provide helpful feedback IN VIETNAMESE. Your review should:
1. Comment on whether the example/explanation is correct and relevant
2. Point out any grammar or spelling mistakes if any
3. Suggest improvements if needed
4. Be encouraging and constructive

Keep your response concise (2-4 sentences). Do NOT grade or give a score — just provide a friendly review/comment.

Respond ONLY with a valid JSON object (no markdown, no code blocks):
{"review": "your review text in Vietnamese"}`;

    const aiText = await callGeminiApi(prompt, apiKey, 0.5);

    let aiResult;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      aiResult = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch (e) {
      aiResult = { review: aiText || 'Không thể phân tích phản hồi từ AI.' };
    }

    res.json({
      review: aiResult.review || 'Không có nhận xét.',
      ai_powered: true,
    });
  } catch (err) {
    console.error('AI review error:', err.message);
    res.json({
      review: err.message,
      ai_powered: false,
    });
  }
});

// =============================================
// REVIEW TOPICS API
// =============================================

// POST create review topic from wrong answers
app.post('/api/topics/:id/review', authMiddleware, async (req, res) => {
  const { wrong_question_ids, round } = req.body;

  if (!Array.isArray(wrong_question_ids) || wrong_question_ids.length === 0) {
    return res.status(400).json({ error: 'Không có câu hỏi sai để tạo chủ đề ôn lại' });
  }

  // Get source topic info
  const sourceTopic = await queryOne('SELECT id, name, is_review, source_topic_id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  
  // For combined quiz (all topics), create a general review topic
  let reviewName;
  let sourceId;
  if (!sourceTopic) {
    // Combined quiz mode — use a generic name
    reviewName = `📌 Ôn lại: Tổng hợp (lần ${round || 1})`;
    sourceId = null;
  } else {
    // Get the original topic name (trace back through review chain)
    let originalName = sourceTopic.name;
    if (sourceTopic.is_review && sourceTopic.source_topic_id) {
      const original = await queryOne('SELECT name FROM topics WHERE id = ?', [sourceTopic.source_topic_id]);
      if (original) originalName = original.name;
    }
    // Clean up the original name (remove existing 📌 prefix)
    originalName = originalName.replace(/^📌 Ôn lại: /g, '').replace(/ \(lần \d+\)$/g, '');
    reviewName = `📌 Ôn lại: ${originalName} (lần ${round || 1})`;
    sourceId = sourceTopic.is_review ? (sourceTopic.source_topic_id || sourceTopic.id) : sourceTopic.id;
  }

  // Create the review topic
  const reviewTopicId = await execute(
    'INSERT INTO topics (name, description, user_id, is_review, source_topic_id) VALUES (?, ?, ?, ?, ?)',
    [reviewName, 'Chủ đề ôn lại tự động — làm đúng hết để xóa!', req.user.id, true, sourceId]
  );

  // Copy wrong questions into the review topic
  let copied = 0;
  for (const qId of wrong_question_ids) {
    const q = await queryOne('SELECT * FROM questions WHERE id = ?', [Number(qId)]);
    if (q) {
      await execute(
        `INSERT INTO questions (topic_id, content, option_a, option_b, option_c, option_d, correct_answer, question_type, explanation, example_sentence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reviewTopicId,
          q.content,
          q.option_a || '',
          q.option_b || '',
          q.option_c || '',
          q.option_d || '',
          q.correct_answer,
          q.question_type || 'multiple_choice',
          q.explanation || '',
          q.example_sentence || ''
        ]
      );
      copied++;
    }
  }

  const reviewTopic = await queryOne('SELECT * FROM topics WHERE id = ?', [reviewTopicId]);
  res.status(201).json({
    message: `Đã tạo chủ đề ôn lại với ${copied} câu hỏi sai`,
    topic: reviewTopic,
    copied
  });
});

// POST complete review topic (auto-delete if 100% correct)
app.post('/api/review-topics/:id/complete', authMiddleware, async (req, res) => {
  const topic = await queryOne('SELECT id, is_review FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });
  if (!topic.is_review) return res.status(400).json({ error: 'Chủ đề này không phải chủ đề ôn lại' });

  // Delete the review topic and its questions
  await execute('DELETE FROM questions WHERE topic_id = ?', [Number(req.params.id)]);
  await execute('DELETE FROM topics WHERE id = ?', [Number(req.params.id)]);

  res.json({ message: '🎉 Chúc mừng! Bạn đã hoàn thành ôn lại! Chủ đề ôn lại đã được xóa tự động.', deleted: true });
});

// =============================================
// ADMIN API ROUTES
// =============================================

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const users = await queryAll(`
    SELECT u.id, u.username, u.display_name, u.created_at,
           COUNT(DISTINCT t.id) as topic_count,
           COUNT(DISTINCT q.id) as question_count
    FROM users u
    LEFT JOIN topics t ON t.user_id = u.id
    LEFT JOIN questions q ON q.topic_id = t.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  res.json(users);
});

app.get('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const userId = Number(req.params.id);
  const user = await queryOne('SELECT id, username, display_name, created_at FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

  const topics = await queryAll(`
    SELECT t.*, COUNT(q.id) as question_count
    FROM topics t
    LEFT JOIN questions q ON q.topic_id = t.id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `, [userId]);

  const topicsWithQuestions = await Promise.all(topics.map(async t => {
    const questions = await queryAll('SELECT * FROM questions WHERE topic_id = ? ORDER BY created_at ASC', [t.id]);
    return { ...t, questions };
  }));

  res.json({
    user,
    topics: topicsWithQuestions,
  });
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const userId = Number(req.params.id);

  if (userId === 1) {
    return res.status(400).json({ error: 'Không thể xóa tài khoản admin' });
  }

  const user = await queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

  const userTopics = await queryAll('SELECT id FROM topics WHERE user_id = ?', [userId]);
  for (const t of userTopics) {
    await execute('DELETE FROM questions WHERE topic_id = ?', [t.id]);
  }
  await execute('DELETE FROM topics WHERE user_id = ?', [userId]);
  await execute('DELETE FROM users WHERE id = ?', [userId]);

  res.json({ message: 'Đã xóa người dùng thành công' });
});

// Admin: Force delete any review topic
app.delete('/api/admin/review-topics/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const topic = await queryOne('SELECT id, is_review, user_id FROM topics WHERE id = ?', [Number(req.params.id)]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  await execute('DELETE FROM questions WHERE topic_id = ?', [Number(req.params.id)]);
  await execute('DELETE FROM topics WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Admin đã xóa chủ đề ôn lại thành công' });
});

// Admin: Get all review topics across all users
app.get('/api/admin/review-topics', authMiddleware, adminMiddleware, async (req, res) => {
  const topics = await queryAll(`
    SELECT t.*, u.display_name as owner_name, u.username as owner_username, COUNT(q.id) as question_count
    FROM topics t
    JOIN users u ON t.user_id = u.id
    LEFT JOIN questions q ON q.topic_id = t.id
    WHERE t.is_review = TRUE
    GROUP BY t.id, t.name, t.description, t.user_id, t.created_at, t.is_review, t.source_topic_id, u.display_name, u.username
    ORDER BY t.created_at DESC
  `);
  res.json(topics);
});

// =============================================
// FALLBACK — Serve index.html for SPA
// =============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================
// START SERVER
// =============================================
async function start() {
  await ensureDbInitialized();

  app.listen(PORT, () => {
    console.log(`\n🚀 Quiz App đang chạy tại: http://localhost:${PORT}`);
    console.log(`📁 Database: Supabase PostgreSQL`);
    console.log(`⏹  Nhấn Ctrl+C để dừng server\n`);
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('❌ Lỗi khởi động:', err);
    process.exit(1);
  });
}

module.exports = app;
