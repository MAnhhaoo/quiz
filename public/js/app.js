/* =============================================
   QUIZ APP — MAIN APPLICATION LOGIC
   ============================================= */

// =============================================
// STATE MANAGEMENT
// =============================================
const state = {
  currentScreen: 'home',
  currentTopicId: null,
  currentTopic: null,
  quizQuestions: [],
  quizCurrentIndex: 0,
  quizCorrectCount: 0,
  quizAnswered: false,
  quizRound: 1,
};

// =============================================
// API HELPERS
// =============================================
const API_BASE = '/api';

async function apiGet(url) {
  const res = await fetch(`${API_BASE}${url}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Lỗi không xác định' }));
    throw new Error(err.error);
  }
  return res.json();
}

async function apiPost(url, data) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Lỗi không xác định' }));
    throw new Error(err.error);
  }
  return res.json();
}

async function apiPut(url, data) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Lỗi không xác định' }));
    throw new Error(err.error);
  }
  return res.json();
}

async function apiDelete(url) {
  const res = await fetch(`${API_BASE}${url}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Lỗi không xác định' }));
    throw new Error(err.error);
  }
  return res.json();
}

// =============================================
// NAVIGATION
// =============================================
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(`screen-${screenId}`);
  if (screen) {
    screen.classList.add('active');
    // Re-trigger animation
    screen.style.animation = 'none';
    screen.offsetHeight; // Force reflow
    screen.style.animation = '';
  }
  state.currentScreen = screenId;
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${type === 'success' ? '✅' : '❌'} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// =============================================
// CONFIRM DIALOG
// =============================================
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-ghost" id="confirm-cancel">Hủy</button>
          <button class="btn btn-danger" id="confirm-ok">Xác nhận</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#confirm-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector('#confirm-ok').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
  });
}

