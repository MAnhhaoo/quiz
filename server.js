const express = require('express');
const initSqlJs = require('sql.js');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// DATABASE SETUP (sql.js — pure JS SQLite)
// =============================================
const DB_PATH = path.join(__dirname, 'quiz.db');
let db;

// Save database to file
function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
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

async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Đã tải database từ file quiz.db');
  } else {
    db = new SQL.Database();
    console.log('✅ Đã tạo database mới');
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables if they don't exist
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
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_answer TEXT NOT NULL CHECK(correct_answer IN ('A','B','C','D')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `);

  saveDb();
  console.log('✅ Database đã sẵn sàng.');
}

// Helper: run a SELECT query and return rows as array of objects
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

// Helper: run a SELECT query and return first row as object
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run INSERT/UPDATE/DELETE
function execute(sql, params = []) {
  db.run(sql, params);
  markDirty();
}

// Helper: get last inserted row ID
function lastInsertId() {
  const row = queryOne('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

// =============================================
// API ROUTES — TOPICS
// =============================================

// GET all topics (with question count)
app.get('/api/topics', (req, res) => {
  const topics = queryAll(`
    SELECT t.*, COUNT(q.id) as question_count
    FROM topics t
    LEFT JOIN questions q ON q.topic_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `);
  res.json(topics);
});

// GET single topic
app.get('/api/topics/:id', (req, res) => {
  const topic = queryOne('SELECT * FROM topics WHERE id = ?', [Number(req.params.id)]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });
  res.json(topic);
});

// POST create topic
app.post('/api/topics', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên chủ đề không được để trống' });
  }
  execute('INSERT INTO topics (name, description) VALUES (?, ?)', [name.trim(), description || '']);
  const id = lastInsertId();
  const topic = queryOne('SELECT * FROM topics WHERE id = ?', [id]);
  saveDb();
  res.status(201).json(topic);
});

// PUT update topic
app.put('/api/topics/:id', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên chủ đề không được để trống' });
  }
  const existing = queryOne('SELECT id FROM topics WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  execute('UPDATE topics SET name = ?, description = ? WHERE id = ?', [name.trim(), description || '', Number(req.params.id)]);
  const topic = queryOne('SELECT * FROM topics WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json(topic);
});

// DELETE topic (cascade deletes questions)
app.delete('/api/topics/:id', (req, res) => {
  const existing = queryOne('SELECT id FROM topics WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  // Manual cascade since sql.js foreign key cascade may not work reliably
  execute('DELETE FROM questions WHERE topic_id = ?', [Number(req.params.id)]);
  execute('DELETE FROM topics WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json({ message: 'Đã xóa chủ đề thành công' });
});

// =============================================
// API ROUTES — QUESTIONS
// =============================================

// GET questions by topic
app.get('/api/topics/:id/questions', (req, res) => {
  const questions = queryAll('SELECT * FROM questions WHERE topic_id = ? ORDER BY created_at ASC', [Number(req.params.id)]);
  res.json(questions);
});

// POST add question to topic
app.post('/api/topics/:id/questions', (req, res) => {
  const { content, option_a, option_b, option_c, option_d, correct_answer } = req.body;

  // Validation
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Nội dung câu hỏi không được để trống' });
  }
  if (!option_a || !option_b || !option_c || !option_d) {
    return res.status(400).json({ error: 'Phải nhập đủ 4 phương án A, B, C, D' });
  }
  if (!['A', 'B', 'C', 'D'].includes(correct_answer)) {
    return res.status(400).json({ error: 'Đáp án đúng phải là A, B, C hoặc D' });
  }

  // Check topic exists
  const topic = queryOne('SELECT id FROM topics WHERE id = ?', [Number(req.params.id)]);
  if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề' });

  execute(
    'INSERT INTO questions (topic_id, content, option_a, option_b, option_c, option_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [Number(req.params.id), content.trim(), option_a.trim(), option_b.trim(), option_c.trim(), option_d.trim(), correct_answer]
  );
  const id = lastInsertId();
  const question = queryOne('SELECT * FROM questions WHERE id = ?', [id]);
  saveDb();
  res.status(201).json(question);
});

// PUT update question
app.put('/api/questions/:id', (req, res) => {
  const { content, option_a, option_b, option_c, option_d, correct_answer } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Nội dung câu hỏi không được để trống' });
  }
  if (!option_a || !option_b || !option_c || !option_d) {
    return res.status(400).json({ error: 'Phải nhập đủ 4 phương án A, B, C, D' });
  }
  if (!['A', 'B', 'C', 'D'].includes(correct_answer)) {
    return res.status(400).json({ error: 'Đáp án đúng phải là A, B, C hoặc D' });
  }

  const existing = queryOne('SELECT id FROM questions WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  execute(
    'UPDATE questions SET content = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, correct_answer = ? WHERE id = ?',
    [content.trim(), option_a.trim(), option_b.trim(), option_c.trim(), option_d.trim(), correct_answer, Number(req.params.id)]
  );
  const question = queryOne('SELECT * FROM questions WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json(question);
});

// DELETE question
app.delete('/api/questions/:id', (req, res) => {
  const existing = queryOne('SELECT id FROM questions WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  execute('DELETE FROM questions WHERE id = ?', [Number(req.params.id)]);
  saveDb();
  res.json({ message: 'Đã xóa câu hỏi thành công' });
});

// =============================================
// API ROUTE — QUIZ (with shuffling)
// =============================================

// GET shuffled quiz for a topic
app.get('/api/topics/:id/quiz', (req, res) => {
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

  // Shuffle options within each question
  const quizQuestions = shuffled.map(q => {
    const options = [
      { key: 'A', text: q.option_a },
      { key: 'B', text: q.option_b },
      { key: 'C', text: q.option_c },
      { key: 'D', text: q.option_d },
    ];

    // Fisher-Yates shuffle for options
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    // Find the new position of the correct answer
    const correctOptionText = q[`option_${q.correct_answer.toLowerCase()}`];
    const correctIndex = options.findIndex(o => o.text === correctOptionText);
    const labels = ['A', 'B', 'C', 'D'];

    return {
      id: q.id,
      content: q.content,
      options: options.map((o, idx) => ({
        label: labels[idx],
        text: o.text,
      })),
      correct_answer: labels[correctIndex],
    };
  });

  res.json(quizQuestions);
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
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`\n🚀 Quiz App đang chạy tại: http://localhost:${PORT}`);
    console.log(`📁 Database: ${DB_PATH}`);
    console.log(`⏹  Nhấn Ctrl+C để dừng server\n`);
  });

  // Save database on shutdown
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

start().catch(err => {
  console.error('❌ Lỗi khởi động:', err);
  process.exit(1);
});
