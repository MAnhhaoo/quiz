const express = require('express');
const initSqlJs = require('sql.js');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// DATABASE SETUP (sql.js — pure JS SQLite)
// =============================================
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || process.env.NODE_ENV === 'production';
const DB_PATH = isVercel ? path.join('/tmp', 'quiz.db') : path.join(__dirname, 'quiz.db');
let db;

// Save database to file
function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Lỗi lưu database:', err.message);
  }
}

// Auto-save every 5 seconds if there are changes
let dbDirty = false;
function markDirty() {
  dbDirty = true;
}
setInterval(() => {
  if (dbDirty) {
    saveDb();
    dbDirty = false;
  }
}, 5000);

let dbInitPromise = null;
function ensureDbInitialized() {
  if (!dbInitPromise) {
    dbInitPromise = initDatabase();
  }
  return dbInitPromise;
}

// Ensure database is ready before handling any API request
app.use('/api', async (req, res, next) => {
  try {
    await ensureDbInitialized();
    next();
  } catch (err) {
    console.error('Database init error:', err);
    res.status(500).json({ error: 'Lỗi khởi tạo cơ sở dữ liệu' });
  }
});

async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log(`✅ Đã tải database từ file ${DB_PATH}`);
  } else if (isVercel && fs.existsSync(path.join(__dirname, 'quiz.db'))) {
    // In Vercel serverless, read original bundled quiz.db and copy to /tmp
    const fileBuffer = fs.readFileSync(path.join(__dirname, 'quiz.db'));
    db = new SQL.Database(fileBuffer);
    console.log('✅ Đã tải database gốc từ quiz.db vào /tmp');
    saveDb();
  } else {
    db = new SQL.Database();
    console.log('✅ Đã tạo database mới');
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      option_a TEXT NOT NULL DEFAULT '',
      option_b TEXT NOT NULL DEFAULT '',
      option_c TEXT NOT NULL DEFAULT '',
      option_d TEXT NOT NULL DEFAULT '',
      correct_answer TEXT NOT NULL DEFAULT 'A',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // ---- MIGRATION: Add new columns if they don't exist ----
  // We use try/catch because ALTER TABLE errors if column already exists
  const columnsToAdd = [
    { table: 'topics', column: 'user_id', type: 'INTEGER DEFAULT 1' },
    { table: 'questions', column: 'question_type', type: "TEXT DEFAULT 'multiple_choice'" },
    { table: 'questions', column: 'explanation', type: "TEXT DEFAULT ''" },
    { table: 'questions', column: 'example_sentence', type: "TEXT DEFAULT ''" },
  ];

  for (const col of columnsToAdd) {
    try {
      db.run(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.type}`);
      console.log(`  ➕ Đã thêm cột ${col.column} vào bảng ${col.table}`);
    } catch (e) {
      // Column already exists — ignore
    }
  }

  // Ensure default user exists (for migrating old data)
  const defaultUser = queryOne('SELECT id FROM users WHERE id = 1');
  if (!defaultUser) {
    const hash = hashPassword('admin');
    execute('INSERT INTO users (id, username, password_hash, display_name) VALUES (1, ?, ?, ?)',
      ['admin', hash, 'Admin']);
    console.log('  👤 Đã tạo user mặc định: admin / admin');
  }

  // Assign existing topics without user_id to default user
  execute('UPDATE topics SET user_id = 1 WHERE user_id IS NULL');

  saveDb();
  console.log('✅ Database đã sẵn sàng.');
}

// =============================================
// DB HELPERS
// =============================================
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function execute(sql, params = []) {
  db.run(sql, params);
  markDirty();
}

function lastInsertId() {
  const row = queryOne('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

// =============================================
// AUTH HELPERS
// =============================================
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'quizmaster_salt_2024').digest('hex');
}

// Simple token: base64(userId:timestamp:hash)
function generateToken(userId) {
  const payload = `${userId}:${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload + 'token_secret').digest('hex').substring(0, 16);
  return Buffer.from(`${payload}:${hash}`).toString('base64');
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    const userId = parseInt(parts[0]);
    if (isNaN(userId)) return null;
    const user = queryOne('SELECT id, username, display_name FROM users WHERE id = ?', [userId]);
    return user;
  } catch (e) {
    return null;
  }
}

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  }
  const token = authHeader.substring(7);
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
  }
  req.user = user;
  next();
}