// =============================================
// SCREEN 1: HOME — TOPIC LIST
// =============================================
async function loadTopics() {
  try {
    const topics = await apiGet('/topics');
    const grid = document.getElementById('topic-grid');
    const empty = document.getElementById('empty-state');

    if (topics.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    grid.innerHTML = topics.map(topic => `
      <div class="topic-card" data-id="${topic.id}" onclick="openTopic(${topic.id})">
        <div class="topic-card-header">
          <div class="topic-card-name">${escapeHtml(topic.name)}</div>
        </div>
        ${topic.description ? `<div class="topic-card-desc">${escapeHtml(topic.description)}</div>` : '<div class="topic-card-desc" style="color:var(--text-muted);font-style:italic;">Không có mô tả</div>'}
        <div class="topic-card-footer">
          <span class="topic-card-count">📝 ${topic.question_count} câu hỏi</span>
          <div class="topic-card-actions">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); editTopic(${topic.id}, '${escapeAttr(topic.name)}', '${escapeAttr(topic.description || '')}')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteTopic(${topic.id}, '${escapeAttr(topic.name)}')">🗑️</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function createTopic(e) {
  e.preventDefault();
  const name = document.getElementById('topic-name').value.trim();
  const description = document.getElementById('topic-desc').value.trim();

  if (!name) return;

  try {
    await apiPost('/topics', { name, description });
    showToast('Đã tạo chủ đề thành công!');
    document.getElementById('form-create-topic').reset();
    closeModal('modal-create-topic');
    loadTopics();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function editTopic(id, currentName, currentDesc) {
  // Reuse the create modal for editing
  document.getElementById('topic-name').value = currentName;
  document.getElementById('topic-desc').value = currentDesc;
  document.querySelector('#modal-create-topic .modal-header h3').textContent = '✏️ Sửa chủ đề';

  const form = document.getElementById('form-create-topic');
  const modal = document.getElementById('modal-create-topic');
  modal.classList.add('show');

  // Replace submit handler temporarily
  const handler = async (e) => {
    e.preventDefault();
    const name = document.getElementById('topic-name').value.trim();
    const description = document.getElementById('topic-desc').value.trim();
    if (!name) return;

    try {
      await apiPut(`/topics/${id}`, { name, description });
      showToast('Đã cập nhật chủ đề!');
      form.reset();
      closeModal('modal-create-topic');
      loadTopics();
      // Restore original title
      document.querySelector('#modal-create-topic .modal-header h3').textContent = '✨ Tạo chủ đề mới';
    } catch (err) {
      showToast(err.message, 'error');
    }
    form.removeEventListener('submit', handler);
    form.addEventListener('submit', createTopic);
  };

  form.removeEventListener('submit', createTopic);
  form.addEventListener('submit', handler);
}

async function deleteTopic(id, name) {
  const confirmed = await showConfirm(
    '🗑️ Xóa chủ đề?',
    `Bạn có chắc muốn xóa chủ đề "${name}"? Tất cả câu hỏi trong chủ đề sẽ bị xóa.`
  );
  if (!confirmed) return;

  try {
    await apiDelete(`/topics/${id}`);
    showToast('Đã xóa chủ đề!');
    loadTopics();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =============================================
// SCREEN 2: MANAGE QUESTIONS
// =============================================
async function openTopic(id) {
  state.currentTopicId = id;

  try {
    const topic = await apiGet(`/topics/${id}`);
    state.currentTopic = topic;

    document.getElementById('manage-topic-name').textContent = `📖 ${topic.name}`;
    document.getElementById('manage-topic-desc').textContent = topic.description || '';

    showScreen('manage');
    loadQuestions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadQuestions() {
  try {
    const questions = await apiGet(`/topics/${state.currentTopicId}/questions`);
    const list = document.getElementById('questions-list');
    const empty = document.getElementById('empty-questions');
    const quizBar = document.getElementById('start-quiz-bar');
    const countBadge = document.getElementById('manage-question-count');

    countBadge.textContent = `${questions.length} câu hỏi`;

    if (questions.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      quizBar.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    quizBar.style.display = 'flex';

    const labels = ['A', 'B', 'C', 'D'];
    const colors = ['label-a', 'label-b', 'label-c', 'label-d'];

    list.innerHTML = questions.map((q, idx) => `
      <div class="question-item" data-id="${q.id}">
        <div class="question-item-header">
          <div>
            <div class="question-item-number">Câu ${idx + 1}</div>
            <div class="question-item-content">${escapeHtml(q.content)}</div>
          </div>
          <div class="question-item-actions">
            <button class="btn btn-ghost btn-sm" onclick="editQuestion(${q.id})">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id})">🗑️</button>
          </div>
        </div>
        <div class="question-item-options">
          ${['a', 'b', 'c', 'd'].map((opt, i) => `
            <div class="question-item-option ${q.correct_answer === labels[i] ? 'correct' : ''}">
              <span class="opt-marker ${colors[i]}">${labels[i]}</span>
              ${escapeHtml(q[`option_${opt}`])}
              ${q.correct_answer === labels[i] ? ' ✓' : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showQuestionForm(editData = null) {
  const card = document.getElementById('question-form-card');
  const title = document.getElementById('question-form-title');
  const form = document.getElementById('form-question');
  const editId = document.getElementById('edit-question-id');

  form.reset();
  editId.value = '';

  if (editData) {
    title.textContent = '✏️ Sửa câu hỏi';
    editId.value = editData.id;
    document.getElementById('q-content').value = editData.content;
    document.getElementById('q-option-a').value = editData.option_a;
    document.getElementById('q-option-b').value = editData.option_b;
    document.getElementById('q-option-c').value = editData.option_c;
    document.getElementById('q-option-d').value = editData.option_d;
    const radio = document.querySelector(`input[name="correct_answer"][value="${editData.correct_answer}"]`);
    if (radio) radio.checked = true;
  } else {
    title.textContent = '➕ Thêm câu hỏi mới';
  }

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideQuestionForm() {
  document.getElementById('question-form-card').style.display = 'none';
  document.getElementById('form-question').reset();
  document.getElementById('edit-question-id').value = '';
}

async function saveQuestion(e) {
  e.preventDefault();

  const editId = document.getElementById('edit-question-id').value;
  const data = {
    content: document.getElementById('q-content').value.trim(),
    option_a: document.getElementById('q-option-a').value.trim(),
    option_b: document.getElementById('q-option-b').value.trim(),
    option_c: document.getElementById('q-option-c').value.trim(),
    option_d: document.getElementById('q-option-d').value.trim(),
    correct_answer: document.querySelector('input[name="correct_answer"]:checked')?.value,
  };

  if (!data.content || !data.option_a || !data.option_b || !data.option_c || !data.option_d) {
    showToast('Vui lòng nhập đầy đủ nội dung và 4 phương án!', 'error');
    return;
  }
  if (!data.correct_answer) {
    showToast('Vui lòng chọn đáp án đúng!', 'error');
    return;
  }

  try {
    if (editId) {
      await apiPut(`/questions/${editId}`, data);
      showToast('Đã cập nhật câu hỏi!');
    } else {
      await apiPost(`/topics/${state.currentTopicId}/questions`, data);
      showToast('Đã thêm câu hỏi mới!');
    }
    hideQuestionForm();
    loadQuestions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function editQuestion(id) {
  try {
    const questions = await apiGet(`/topics/${state.currentTopicId}/questions`);
    const question = questions.find(q => q.id === id);
    if (question) {
      showQuestionForm(question);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteQuestion(id) {
  const confirmed = await showConfirm(
    '🗑️ Xóa câu hỏi?',
    'Bạn có chắc muốn xóa câu hỏi này?'
  );
  if (!confirmed) return;

  try {
    await apiDelete(`/questions/${id}`);
    showToast('Đã xóa câu hỏi!');
    loadQuestions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =============================================
// SCREEN 3: QUIZ
// =============================================
async function startQuiz() {
  try {
    const questions = await apiGet(`/topics/${state.currentTopicId}/quiz`);
    state.quizQuestions = questions;
    state.quizCurrentIndex = 0;
    state.quizCorrectCount = 0;
    state.quizAnswered = false;

    document.getElementById('quiz-topic-name').textContent = state.currentTopic.name;
    document.getElementById('quiz-round-label').textContent = `Vòng ${state.quizRound}`;

    showScreen('quiz');
    renderQuizQuestion();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderQuizQuestion() {
  const q = state.quizQuestions[state.quizCurrentIndex];
  const total = state.quizQuestions.length;
  const current = state.quizCurrentIndex + 1;

  // Update progress
  document.getElementById('quiz-progress-text').textContent = `Câu ${current}/${total}`;
  document.getElementById('quiz-progress-bar').style.width = `${(current / total) * 100}%`;
  document.getElementById('quiz-question-number').textContent = `Câu ${current} / ${total}`;
  document.getElementById('quiz-question-content').textContent = q.content;

  // Render options
  const optionsContainer = document.getElementById('quiz-options');
  optionsContainer.innerHTML = q.options.map(opt => `
    <div class="quiz-option" data-label="${opt.label}" onclick="selectAnswer('${opt.label}')">
      <div class="opt-letter">${opt.label}</div>
      <div class="opt-text">${escapeHtml(opt.text)}</div>
    </div>
  `).join('');

  // Hide next button
  document.getElementById('quiz-actions').style.display = 'none';
  state.quizAnswered = false;

  // Re-trigger card animation
  const card = document.getElementById('quiz-card');
  card.style.animation = 'none';
  card.offsetHeight;
  card.style.animation = '';
}

function selectAnswer(label) {
  if (state.quizAnswered) return;
  state.quizAnswered = true;

  const q = state.quizQuestions[state.quizCurrentIndex];
  const isCorrect = label === q.correct_answer;

  if (isCorrect) {
    state.quizCorrectCount++;
  }

  // Mark all options
  const options = document.querySelectorAll('.quiz-option');
  options.forEach(opt => {
    const optLabel = opt.dataset.label;
    opt.classList.add('disabled');

    if (optLabel === label && isCorrect) {
      opt.classList.add('selected-correct');
    } else if (optLabel === label && !isCorrect) {
      opt.classList.add('selected-wrong');
    }

    if (optLabel === q.correct_answer && !isCorrect) {
      opt.classList.add('reveal-correct');
    }
  });

  // Show next button
  const actions = document.getElementById('quiz-actions');
  const nextBtn = document.getElementById('btn-next-question');

  if (state.quizCurrentIndex < state.quizQuestions.length - 1) {
    nextBtn.textContent = 'Câu tiếp theo →';
  } else {
    nextBtn.textContent = '📊 Xem kết quả';
  }

  actions.style.display = 'flex';
}

function nextQuestion() {
  if (state.quizCurrentIndex < state.quizQuestions.length - 1) {
    state.quizCurrentIndex++;
    renderQuizQuestion();
  } else {
    showResults();
  }
}

// =============================================
// SCREEN 4: RESULTS
// =============================================
function showResults() {
  const total = state.quizQuestions.length;
  const correct = state.quizCorrectCount;
  const wrong = total - correct;
  const percent = Math.round((correct / total) * 100);

  // Update text
  document.getElementById('stat-correct').textContent = correct;
  document.getElementById('stat-wrong').textContent = wrong;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('score-percent').textContent = `${percent}%`;

  // Update result message based on score
  const icon = document.getElementById('results-icon');
  const title = document.getElementById('results-title');
  const subtitle = document.getElementById('results-subtitle');

  if (percent === 100) {
    icon.textContent = '🏆';
    title.textContent = 'Hoàn hảo!';
    subtitle.textContent = 'Bạn đã trả lời đúng tất cả các câu hỏi!';
  } else if (percent >= 80) {
    icon.textContent = '🎉';
    title.textContent = 'Xuất sắc!';
    subtitle.textContent = 'Kết quả rất tốt, tiếp tục phát huy!';
  } else if (percent >= 60) {
    icon.textContent = '👍';
    title.textContent = 'Khá tốt!';
    subtitle.textContent = 'Bạn cần ôn tập thêm một chút nữa.';
  } else if (percent >= 40) {
    icon.textContent = '📖';
    title.textContent = 'Cần cố gắng!';
    subtitle.textContent = 'Hãy ôn lại kiến thức và thử lại nhé.';
  } else {
    icon.textContent = '💪';
    title.textContent = 'Đừng bỏ cuộc!';
    subtitle.textContent = 'Luyện tập nhiều hơn, bạn sẽ tiến bộ!';
  }

  showScreen('results');

  // Animate score circle (after screen is visible)
  requestAnimationFrame(() => {
    // We need an SVG gradient definition for the score circle
    ensureScoreGradient();
    const circumference = 2 * Math.PI * 52; // r=52
    const offset = circumference - (percent / 100) * circumference;
    const circle = document.getElementById('score-fill-circle');
    // Reset first
    circle.style.strokeDashoffset = circumference;
    setTimeout(() => {
      circle.style.strokeDashoffset = offset;
    }, 100);
  });
}

function ensureScoreGradient() {
  const svg = document.querySelector('.score-circle svg');
  if (!svg) return;
  if (svg.querySelector('#scoreGradient')) return;

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7f5af0"/>
      <stop offset="100%" style="stop-color:#2cb67d"/>
    </linearGradient>
  `;
  svg.insertBefore(defs, svg.firstChild);
}

async function retryQuiz() {
  state.quizRound++;
  await startQuiz();
}

// =============================================
// MODAL HELPERS
// =============================================
function openModal(id) {
  document.getElementById(id).classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  // Reset form and title when closing
  if (id === 'modal-create-topic') {
    document.getElementById('form-create-topic').reset();
    document.querySelector('#modal-create-topic .modal-header h3').textContent = '✨ Tạo chủ đề mới';
  }
}

// =============================================
// UTILITY: HTML ESCAPING
// =============================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\\/g, '\\\\');
}

// =============================================
// EVENT LISTENERS
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  // ---- Home Screen ----
  document.getElementById('btn-home').addEventListener('click', () => {
    showScreen('home');
    loadTopics();
  });

  document.getElementById('btn-create-topic').addEventListener('click', () => {
    openModal('modal-create-topic');
  });

  document.getElementById('modal-close-topic').addEventListener('click', () => {
    closeModal('modal-create-topic');
  });

  document.getElementById('modal-create-topic').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal('modal-create-topic');
  });

  document.getElementById('form-create-topic').addEventListener('submit', createTopic);

  // ---- Manage Screen ----
  document.getElementById('btn-back-home').addEventListener('click', () => {
    hideQuestionForm();
    showScreen('home');
    loadTopics();
  });

  document.getElementById('btn-add-question').addEventListener('click', () => {
    showQuestionForm();
  });

  document.getElementById('btn-cancel-question').addEventListener('click', () => {
    hideQuestionForm();
  });

  document.getElementById('form-question').addEventListener('submit', saveQuestion);

  document.getElementById('btn-start-quiz').addEventListener('click', () => {
    state.quizRound = 1;
    startQuiz();
  });

  // ---- Quiz Screen ----
  document.getElementById('btn-next-question').addEventListener('click', nextQuestion);

  document.getElementById('btn-quit-quiz').addEventListener('click', async () => {
    const confirmed = await showConfirm(
      '⚠️ Thoát Quiz?',
      'Tiến trình làm quiz hiện tại sẽ bị mất. Bạn có chắc muốn thoát?'
    );
    if (confirmed) {
      showScreen('manage');
      loadQuestions();
    }
  });

  // ---- Results Screen ----
  document.getElementById('btn-retry-quiz').addEventListener('click', retryQuiz);

  document.getElementById('btn-back-to-topic').addEventListener('click', () => {
    state.quizRound = 1;
    showScreen('manage');
    loadQuestions();
  });

  // ---- Initial Load ----
  loadTopics();
});