// =============================================
// API ROUTES — AUTH
// =============================================

// POST register
app.post('/api/auth/register', (req, res) => {
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

  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username.trim().toLowerCase()]);
  if (existing) {
    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }

  const hash = hashPassword(password);
  execute('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
    [username.trim().toLowerCase(), hash, display_name.trim()]);
  const id = lastInsertId();
  const token = generateToken(id);
  saveDb();

  res.status(201).json({
    token,
    user: { id, username: username.trim().toLowerCase(), display_name: display_name.trim() }
  });
});

// POST login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
  }

  const hash = hashPassword(password);
  const user = queryOne('SELECT id, username, display_name FROM users WHERE username = ? AND password_hash = ?',
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

// =============================================
// API ROUTES — SETTINGS
// =============================================

app.get('/api/settings/:key', authMiddleware, (req, res) => {
  const setting = queryOne('SELECT value FROM settings WHERE key = ?', [req.params.key]);
  res.json({ value: setting ? setting.value : '' });
});

app.put('/api/settings/:key', authMiddleware, (req, res) => {
  const { value } = req.body;
  const existing = queryOne('SELECT key FROM settings WHERE key = ?', [req.params.key]);
  if (existing) {
    execute('UPDATE settings SET value = ? WHERE key = ?', [value || '', req.params.key]);
  } else {
    execute('INSERT INTO settings (key, value) VALUES (?, ?)', [req.params.key, value || '']);
  }
  saveDb();
  res.json({ success: true });
});

// =============================================
// API ROUTES — TOPICS (with user filtering)
// =============================================

// GET all topics for current user
app.get('/api/topics', authMiddleware, (req, res) => {
  const topics = queryAll(`
    SELECT t.*, COUNT(q.id) as question_count
    FROM topics t
    LEFT JOIN questions q ON q.topic_id = t.id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `, [req.user.id]);
  res.json(topics);
});

// GET single topic
app.get('/api/topics/:id', authMiddleware, (req, res) => {
  const topic = queryOne('SELECT * FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });
  res.json(topic);
});

// POST create topic
app.post('/api/topics', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên chủ đề không được để trống' });
  }
  execute('INSERT INTO topics (name, description, user_id) VALUES (?, ?, ?)', [name.trim(), description || '', req.user.id]);
  const id = lastInsertId();
  const topic = queryOne('SELECT * FROM topics WHERE id = ?', [id]);
  saveDb();
  res.status(201).json(topic);
});

// PUT update topic
app.put('/api/topics/:id', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên chủ đề không được để trống' });
  }
  const existing = queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  execute('UPDATE topics SET name = ?, description = ? WHERE id = ?', [name.trim(), description || '', Number(req.params.id)]);
  const topic = queryOne('SELECT * FROM topics WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json(topic);
});

// DELETE topic
app.delete('/api/topics/:id', authMiddleware, (req, res) => {
  const existing = queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  execute('DELETE FROM questions WHERE topic_id = ?', [Number(req.params.id)]);
  execute('DELETE FROM topics WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json({ message: 'Đã xóa chủ đề thành công' });
});

// =============================================
// API ROUTES — QUESTIONS
// =============================================

// GET questions by topic
app.get('/api/topics/:id/questions', authMiddleware, (req, res) => {
  // Verify topic belongs to user
  const topic = queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  const questions = queryAll('SELECT * FROM questions WHERE topic_id = ? ORDER BY created_at ASC', [Number(req.params.id)]);
  res.json(questions);
});

// POST add question to topic
app.post('/api/topics/:id/questions', authMiddleware, (req, res) => {
  const { content, option_a, option_b, option_c, option_d, correct_answer, question_type, explanation, example_sentence } = req.body;
  const qType = question_type || 'multiple_choice';

  // Validation
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
      return res.status(400).json({ error: 'Đáp án mẫu không được để trống' });
    }
  }

  // Check topic belongs to user
  const topic = queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  execute(
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
  const id = lastInsertId();
  const question = queryOne('SELECT * FROM questions WHERE id = ?', [id]);
  saveDb();
  res.status(201).json(question);
});

// PUT update question
app.put('/api/questions/:id', authMiddleware, (req, res) => {
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

  // Verify question exists and belongs to user's topic
  const existing = queryOne(`
    SELECT q.id FROM questions q
    JOIN topics t ON q.topic_id = t.id
    WHERE q.id = ? AND t.user_id = ?
  `, [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  execute(
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
  const question = queryOne('SELECT * FROM questions WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json(question);
});

// DELETE question
app.delete('/api/questions/:id', authMiddleware, (req, res) => {
  const existing = queryOne(`
    SELECT q.id FROM questions q
    JOIN topics t ON q.topic_id = t.id
    WHERE q.id = ? AND t.user_id = ?
  `, [Number(req.params.id), req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  execute('DELETE FROM questions WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json({ message: 'Đã xóa câu hỏi thành công' });
});

// =============================================
// API — IMPORT / EXPORT QUESTIONS
// =============================================

// POST import questions from JSON
app.post('/api/topics/:id/import', authMiddleware, (req, res) => {
  const { questions } = req.body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Dữ liệu import phải là mảng câu hỏi' });
  }

  const topic = queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
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

      execute(
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

  saveDb();
  res.json({
    message: `Đã import ${imported}/${questions.length} câu hỏi`,
    imported,
    total: questions.length,
    errors
  });
});

// GET export questions as JSON
app.get('/api/topics/:id/export', authMiddleware, (req, res) => {
  const topic = queryOne('SELECT * FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  const questions = queryAll('SELECT * FROM questions WHERE topic_id = ? ORDER BY created_at ASC', [Number(req.params.id)]);

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

app.get('/api/topics/:id/quiz', authMiddleware, (req, res) => {
  const topic = queryOne('SELECT id FROM topics WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  const questions = queryAll('SELECT * FROM questions WHERE topic_id = ?', [Number(req.params.id)]);

  if (questions.length === 0) {
    return res.status(400).json({ error: 'Chủ đề này chưa có câu hỏi nào' });
  }

  // Fisher-Yates shuffle for questions order
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
      };
    }

    // Multiple choice — shuffle options
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
    };
  });

  res.json(quizQuestions);
});

// =============================================
// API — AI GRADING (Google Gemini)
// =============================================

app.post('/api/ai/grade', authMiddleware, async (req, res) => {
  const { question, correct_answer, student_answer, explanation, example_sentence } = req.body;

  if (!student_answer || !student_answer.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập đáp án' });
  }

  // Get API key from settings
  const setting = queryOne("SELECT value FROM settings WHERE key = 'gemini_api_key'");
  const apiKey = setting ? setting.value : '';

  if (!apiKey) {
    // Fallback: simple string comparison
    const normalize = (s) => s.toLowerCase().trim().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
    const studentNorm = normalize(student_answer);
    const correctNorm = normalize(correct_answer);

    const isExact = studentNorm === correctNorm;

    // Simple similarity check
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

  // Use Gemini API
  try {
    const prompt = `You are a language teacher grading a student's answer. Compare the student's answer with the correct answer.

Question: ${question}
Correct Answer: ${correct_answer}
Student's Answer: ${student_answer}

Consider the answer correct if the meaning is the same, even if the wording is slightly different. Minor spelling mistakes or synonyms should still be considered correct or partially correct.

Respond ONLY with a valid JSON object (no markdown, no code blocks):
{"is_correct": true or false, "score": 0 to 100, "feedback": "brief feedback in Vietnamese explaining why the answer is correct or what the student got wrong"}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', errText);
      throw new Error('AI API lỗi');
    }

    const data = await response.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from AI response
    let aiResult;
    try {
      // Try to extract JSON from the response
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
    // Fallback to simple comparison
    const normalize = (s) => s.toLowerCase().trim().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
    const isExact = normalize(student_answer) === normalize(correct_answer);

    res.json({
      is_correct: isExact,
      score: isExact ? 100 : 0,
      feedback: isExact ? '✅ Chính xác!' : `❌ Đáp án mẫu: "${correct_answer}" (AI không khả dụng, dùng so sánh trực tiếp)`,
      explanation: explanation || '',
      example_sentence: example_sentence || '',
      ai_powered: false,
    });
  }
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
    console.log(`📁 Database: ${DB_PATH}`);
    console.log(`⏹  Nhấn Ctrl+C để dừng server\n`);
  });

  process.on('SIGINT', () => {
    console.log('\n💾 Đang lưu database...');
    saveDb();
    console.log('👋 Tạm biệt!');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    saveDb();
    process.exit(0);
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('❌ Lỗi khởi động:', err);
    process.exit(1);
  });
}

module.exports = app;
