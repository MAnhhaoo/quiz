/* =============================================
   QUIZ MASTER v2 — MAIN APPLICATION LOGIC
   ============================================= */

// =============================================
// STATE MANAGEMENT
// =============================================
const state = {
  token: localStorage.getItem('quiz_token') || null,
  user: JSON.parse(localStorage.getItem('quiz_user') || 'null'),
  currentScreen: 'auth',
  currentTopicId: null,
  currentTopic: null,
  quizQuestions: [],
  quizCurrentIndex: 0,
  quizCorrectCount: 0,
  quizAnswered: false,
  quizRound: 1,
  quizWrongQuestions: [], // Track wrong question IDs
  activeVoiceRecognition: null, // Track active speech recognition
};

// =============================================
// API HELPERS (with Auth Token)
// =============================================
const API_BASE = '/api';

async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, config);

  if (res.status === 401) {
    // Unauthorized -> Logout
    logout(false);
    throw new Error('Phiên đăng nhập hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.');
  }

  const data = await res.json().catch(() => ({ error: 'Lỗi không xác định từ máy chủ' }));
  if (!res.ok) {
    throw new Error(data.error || 'Có lỗi xảy ra');
  }
  return data;
}

const apiGet = (url) => apiCall(url, 'GET');
const apiPost = (url, data) => apiCall(url, 'POST', data);
const apiPut = (url, data) => apiCall(url, 'PUT', data);
const apiDelete = (url) => apiCall(url, 'DELETE');

// =============================================
// NAVIGATION & AUTH STATE
// =============================================
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(`screen-${screenId}`);
  if (screen) {
    screen.classList.add('active');
    screen.style.animation = 'none';
    screen.offsetHeight; // Force reflow
    screen.style.animation = '';
  }
  state.currentScreen = screenId;
  updateHeader();
}

function updateHeader() {
  const userInfo = document.getElementById('user-info');
  const userName = document.getElementById('user-display-name');
  const adminBtn = document.getElementById('btn-admin-users');
  const settingsBtn = document.getElementById('btn-settings');
  if (state.token && state.user) {
    userInfo.style.display = 'flex';
    userName.textContent = `👤 ${state.user.display_name}`;
    // Show admin button and settings button only for admin (id = 1)
    if (state.user.id === 1) {
      adminBtn.style.display = 'inline-flex';
      settingsBtn.style.display = 'inline-flex';
    } else {
      adminBtn.style.display = 'none';
      settingsBtn.style.display = 'none';
    }
  } else {
    userInfo.style.display = 'none';
    adminBtn.style.display = 'none';
    settingsBtn.style.display = 'none';
  }
}

function initAuth() {
  checkVercelStatus();
  if (state.token && state.user) {
    showScreen('home');
    loadTopics();
  } else {
    showScreen('auth');
  }
}

async function checkVercelStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const banner = document.getElementById('vercel-warning-banner');
    if (banner) {
      if (!data.connected) {
        banner.innerHTML = `⚠️ <strong>LỖI KẾT NỐI SUPABASE POSTGRESQL:</strong> Không thể kết nối đến cơ sở dữ liệu.<br/>👉 <strong>Chi tiết lỗi:</strong> <code>${data.error || 'Unknown error'}</code>`;
        banner.style.display = 'block';
        banner.style.background = '#fee2e2';
        banner.style.color = '#991b1b';
      } else {
        banner.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Lỗi kiểm tra trạng thái Vercel:', err);
  }
}

async function login(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!username || !password) return;

  try {
    const res = await apiPost('/auth/login', { username, password });
    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('quiz_token', res.token);
    localStorage.setItem('quiz_user', JSON.stringify(res.user));

    showToast(`Xin chào, ${res.user.display_name}!`);
    document.getElementById('form-login').reset();
    showScreen('home');
    loadTopics();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function register(e) {
  e.preventDefault();
  const display_name = document.getElementById('reg-display-name').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!display_name || !username || !password) return;

  try {
    const res = await apiPost('/auth/register', { display_name, username, password });
    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('quiz_token', res.token);
    localStorage.setItem('quiz_user', JSON.stringify(res.user));

    showToast(`Đăng ký thành công! Xin chào ${res.user.display_name}!`);
    document.getElementById('form-register').reset();
    showScreen('home');
    loadTopics();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logout(showMsg = true) {
  state.token = null;
  state.user = null;
  localStorage.removeItem('quiz_token');
  localStorage.removeItem('quiz_user');
  if (showMsg) showToast('Đã đăng xuất!');
  showScreen('auth');
}

// =============================================
// TOAST & CONFIRM DIALOG
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
// SCREEN: HOME — TOPIC LIST
// =============================================
async function loadTopics() {
  try {
    const topics = await apiGet('/topics');
    const grid = document.getElementById('topic-grid');
    const empty = document.getElementById('empty-state');
    const combinedSec = document.getElementById('combined-section');

    if (topics.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      if (combinedSec) combinedSec.style.display = 'none';
      return;
    }

    empty.style.display = 'none';

    // Calculate total questions across all topics
    const totalQuestions = topics.reduce((sum, t) => sum + Number(t.question_count || 0), 0);
    if (combinedSec) {
      if (topics.length > 0 && totalQuestions > 0) {
        combinedSec.style.display = 'block';
        document.getElementById('combined-subtitle').innerHTML = `Trộn ngẫu nhiên <strong>${totalQuestions} câu hỏi</strong> từ <strong>${topics.length} chủ đề</strong> của bạn vào một bài Quiz duy nhất!`;
        
        // Render custom combine checkboxes
        const checkboxesEl = document.getElementById('custom-combine-checkboxes');
        if (checkboxesEl) {
          checkboxesEl.innerHTML = topics.filter(t => Number(t.question_count) > 0).map(t => `
            <label class="combine-topic-check">
              <input type="checkbox" value="${t.id}" data-name="${escapeAttr(t.name)}" checked>
              <span style="flex:1;">${escapeHtml(t.name)}</span>
              <span class="badge" style="font-size:0.75rem;">${t.question_count} câu</span>
            </label>
          `).join('');
        }
      } else {
        combinedSec.style.display = 'none';
      }
    }

    grid.innerHTML = topics.map(topic => {
      const isReview = topic.is_review;
      const reviewBadge = isReview ? '<span class="badge badge-review">📌 Ôn lại</span>' : '';
      const cardClass = isReview ? 'topic-card topic-card-review' : 'topic-card';
      
      // Hide delete button for review topics (non-admin)
      const canDelete = !isReview || (state.user && state.user.id === 1);
      const deleteBtn = canDelete 
        ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteTopic(${topic.id}, '${escapeAttr(topic.name)}')">🗑️</button>` 
        : '';
      
      // Hide edit button for review topics
      const editBtn = !isReview 
        ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); editTopic(${topic.id}, '${escapeAttr(topic.name)}', '${escapeAttr(topic.description || '')}')">✏️</button>`
        : '';

      return `
        <div class="${cardClass}" data-id="${topic.id}" onclick="openTopic(${topic.id})">
          <div class="topic-card-header">
            <div class="topic-card-name">${escapeHtml(topic.name)} ${reviewBadge}</div>
          </div>
          ${topic.description ? `<div class="topic-card-desc">${escapeHtml(topic.description)}</div>` : '<div class="topic-card-desc" style="color:var(--text-muted);font-style:italic;">Không có mô tả</div>'}
          <div class="topic-card-footer">
            <span class="topic-card-count">📝 ${topic.question_count} câu hỏi</span>
            <div class="topic-card-actions">
              ${editBtn}
              ${deleteBtn}
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function toggleCustomCombine() {
  const box = document.getElementById('custom-combine-box');
  if (!box) return;
  if (box.style.display === 'none' || !box.style.display) {
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

function selectAllCombineTopics(checked) {
  document.querySelectorAll('.combine-topic-check input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
  });
}

async function startCombinedQuiz() {
  state.quizRound = 1;
  state.currentTopicId = 'all';
  state.currentTopic = { id: 'all', name: '🌟 Tổng Hợp Tất Cả Chủ Đề' };
  await startQuiz();
}

async function startCustomCombinedQuiz() {
  const selectedCbs = Array.from(document.querySelectorAll('.combine-topic-check input[type="checkbox"]:checked'));
  if (selectedCbs.length === 0) {
    showToast('Vui lòng chọn ít nhất 1 chủ đề để luyện tập!', 'error');
    return;
  }
  const selectedIds = selectedCbs.map(cb => cb.value).join(',');
  const selectedNames = selectedCbs.map(cb => cb.dataset.name);
  
  state.quizRound = 1;
  state.currentTopicId = `all?topics=${selectedIds}`;
  state.currentTopic = { 
    id: state.currentTopicId, 
    name: selectedNames.length === 1 ? `📖 ${selectedNames[0]}` : `🌟 Trộn ${selectedNames.length} Chủ đề`
  };
  await startQuiz();
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
  document.getElementById('topic-name').value = currentName;
  document.getElementById('topic-desc').value = currentDesc;
  document.querySelector('#modal-create-topic .modal-header h3').textContent = '✏️ Sửa chủ đề';

  const form = document.getElementById('form-create-topic');
  openModal('modal-create-topic');

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
// SCREEN: MANAGE QUESTIONS
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

    list.innerHTML = questions.map((q, idx) => {
      const qType = q.question_type || 'multiple_choice';
      const isEssay = qType === 'essay';

      let optionsHtml = '';
      if (isEssay) {
        optionsHtml = `
          <div class="question-item-essay-answer">
            <strong>💡 Đáp án mẫu:</strong> ${escapeHtml(q.correct_answer)}
          </div>
        `;
      } else {
        optionsHtml = `
          <div class="question-item-options">
            ${['a', 'b', 'c', 'd'].map((opt, i) => `
              <div class="question-item-option ${q.correct_answer === labels[i] ? 'correct' : ''}">
                <span class="opt-marker ${colors[i]}">${labels[i]}</span>
                ${escapeHtml(q[`option_${opt}`])}
                ${q.correct_answer === labels[i] ? ' ✓' : ''}
              </div>
            `).join('')}
          </div>
        `;
      }

      const extraHtml = (q.explanation || q.example_sentence) ? `
        <div style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-secondary); background: var(--bg-glass); padding: 0.5rem; border-radius: 6px;">
          ${q.explanation ? `<div>📖 <strong>Giải thích:</strong> ${escapeHtml(q.explanation)}</div>` : ''}
          ${q.example_sentence ? `<div style="color:var(--accent-info); font-style:italic;">💬 <strong>Ví dụ:</strong> "${escapeHtml(q.example_sentence)}"</div>` : ''}
        </div>
      ` : '';

      return `
        <div class="question-item" data-id="${q.id}">
          <div class="question-item-header">
            <div>
              <div class="question-item-number">
                Câu ${idx + 1}
                ${isEssay ? '<span class="badge badge-essay">✍️ Tự luận</span>' : '<span class="badge" style="font-size:0.7rem;padding:0.2rem 0.5rem;">📋 Trắc nghiệm</span>'}
              </div>
              <div class="question-item-content">${escapeHtml(q.content)}</div>
            </div>
            <div class="question-item-actions">
              <button class="btn btn-ghost btn-sm" onclick="editQuestion(${q.id})">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id})">🗑️</button>
            </div>
          </div>
          ${optionsHtml}
          ${extraHtml}
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function switchQuestionType(type) {
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('active'));
  document.querySelector(`.type-card[data-type="${type}"]`)?.classList.add('active');

  const mcFields = document.getElementById('mc-fields');
  const essayFields = document.getElementById('essay-fields');

  if (type === 'essay') {
    mcFields.style.display = 'none';
    essayFields.style.display = 'block';
    document.getElementById('q-option-a').required = false;
    document.getElementById('q-option-b').required = false;
    document.getElementById('q-option-c').required = false;
    document.getElementById('q-option-d').required = false;
    document.getElementById('q-essay-answer').required = true;
  } else {
    mcFields.style.display = 'block';
    essayFields.style.display = 'none';
    document.getElementById('q-option-a').required = true;
    document.getElementById('q-option-b').required = true;
    document.getElementById('q-option-c').required = true;
    document.getElementById('q-option-d').required = true;
    document.getElementById('q-essay-answer').required = false;
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
    const qType = editData.question_type || 'multiple_choice';
    
    const typeRadio = document.querySelector(`input[name="question_type"][value="${qType}"]`);
    if (typeRadio) typeRadio.checked = true;
    switchQuestionType(qType);

    document.getElementById('q-content').value = editData.content;
    document.getElementById('q-explanation').value = editData.explanation || '';
    document.getElementById('q-example').value = editData.example_sentence || '';

    if (qType === 'essay') {
      document.getElementById('q-essay-answer').value = editData.correct_answer;
    } else {
      document.getElementById('q-option-a').value = editData.option_a || '';
      document.getElementById('q-option-b').value = editData.option_b || '';
      document.getElementById('q-option-c').value = editData.option_c || '';
      document.getElementById('q-option-d').value = editData.option_d || '';
      const radio = document.querySelector(`input[name="correct_answer"][value="${editData.correct_answer}"]`);
      if (radio) radio.checked = true;
    }
  } else {
    title.textContent = '➕ Thêm câu hỏi mới';
    switchQuestionType('multiple_choice');
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
  const qType = document.querySelector('input[name="question_type"]:checked')?.value || 'multiple_choice';

  const data = {
    question_type: qType,
    content: document.getElementById('q-content').value.trim(),
    explanation: document.getElementById('q-explanation').value.trim(),
    example_sentence: document.getElementById('q-example').value.trim(),
  };

  if (!data.content) {
    showToast('Vui lòng nhập nội dung câu hỏi!', 'error');
    return;
  }

  if (qType === 'essay') {
    data.correct_answer = document.getElementById('q-essay-answer').value.trim();
    if (!data.correct_answer) {
      showToast('Vui lòng nhập đáp án mẫu cho câu tự luận!', 'error');
      return;
    }
  } else {
    data.option_a = document.getElementById('q-option-a').value.trim();
    data.option_b = document.getElementById('q-option-b').value.trim();
    data.option_c = document.getElementById('q-option-c').value.trim();
    data.option_d = document.getElementById('q-option-d').value.trim();
    data.correct_answer = document.querySelector('input[name="correct_answer"]:checked')?.value;

    if (!data.option_a || !data.option_b || !data.option_c || !data.option_d) {
      showToast('Vui lòng nhập đủ 4 phương án A, B, C, D!', 'error');
      return;
    }
    if (!data.correct_answer) {
      showToast('Vui lòng chọn đáp án đúng!', 'error');
      return;
    }
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
    if (question) showQuestionForm(question);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteQuestion(id) {
  const confirmed = await showConfirm('🗑️ Xóa câu hỏi?', 'Bạn có chắc muốn xóa câu hỏi này?');
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
// IMPORT / EXPORT — MULTI-FORMAT SUPPORT
// =============================================

// State for import wizard
let importState = {
  parsedQuestions: [],   // Array of parsed question objects
  validQuestions: [],    // Only valid ones ready to import
  errors: [],            // Parse/validation errors
  selectedFile: null,    // Selected File object
};

function resetImportState() {
  importState = { parsedQuestions: [], validQuestions: [], errors: [], selectedFile: null };
}

function openImportModal() {
  resetImportState();
  // Reset UI
  const fileInput = document.getElementById('import-file');
  if (fileInput) fileInput.value = '';
  const textInput = document.getElementById('import-text-input');
  if (textInput) textInput.value = '';
  document.getElementById('import-file-info').style.display = 'none';
  document.getElementById('paste-format-group').style.display = 'none';

  // Show step 1
  showImportStep(1);
  openModal('modal-import');
}

function showImportStep(step) {
  // Update step indicators
  for (let i = 1; i <= 3; i++) {
    const stepEl = document.getElementById(`import-step-${i}`);
    stepEl.classList.remove('active', 'completed');
    if (i < step) stepEl.classList.add('completed');
    if (i === step) stepEl.classList.add('active');
  }

  // Show/hide panels
  document.getElementById('import-panel-file').style.display = step === 1 ? 'block' : 'none';
  document.getElementById('import-panel-preview').style.display = step === 2 ? 'block' : 'none';
  document.getElementById('import-panel-result').style.display = step === 3 ? 'block' : 'none';
}

// --- File Selection Handling ---
function handleFileSelected(file) {
  if (!file) return;
  importState.selectedFile = file;

  const ext = file.name.split('.').pop().toLowerCase();
  const icons = { json: '📋', txt: '📝', csv: '📊', xlsx: '📗', xls: '📗' };
  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  document.getElementById('file-info-icon').textContent = icons[ext] || '📄';
  document.getElementById('file-info-name').textContent = file.name;
  document.getElementById('file-info-size').textContent = formatSize(file.size);
  document.getElementById('import-file-info').style.display = 'flex';
}

function removeSelectedFile() {
  importState.selectedFile = null;
  document.getElementById('import-file').value = '';
  document.getElementById('import-file-info').style.display = 'none';
}

// --- Format Guide Tab Switcher ---
function switchGuideTab(format) {
  document.querySelectorAll('.guide-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.guide-panel').forEach(p => p.classList.remove('active'));

  const tab = Array.from(document.querySelectorAll('.guide-tab')).find(t => t.textContent.toLowerCase().includes(format));
  if (tab) tab.classList.add('active');

  const panel = document.getElementById(`guide-${format}`);
  if (panel) panel.classList.add('active');
}

// --- Detect pasted text format ---
function detectTextFormat(text) {
  text = text.trim();
  // Try JSON
  if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
    try { JSON.parse(text); return 'json'; } catch (e) { /* not valid JSON */ }
  }
  // CSV detection: first line has commas and looks like a header
  const firstLine = text.split('\n')[0].toLowerCase();
  if (firstLine.includes('content') && firstLine.includes(',')) return 'csv';
  // Default: TXT
  return 'txt';
}

// =============================================
// PARSERS — Convert file content to question array
// =============================================

// --- JSON Parser ---
function parseJSON(text) {
  const questions = [];
  const errors = [];

  let data;
  try {
    data = JSON.parse(text.trim());
  } catch (e) {
    errors.push('Cấu trúc JSON không hợp lệ: ' + e.message);
    return { questions, errors };
  }

  // If it's an object with a "questions" key, unwrap it
  if (data && !Array.isArray(data) && Array.isArray(data.questions)) {
    data = data.questions;
  }

  if (!Array.isArray(data)) {
    errors.push('JSON phải là một mảng câu hỏi hoặc object có trường "questions".');
    return { questions, errors };
  }

  data.forEach((q, i) => {
    const parsed = normalizeQuestion(q, i + 1);
    if (parsed.error) errors.push(parsed.error);
    questions.push(parsed.question);
  });

  return { questions, errors };
}

// --- CSV Parser ---
function parseCSV(text) {
  const questions = [];
  const errors = [];

  const lines = parseCSVLines(text.trim());
  if (lines.length < 2) {
    errors.push('File CSV phải có ít nhất 2 dòng (header + 1 câu hỏi).');
    return { questions, errors };
  }

  // Parse header
  const headers = lines[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  // Map columns
  const colMap = {};
  const knownCols = ['content', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'type', 'question_type', 'explanation', 'example_sentence'];
  // Also support Vietnamese column names
  const viMap = { 'câu hỏi': 'content', 'nội dung': 'content', 'phương án a': 'option_a', 'phương_án_a': 'option_a', 'a': 'option_a', 'b': 'option_b', 'c': 'option_c', 'd': 'option_d', 'phương án b': 'option_b', 'phương_án_b': 'option_b', 'phương án c': 'option_c', 'phương_án_c': 'option_c', 'phương án d': 'option_d', 'phương_án_d': 'option_d', 'đáp án': 'correct_answer', 'đáp_án': 'correct_answer', 'đáp_án_đúng': 'correct_answer', 'loại': 'type', 'giải thích': 'explanation', 'giải_thích': 'explanation', 'ví dụ': 'example_sentence', 'ví_dụ': 'example_sentence' };

  headers.forEach((h, idx) => {
    if (knownCols.includes(h)) {
      colMap[h] = idx;
    } else if (viMap[h]) {
      colMap[viMap[h]] = idx;
    }
  });

  if (colMap['content'] === undefined) {
    // Try first column as content if not found
    colMap['content'] = 0;
  }

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) continue; // skip empty rows

    const getCol = (name) => {
      const idx = colMap[name];
      return idx !== undefined && idx < row.length ? row[idx].trim() : '';
    };

    const q = {
      type: getCol('type') || getCol('question_type') || 'multiple_choice',
      content: getCol('content'),
      option_a: getCol('option_a'),
      option_b: getCol('option_b'),
      option_c: getCol('option_c'),
      option_d: getCol('option_d'),
      correct_answer: getCol('correct_answer'),
      explanation: getCol('explanation'),
      example_sentence: getCol('example_sentence'),
    };

    // Auto-detect essay if no options
    if (!q.option_a && !q.option_b && !q.option_c && !q.option_d && q.correct_answer) {
      q.type = 'essay';
    }

    const parsed = normalizeQuestion(q, i);
    if (parsed.error) errors.push(parsed.error);
    questions.push(parsed.question);
  }

  return { questions, errors };
}

// Helper: Parse CSV lines handling quoted fields
function parseCSVLines(text) {
  const lines = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        current.push(field);
        field = '';
      } else if (c === '\n' || (c === '\r' && next === '\n')) {
        current.push(field);
        field = '';
        lines.push(current);
        current = [];
        if (c === '\r') i++; // skip \n
      } else if (c === '\r') {
        current.push(field);
        field = '';
        lines.push(current);
        current = [];
      } else {
        field += c;
      }
    }
  }
  // Last field/line
  current.push(field);
  if (current.some(f => f.trim())) lines.push(current);

  return lines;
}

// --- TXT Parser (structured text) ---
function parseTXT(text) {
  const questions = [];
  const errors = [];

  // Split by double newlines (blank line separators)
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim());

  blocks.forEach((block, blockIdx) => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;

    const q = {
      type: 'multiple_choice',
      content: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_answer: '',
      explanation: '',
      example_sentence: '',
    };

    let contentLines = [];
    let foundOptions = false;

    for (const line of lines) {
      // Match option patterns: "A. ...", "A) ...", "A: ...", "a. ..."
      const optMatch = line.match(/^([A-Da-d])[.):\s]\s*(.+)/);
      // Match answer line: "Answer: A", "Đáp án: B", "Correct: C", "DA: A", "dap an: B"
      const ansMatch = line.match(/^(?:answer|đáp\s*án|correct|da|dap\s*an|dapan)\s*[:=]\s*(.+)/i);
      // Match explanation: "Explanation: ...", "Giải thích: ..."
      const expMatch = line.match(/^(?:explanation|giải\s*thích|giai\s*thich)\s*[:=]\s*(.+)/i);
      // Match example: "Example: ...", "Ví dụ: ..."
      const exMatch = line.match(/^(?:example|ví\s*dụ|vi\s*du)\s*[:=]\s*(.+)/i);

      if (ansMatch) {
        const ans = ansMatch[1].trim();
        // Check if it's a letter (A/B/C/D) for MC or full text for essay
        if (/^[A-Da-d]$/.test(ans)) {
          q.correct_answer = ans.toUpperCase();
        } else {
          q.correct_answer = ans;
          q.type = 'essay';
        }
      } else if (expMatch) {
        q.explanation = expMatch[1].trim();
      } else if (exMatch) {
        q.example_sentence = exMatch[1].trim();
      } else if (optMatch && !foundOptions) {
        const letter = optMatch[1].toUpperCase();
        const text = optMatch[2].trim();
        if (letter === 'A') q.option_a = text;
        else if (letter === 'B') q.option_b = text;
        else if (letter === 'C') q.option_c = text;
        else if (letter === 'D') { q.option_d = text; foundOptions = true; }
      } else if (!q.option_a && !ansMatch && !expMatch && !exMatch) {
        // Content line (before any options)
        contentLines.push(line);
      }
    }

    q.content = contentLines.join(' ');

    // Auto-detect essay if no options found
    if (!q.option_a && !q.option_b && !q.option_c && !q.option_d) {
      q.type = 'essay';
    }

    const parsed = normalizeQuestion(q, blockIdx + 1);
    if (parsed.error) errors.push(parsed.error);
    questions.push(parsed.question);
  });

  return { questions, errors };
}

// --- Excel Parser (using SheetJS) ---
function parseExcel(arrayBuffer) {
  const questions = [];
  const errors = [];

  if (typeof XLSX === 'undefined') {
    errors.push('Thư viện SheetJS chưa được tải. Vui lòng tải lại trang.');
    return { questions, errors };
  }

  try {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (data.length === 0) {
      errors.push('File Excel không có dữ liệu.');
      return { questions, errors };
    }

    // Normalize headers (lowercase, underscores)
    const normalizeHeader = (h) => String(h).trim().toLowerCase().replace(/\s+/g, '_');

    // Vietnamese column name mapping
    const viMap = { 'câu_hỏi': 'content', 'nội_dung': 'content', 'phương_án_a': 'option_a', 'phương_án_b': 'option_b', 'phương_án_c': 'option_c', 'phương_án_d': 'option_d', 'đáp_án': 'correct_answer', 'đáp_án_đúng': 'correct_answer', 'loại': 'type', 'giải_thích': 'explanation', 'ví_dụ': 'example_sentence' };

    data.forEach((row, i) => {
      const normalized = {};
      Object.keys(row).forEach(key => {
        let nKey = normalizeHeader(key);
        if (viMap[nKey]) nKey = viMap[nKey];
        normalized[nKey] = String(row[key]).trim();
      });

      const q = {
        type: normalized.type || normalized.question_type || 'multiple_choice',
        content: normalized.content || '',
        option_a: normalized.option_a || '',
        option_b: normalized.option_b || '',
        option_c: normalized.option_c || '',
        option_d: normalized.option_d || '',
        correct_answer: normalized.correct_answer || '',
        explanation: normalized.explanation || '',
        example_sentence: normalized.example_sentence || '',
      };

      if (!q.option_a && !q.option_b && !q.option_c && !q.option_d && q.correct_answer) {
        q.type = 'essay';
      }

      const parsed = normalizeQuestion(q, i + 1);
      if (parsed.error) errors.push(parsed.error);
      questions.push(parsed.question);
    });

  } catch (e) {
    errors.push('Lỗi đọc file Excel: ' + e.message);
  }

  return { questions, errors };
}

// --- Normalize & Validate a single question ---
function normalizeQuestion(raw, index) {
  const q = {
    type: (raw.type || raw.question_type || 'multiple_choice').toLowerCase().trim(),
    content: (raw.content || '').trim(),
    option_a: (raw.option_a || '').trim(),
    option_b: (raw.option_b || '').trim(),
    option_c: (raw.option_c || '').trim(),
    option_d: (raw.option_d || '').trim(),
    correct_answer: (raw.correct_answer || '').trim(),
    explanation: (raw.explanation || '').trim(),
    example_sentence: (raw.example_sentence || '').trim(),
    _valid: true,
    _error: '',
  };

  // Map type aliases
  if (['mc', 'trac_nghiem', 'trắc nghiệm', 'trắc_nghiệm', 'tracnghiem'].includes(q.type)) q.type = 'multiple_choice';
  if (['tu_luan', 'tự luận', 'tự_luận', 'tuluan'].includes(q.type)) q.type = 'essay';

  let error = null;

  if (!q.content) {
    q._valid = false;
    q._error = 'Thiếu nội dung';
    error = `Câu ${index}: Thiếu nội dung câu hỏi`;
  } else if (q.type === 'multiple_choice') {
    if (!q.option_a || !q.option_b || !q.option_c || !q.option_d) {
      q._valid = false;
      q._error = 'Thiếu phương án';
      error = `Câu ${index}: Thiếu phương án A/B/C/D`;
    } else if (!['A', 'B', 'C', 'D'].includes(q.correct_answer.toUpperCase())) {
      q._valid = false;
      q._error = 'Đáp án không hợp lệ';
      error = `Câu ${index}: Đáp án đúng phải là A, B, C hoặc D`;
    } else {
      q.correct_answer = q.correct_answer.toUpperCase();
    }
  } else if (q.type === 'essay') {
    if (!q.correct_answer) {
      q._valid = false;
      q._error = 'Thiếu đáp án mẫu';
      error = `Câu ${index}: Thiếu đáp án mẫu cho câu tự luận`;
    }
  }

  return { question: q, error };
}

// =============================================
// IMPORT WIZARD — Step Actions
// =============================================

async function parseAndPreview() {
  const fileInput = document.getElementById('import-file');
  const textInput = document.getElementById('import-text-input').value.trim();
  const file = importState.selectedFile || (fileInput.files && fileInput.files[0]);

  let result = { questions: [], errors: [] };

  if (file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      // Excel: read as ArrayBuffer
      const buffer = await file.arrayBuffer();
      result = parseExcel(new Uint8Array(buffer));
    } else {
      // Text-based: read as text
      const text = await file.text();
      if (ext === 'json') result = parseJSON(text);
      else if (ext === 'csv') result = parseCSV(text);
      else if (ext === 'txt') result = parseTXT(text);
      else {
        // Try auto-detect
        const fmt = detectTextFormat(text);
        if (fmt === 'json') result = parseJSON(text);
        else if (fmt === 'csv') result = parseCSV(text);
        else result = parseTXT(text);
      }
    }
  } else if (textInput) {
    // Pasted text — detect or use selected format
    const formatRadio = document.querySelector('input[name="paste_format"]:checked');
    let fmt = formatRadio ? formatRadio.value : 'auto';
    if (fmt === 'auto') fmt = detectTextFormat(textInput);

    if (fmt === 'json') result = parseJSON(textInput);
    else if (fmt === 'csv') result = parseCSV(textInput);
    else result = parseTXT(textInput);
  } else {
    showToast('Vui lòng chọn file hoặc dán nội dung vào ô!', 'error');
    return;
  }

  if (result.questions.length === 0 && result.errors.length > 0) {
    showToast(result.errors[0], 'error');
    return;
  }

  if (result.questions.length === 0) {
    showToast('Không tìm thấy câu hỏi nào trong file!', 'error');
    return;
  }

  // Save to state
  importState.parsedQuestions = result.questions;
  importState.validQuestions = result.questions.filter(q => q._valid);
  importState.errors = result.errors;

  // Render preview
  renderImportPreview();
  showImportStep(2);
}

function renderImportPreview() {
  const { parsedQuestions, validQuestions, errors } = importState;

  const mcCount = validQuestions.filter(q => q.type === 'multiple_choice').length;
  const essayCount = validQuestions.filter(q => q.type === 'essay').length;

  document.getElementById('preview-total').textContent = `📝 ${parsedQuestions.length} câu hỏi`;
  document.getElementById('preview-mc').textContent = `📋 ${mcCount} trắc nghiệm`;
  document.getElementById('preview-essay').textContent = `✍️ ${essayCount} tự luận`;
  document.getElementById('import-valid-count').textContent = validQuestions.length;

  // Errors
  const errorsDiv = document.getElementById('preview-errors');
  const errorDetails = document.getElementById('import-error-details');
  const errorCountSpan = document.getElementById('preview-error-count');
  const errorInvalid = parsedQuestions.filter(q => !q._valid).length;

  if (errorInvalid > 0 || errors.length > 0) {
    errorsDiv.style.display = 'block';
    errorCountSpan.textContent = errorInvalid + errors.length;
    errorDetails.style.display = 'block';
    const allErrors = [...errors, ...parsedQuestions.filter(q => !q._valid).map((q, i) => `Câu ${i + 1}: ${q._error}`)];
    document.getElementById('import-error-list').innerHTML = allErrors.slice(0, 10).map(e => `<li>${escapeHtml(e)}</li>`).join('');
  } else {
    errorsDiv.style.display = 'none';
    errorDetails.style.display = 'none';
  }

  // Table
  const tbody = document.getElementById('import-preview-tbody');
  tbody.innerHTML = parsedQuestions.map((q, i) => {
    const isEssay = q.type === 'essay';
    const typeBadge = isEssay
      ? '<span class="type-badge-essay">Tự luận</span>'
      : '<span class="type-badge-mc">Trắc nghiệm</span>';

    const optionsCell = isEssay
      ? '<em style="color:var(--text-muted)">—</em>'
      : `<span style="font-size:0.72rem;">A: ${escapeHtml((q.option_a || '').substring(0, 20))}${q.option_a.length > 20 ? '…' : ''}<br>B: ${escapeHtml((q.option_b || '').substring(0, 20))}${q.option_b.length > 20 ? '…' : ''}<br>C: ${escapeHtml((q.option_c || '').substring(0, 20))}${q.option_c.length > 20 ? '…' : ''}<br>D: ${escapeHtml((q.option_d || '').substring(0, 20))}${q.option_d.length > 20 ? '…' : ''}</span>`;

    const answerCell = isEssay
      ? `<span style="font-size:0.72rem;">${escapeHtml((q.correct_answer || '').substring(0, 30))}${q.correct_answer.length > 30 ? '…' : ''}</span>`
      : `<strong>${escapeHtml(q.correct_answer)}</strong>`;

    const statusCell = q._valid
      ? '<span class="status-ok">✅</span>'
      : `<span class="status-error">❌ ${escapeHtml(q._error)}</span>`;

    const contentPreview = (q.content || '').substring(0, 60) + (q.content.length > 60 ? '…' : '');

    return `
      <tr class="${q._valid ? '' : 'row-error'}">
        <td class="col-num">${i + 1}</td>
        <td class="col-type">${typeBadge}</td>
        <td class="col-content">${escapeHtml(contentPreview)}</td>
        <td class="col-options">${optionsCell}</td>
        <td class="col-answer">${answerCell}</td>
        <td class="col-status">${statusCell}</td>
      </tr>
    `;
  }).join('');
}

async function doImport() {
  const { validQuestions } = importState;

  if (validQuestions.length === 0) {
    showToast('Không có câu hỏi hợp lệ nào để import!', 'error');
    return;
  }

  // Convert to server format
  const questions = validQuestions.map(q => ({
    type: q.type,
    content: q.content,
    option_a: q.option_a,
    option_b: q.option_b,
    option_c: q.option_c,
    option_d: q.option_d,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
    example_sentence: q.example_sentence,
  }));

  try {
    const res = await apiPost(`/topics/${state.currentTopicId}/import`, { questions });

    // Show result
    showImportStep(3);

    if (res.imported === questions.length) {
      document.getElementById('import-result-icon').textContent = '🎉';
      document.getElementById('import-result-title').textContent = 'Import thành công!';
      document.getElementById('import-result-message').textContent = `Đã thêm ${res.imported} câu hỏi vào chủ đề.`;
    } else {
      document.getElementById('import-result-icon').textContent = '⚠️';
      document.getElementById('import-result-title').textContent = 'Import hoàn tất (có lỗi)';
      document.getElementById('import-result-message').textContent = `Đã import ${res.imported}/${res.total} câu hỏi. ${res.errors ? res.errors.length + ' câu bị lỗi.' : ''}`;
    }

    showToast(`Đã import ${res.imported}/${res.total} câu hỏi!`);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeImportAndRefresh() {
  closeModal('modal-import');
  loadQuestions();
}

async function exportJson() {
  try {
    const res = await apiGet(`/topics/${state.currentTopicId}/export`);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.questions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `quiz_${res.topic_name.toLowerCase().replace(/\s+/g, '_')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Đã xuất file JSON thành công!');
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// =============================================
// SCREEN: QUIZ
// =============================================
async function startQuiz() {
  try {
    let endpoint = `/topics/${state.currentTopicId}/quiz`;
    if (String(state.currentTopicId).startsWith('all')) {
      const queryPart = String(state.currentTopicId).includes('?') ? String(state.currentTopicId).substring(String(state.currentTopicId).indexOf('?')) : '';
      endpoint = `/quiz/all${queryPart}`;
    }
    const questions = await apiGet(endpoint);
    state.quizQuestions = questions;
    state.quizCurrentIndex = 0;
    state.quizCorrectCount = 0;
    state.quizAnswered = false;
    state.quizWrongQuestions = []; // Reset wrong questions

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

  document.getElementById('quiz-progress-text').textContent = `Câu ${current}/${total}`;
  document.getElementById('quiz-progress-bar').style.width = `${(current / total) * 100}%`;
  
  let topicBadge = '';
  if (q.topic_name) {
    topicBadge = `<span class="badge" style="background:var(--accent-info);color:#fff;font-size:0.75rem;margin-left:6px;">📚 ${escapeHtml(q.topic_name)}</span>`;
  }
  
  document.getElementById('quiz-question-number').innerHTML = `Câu ${current} / ${total} ${q.question_type === 'essay' ? '<span class="badge badge-essay">✍️ Tự luận</span>' : ''} ${topicBadge}`;
  document.getElementById('quiz-question-content').textContent = q.content;

  const optionsContainer = document.getElementById('quiz-options');
  const essayContainer = document.getElementById('essay-input-area');
  const aiResult = document.getElementById('ai-result');
  const explanationBox = document.getElementById('question-explanation');
  const actions = document.getElementById('quiz-actions');
  const aiLoading = document.getElementById('ai-loading');

  const userReviewArea = document.getElementById('user-review-area');

  aiResult.style.display = 'none';
  explanationBox.style.display = 'none';
  actions.style.display = 'none';
  aiLoading.style.display = 'none';
  userReviewArea.style.display = 'none';
  document.getElementById('user-review-input').value = '';
  document.getElementById('ai-review-result').style.display = 'none';
  document.getElementById('ai-review-loading').style.display = 'none';
  document.getElementById('btn-submit-review').style.display = 'inline-flex';
  state.quizAnswered = false;

  if (q.question_type === 'essay') {
    optionsContainer.style.display = 'none';
    essayContainer.style.display = 'block';
    document.getElementById('essay-answer-input').value = '';
    document.getElementById('essay-answer-input').disabled = false;
    document.getElementById('btn-submit-essay').style.display = 'inline-flex';
  } else {
    essayContainer.style.display = 'none';
    optionsContainer.style.display = 'flex';
    optionsContainer.innerHTML = q.options.map(opt => `
      <div class="quiz-option" data-label="${opt.label}" onclick="selectAnswer('${opt.label}')">
        <div class="opt-letter">${opt.label}</div>
        <div class="opt-text">${escapeHtml(opt.text)}</div>
      </div>
    `).join('');
  }

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
  } else {
    // Track wrong answer
    state.quizWrongQuestions.push(q.id);
  }

  const options = document.querySelectorAll('.quiz-option');
  options.forEach(opt => {
    const optLabel = opt.dataset.label;
    opt.classList.add('disabled');
    if (optLabel === label && isCorrect) opt.classList.add('selected-correct');
    else if (optLabel === label && !isCorrect) opt.classList.add('selected-wrong');
    if (optLabel === q.correct_answer && !isCorrect) opt.classList.add('reveal-correct');
  });

  showExplanationBox(q);
  showUserReviewForm();
  showNextButton();
}

function showUserReviewForm() {
  const area = document.getElementById('user-review-area');
  area.style.display = 'block';
  document.getElementById('user-review-input').value = '';
  document.getElementById('ai-review-result').style.display = 'none';
  document.getElementById('ai-review-loading').style.display = 'none';
  document.getElementById('btn-submit-review').style.display = 'inline-flex';
}

async function submitUserReview() {
  const input = document.getElementById('user-review-input');
  const userText = input.value.trim();
  if (!userText) {
    showToast('Vui lòng nhập ví dụ hoặc giải thích của bạn!', 'error');
    return;
  }

  const q = state.quizQuestions[state.quizCurrentIndex];
  document.getElementById('btn-submit-review').style.display = 'none';
  document.getElementById('ai-review-loading').style.display = 'flex';

  try {
    const res = await apiPost('/ai/review', {
      word: q.content,
      context: q.explanation || '',
      user_text: userText,
    });

    document.getElementById('ai-review-loading').style.display = 'none';
    const resultEl = document.getElementById('ai-review-result');
    document.getElementById('ai-review-text').textContent = res.review;
    resultEl.style.display = 'block';
    resultEl.style.animation = 'none';
    resultEl.offsetHeight;
    resultEl.style.animation = 'fadeSlideUp 0.4s ease';
  } catch (err) {
    document.getElementById('ai-review-loading').style.display = 'none';
    document.getElementById('btn-submit-review').style.display = 'inline-flex';
    showToast('Lỗi: ' + err.message, 'error');
  }
}

async function submitEssay() {
  if (state.quizAnswered) return;
  const input = document.getElementById('essay-answer-input');
  const studentAnswer = input.value.trim();
  if (!studentAnswer) {
    showToast('Vui lòng nhập câu trả lời của bạn!', 'error');
    return;
  }

  state.quizAnswered = true;
  input.disabled = true;
  document.getElementById('btn-submit-essay').style.display = 'none';
  document.getElementById('ai-loading').style.display = 'flex';

  const q = state.quizQuestions[state.quizCurrentIndex];

  try {
    const res = await apiPost('/ai/grade', {
      question: q.content,
      correct_answer: q.correct_answer,
      student_answer: studentAnswer,
      explanation: q.explanation,
      example_sentence: q.example_sentence
    });

    document.getElementById('ai-loading').style.display = 'none';
    if (res.is_correct || res.score >= 50) {
      state.quizCorrectCount++;
    } else {
      // Track wrong answer for essay
      state.quizWrongQuestions.push(q.id);
    }

    const aiResult = document.getElementById('ai-result');
    aiResult.className = `ai-result ${res.is_correct || res.score >= 50 ? 'correct' : 'wrong'}`;
    document.getElementById('ai-result-header').innerHTML = `${res.is_correct || res.score >= 50 ? '🎉 Đạt yêu cầu' : '❌ Chưa chính xác'} ${res.ai_powered ? '<span class="badge" style="font-size:0.7rem;padding:0.1rem 0.4rem;background:rgba(127,90,240,0.2);">🤖 AI chấm</span>' : ''}`;
    document.getElementById('ai-result-score').textContent = `Điểm đánh giá: ${res.score}/100`;
    document.getElementById('ai-result-feedback').textContent = res.feedback;

    const expEl = document.getElementById('ai-result-explanation');
    if (res.explanation) {
      expEl.style.display = 'block';
      expEl.innerHTML = `📖 <strong>Giải thích:</strong> ${escapeHtml(res.explanation)}`;
    } else expEl.style.display = 'none';

    const exEl = document.getElementById('ai-result-example');
    if (res.example_sentence) {
      exEl.style.display = 'block';
      exEl.innerHTML = `💬 <strong>Ví dụ:</strong> "${escapeHtml(res.example_sentence)}"`;
    } else exEl.style.display = 'none';

    aiResult.style.display = 'block';
    showUserReviewForm();
    showNextButton();
  } catch (err) {
    document.getElementById('ai-loading').style.display = 'none';
    showToast('Lỗi khi chấm điểm: ' + err.message, 'error');
    input.disabled = false;
    document.getElementById('btn-submit-essay').style.display = 'inline-flex';
    state.quizAnswered = false;
  }
}

function showExplanationBox(q) {
  if (!q.explanation && !q.example_sentence) return;
  const box = document.getElementById('question-explanation');
  const exp = document.getElementById('explanation-content');
  const ex = document.getElementById('example-sentence');

  if (q.explanation) {
    exp.style.display = 'block';
    exp.innerHTML = `📖 <strong>Giải thích:</strong> ${escapeHtml(q.explanation)}`;
  } else exp.style.display = 'none';

  if (q.example_sentence) {
    ex.style.display = 'block';
    ex.innerHTML = `💬 <strong>Ví dụ:</strong> "${escapeHtml(q.example_sentence)}"`;
  } else ex.style.display = 'none';

  box.style.display = 'block';
}

function showNextButton() {
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
// SCREEN: RESULTS
// =============================================
function showResults() {
  const total = state.quizQuestions.length;
  const correct = state.quizCorrectCount;
  const wrong = total - correct;
  const percent = Math.round((correct / total) * 100);

  document.getElementById('stat-correct').textContent = correct;
  document.getElementById('stat-wrong').textContent = wrong;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('score-percent').textContent = `${percent}%`;

  const icon = document.getElementById('results-icon');
  const title = document.getElementById('results-title');
  const subtitle = document.getElementById('results-subtitle');

  if (percent === 100) { icon.textContent = '🏆'; title.textContent = 'Hoàn hảo!'; subtitle.textContent = 'Bạn đã trả lời đúng tất cả các câu hỏi!'; }
  else if (percent >= 80) { icon.textContent = '🎉'; title.textContent = 'Xuất sắc!'; subtitle.textContent = 'Kết quả rất tốt, tiếp tục phát huy!'; }
  else if (percent >= 60) { icon.textContent = '👍'; title.textContent = 'Khá tốt!'; subtitle.textContent = 'Bạn cần ôn tập thêm một chút nữa.'; }
  else if (percent >= 40) { icon.textContent = '📖'; title.textContent = 'Cần cố gắng!'; subtitle.textContent = 'Hãy ôn lại kiến thức và thử lại nhé.'; }
  else { icon.textContent = '💪'; title.textContent = 'Đừng bỏ cuộc!'; subtitle.textContent = 'Luyện tập nhiều hơn, bạn sẽ tiến bộ!'; }

  // Show/hide review button based on wrong answers
  const reviewBtn = document.getElementById('btn-review-wrong');
  if (wrong > 0 && state.quizWrongQuestions.length > 0) {
    reviewBtn.style.display = 'inline-flex';
    reviewBtn.disabled = false;
    reviewBtn.textContent = `📌 Ôn lại ${wrong} câu sai`;
  } else {
    reviewBtn.style.display = 'none';
  }

  showScreen('results');

  // Check if this was a review topic quiz with 100% — auto-delete it
  checkReviewTopicCompletion();

  requestAnimationFrame(() => {
    ensureScoreGradient();
    const circumference = 2 * Math.PI * 52;
    const offset = circumference - (percent / 100) * circumference;
    const circle = document.getElementById('score-fill-circle');
    circle.style.strokeDashoffset = circumference;
    setTimeout(() => { circle.style.strokeDashoffset = offset; }, 100);
  });
}

function ensureScoreGradient() {
  const svg = document.querySelector('.score-circle svg');
  if (!svg || svg.querySelector('#scoreGradient')) return;
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
// REVIEW TOPICS: Create from wrong answers
// =============================================
async function createReviewTopic() {
  if (state.quizWrongQuestions.length === 0) {
    showToast('Không có câu sai để tạo chủ đề ôn lại!', 'error');
    return;
  }

  const btn = document.getElementById('btn-review-wrong');
  btn.disabled = true;
  btn.textContent = '⏳ Đang tạo...';

  try {
    // Determine the source topic ID (for the API endpoint)
    let sourceTopicId = state.currentTopicId;
    
    // For combined quiz, use first wrong question's topic or "0" as fallback
    if (String(sourceTopicId).startsWith('all')) {
      sourceTopicId = 0; // Use 0 for combined quiz
    }

    const res = await apiPost(`/topics/${sourceTopicId}/review`, {
      wrong_question_ids: state.quizWrongQuestions,
      round: state.quizRound
    });

    showToast(res.message);
    btn.textContent = '✅ Đã tạo chủ đề ôn lại!';
    btn.disabled = true;

    // After a moment, go back to home
    setTimeout(() => {
      showScreen('home');
      loadTopics();
    }, 1500);
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '📌 Ôn lại câu sai';
  }
}

// Auto-check if review quiz is 100% correct and delete the review topic
async function checkReviewTopicCompletion() {
  // Only applies to review topics (not combined quiz)
  if (String(state.currentTopicId).startsWith('all')) return;
  if (!state.currentTopic || !state.currentTopic.is_review) return;

  const total = state.quizQuestions.length;
  const correct = state.quizCorrectCount;

  if (correct === total) {
    // 100% correct! Auto-delete the review topic
    try {
      const res = await apiPost(`/review-topics/${state.currentTopicId}/complete`);
      showToast(res.message);
    } catch (err) {
      console.error('Failed to auto-delete review topic:', err);
    }
  }
}

// =============================================
// VOICE INPUT (Web Speech API)
// =============================================
function toggleVoiceInput(textareaId, btnElement) {
  // Check browser support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Trình duyệt của bạn không hỗ trợ nhập giọng nói. Vui lòng sử dụng Chrome hoặc Edge.', 'error');
    return;
  }

  // If already recording, stop
  if (state.activeVoiceRecognition && state.activeVoiceRecognition._targetId === textareaId) {
    state.activeVoiceRecognition.stop();
    return;
  }

  // Stop any existing recognition
  if (state.activeVoiceRecognition) {
    state.activeVoiceRecognition.stop();
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US'; // Default to English, will also pick up Vietnamese
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;
  recognition._targetId = textareaId;

  const textarea = document.getElementById(textareaId);
  let finalTranscript = textarea.value;
  
  recognition.onstart = () => {
    btnElement.classList.add('recording');
    btnElement.querySelector('.voice-icon').textContent = '⏹️';
    btnElement.title = 'Nhấn để dừng ghi âm';
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += (finalTranscript ? ' ' : '') + transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    textarea.value = finalTranscript + (interimTranscript ? ' ' + interimTranscript : '');
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      showToast('Vui lòng cho phép trình duyệt truy cập microphone!', 'error');
    } else if (event.error !== 'aborted') {
      showToast('Lỗi nhận diện giọng nói: ' + event.error, 'error');
    }
    btnElement.classList.remove('recording');
    btnElement.querySelector('.voice-icon').textContent = '🎤';
    btnElement.title = 'Nhập bằng giọng nói';
    state.activeVoiceRecognition = null;
  };

  recognition.onend = () => {
    btnElement.classList.remove('recording');
    btnElement.querySelector('.voice-icon').textContent = '🎤';
    btnElement.title = 'Nhập bằng giọng nói';
    state.activeVoiceRecognition = null;
  };

  recognition.start();
  state.activeVoiceRecognition = recognition;
}

// =============================================
// SCREEN: SETTINGS
// =============================================
async function openSettings() {
  if (!state.user || state.user.id !== 1) {
    showToast('Bạn không có quyền truy cập trang cài đặt!', 'error');
    return;
  }
  showScreen('settings');
  try {
    const res = await apiGet('/settings/gemini_api_key');
    document.getElementById('gemini-api-key').value = res.value || '';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveSettings() {
  const apiKey = document.getElementById('gemini-api-key').value.trim();
  try {
    await apiPut('/settings/gemini_api_key', { value: apiKey });
    showToast('Đã lưu API Key thành công!');
    document.getElementById('api-key-status').textContent = apiKey ? '✅ AI chấm điểm đã sẵn sàng hoạt động' : '⚠️ Chưa có API key, sẽ dùng chế độ so sánh trực tiếp';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =============================================
// ADMIN: USER MANAGEMENT
// =============================================
async function loadAdminUsers() {
  if (!state.user || state.user.id !== 1) {
    showToast('Bạn không có quyền truy cập trang quản lý!', 'error');
    return;
  }
  showScreen('admin');
  try {
    const users = await apiGet('/admin/users');
    const tbody = document.getElementById('admin-users-tbody');
    const empty = document.getElementById('empty-admin-users');
    const countBadge = document.getElementById('admin-user-count');

    countBadge.textContent = `${users.length} người dùng`;

    if (users.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      document.getElementById('admin-users-table').style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    document.getElementById('admin-users-table').style.display = 'table';

    tbody.innerHTML = users.map(u => {
      const createdAt = u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : 'N/A';
      const isAdmin = u.id === 1;
      return `
        <tr class="${isAdmin ? 'admin-row' : ''}">
          <td>${u.id}</td>
          <td>
            ${escapeHtml(u.username)}
            ${isAdmin ? '<span class="badge badge-admin">🔑 Admin</span>' : ''}
          </td>
          <td>${escapeHtml(u.display_name)}</td>
          <td>${createdAt}</td>
          <td><span class="stat-pill">📚 ${u.topic_count}</span></td>
          <td><span class="stat-pill">❓ ${u.question_count}</span></td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="viewUserDetail(${u.id})" title="Xem chi tiết">🔍</button>
            ${!isAdmin ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${escapeAttr(u.display_name)}')" title="Xóa">🗑️</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function viewUserDetail(userId) {
  try {
    const data = await apiGet(`/admin/users/${userId}`);
    const { user, topics } = data;

    document.getElementById('user-detail-title').textContent = `👤 ${user.display_name}`;
    const content = document.getElementById('user-detail-content');

    const createdAt = user.created_at ? new Date(user.created_at).toLocaleDateString('vi-VN', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'N/A';

    const totalQuestions = topics.reduce((sum, t) => sum + (t.questions ? t.questions.length : 0), 0);

    let html = `
      <div class="user-detail-info">
        <div class="user-detail-stat"><span class="stat-label">👤 Username:</span> <span>${escapeHtml(user.username)}</span></div>
        <div class="user-detail-stat"><span class="stat-label">📛 Tên hiển thị:</span> <span>${escapeHtml(user.display_name)}</span></div>
        <div class="user-detail-stat"><span class="stat-label">📅 Ngày tạo:</span> <span>${createdAt}</span></div>
        <div class="user-detail-stat"><span class="stat-label">📚 Chủ đề:</span> <span>${topics.length}</span></div>
        <div class="user-detail-stat"><span class="stat-label">❓ Câu hỏi:</span> <span>${totalQuestions}</span></div>
      </div>
    `;

    if (topics.length > 0) {
      html += '<h4 class="user-detail-section-title">📚 Danh sách chủ đề</h4>';
      html += topics.map(t => {
        const qList = t.questions && t.questions.length > 0
          ? t.questions.map((q, idx) => {
              const qType = q.question_type || 'multiple_choice';
              const typeLabel = qType === 'essay' ? '✍️ Tự luận' : '📋 Trắc nghiệm';
              return `<div class="user-detail-question">
                <span class="q-idx">${idx + 1}.</span>
                <span class="q-content">${escapeHtml(q.content)}</span>
                <span class="badge" style="font-size:0.65rem;padding:0.1rem 0.4rem;">${typeLabel}</span>
              </div>`;
            }).join('')
          : '<p style="color:var(--text-muted);font-style:italic;margin:0.5rem 0;">Chưa có câu hỏi</p>';

        return `
          <div class="user-detail-topic">
            <div class="user-detail-topic-header">
              <span class="topic-name">📖 ${escapeHtml(t.name)}</span>
              <span class="badge">${t.question_count} câu</span>
            </div>
            ${t.description ? `<p class="topic-desc">${escapeHtml(t.description)}</p>` : ''}
            <div class="user-detail-questions">${qList}</div>
          </div>
        `;
      }).join('');
    } else {
      html += '<p style="color:var(--text-muted);text-align:center;margin-top:1rem;">Người dùng chưa tạo chủ đề nào</p>';
    }

    content.innerHTML = html;
    openModal('modal-user-detail');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteUser(userId, displayName) {
  const confirmed = await showConfirm(
    '🗑️ Xóa người dùng?',
    `Bạn có chắc muốn xóa người dùng "${displayName}"? Tất cả chủ đề và câu hỏi của họ sẽ bị xóa vĩnh viễn.`
  );
  if (!confirmed) return;

  try {
    await apiDelete(`/admin/users/${userId}`);
    showToast('Đã xóa người dùng!');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =============================================
// ADMIN: REVIEW TOPICS MANAGEMENT
// =============================================
function switchAdminTab(tab) {
  document.getElementById('admin-tab-users').classList.toggle('active', tab === 'users');
  document.getElementById('admin-tab-review').classList.toggle('active', tab === 'review');
  document.getElementById('admin-panel-users').style.display = tab === 'users' ? 'block' : 'none';
  document.getElementById('admin-panel-review').style.display = tab === 'review' ? 'block' : 'none';

  if (tab === 'review') {
    loadAdminReviewTopics();
  }
}

async function loadAdminReviewTopics() {
  try {
    const topics = await apiGet('/admin/review-topics');
    const list = document.getElementById('admin-review-list');
    const empty = document.getElementById('empty-admin-review');

    if (topics.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    list.innerHTML = topics.map(t => {
      const createdAt = t.created_at ? new Date(t.created_at).toLocaleDateString('vi-VN') : 'N/A';
      return `
        <div class="admin-review-card">
          <div class="admin-review-info">
            <div class="admin-review-name">📌 ${escapeHtml(t.name)}</div>
            <div class="admin-review-meta">
              <span>👤 ${escapeHtml(t.owner_name || t.owner_username)}</span>
              <span>·</span>
              <span>❓ ${t.question_count} câu</span>
              <span>·</span>
              <span>📅 ${createdAt}</span>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="adminDeleteReviewTopic(${t.id}, '${escapeAttr(t.name)}')">🗑️ Xóa</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminDeleteReviewTopic(topicId, topicName) {
  const confirmed = await showConfirm(
    '🗑️ Xóa chủ đề ôn lại?',
    `Admin xóa chủ đề ôn lại "${topicName}"?`
  );
  if (!confirmed) return;

  try {
    await apiDelete(`/admin/review-topics/${topicId}`);
    showToast('Đã xóa chủ đề ôn lại!');
    loadAdminReviewTopics();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =============================================
// MODALS & UTILS
// =============================================
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  if (id === 'modal-create-topic') {
    document.getElementById('form-create-topic').reset();
    document.querySelector('#modal-create-topic .modal-header h3').textContent = '✨ Tạo chủ đề mới';
  }
}

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
  // ---- Auth Screen ----
  document.getElementById('tab-login').addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('form-login').style.display = 'block';
    document.getElementById('form-register').style.display = 'none';
  });

  document.getElementById('tab-register').addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('form-register').style.display = 'block';
    document.getElementById('form-login').style.display = 'none';
  });

  document.getElementById('form-login').addEventListener('submit', login);
  document.getElementById('form-register').addEventListener('submit', register);

  // ---- Header Actions ----
  document.getElementById('btn-home').addEventListener('click', () => {
    if (state.token) { showScreen('home'); loadTopics(); }
    else showScreen('auth');
  });

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-logout').addEventListener('click', () => logout(true));

  // ---- Home Screen ----
  document.getElementById('btn-create-topic').addEventListener('click', () => openModal('modal-create-topic'));
  document.getElementById('modal-close-topic').addEventListener('click', () => closeModal('modal-create-topic'));
  document.getElementById('modal-create-topic').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-create-topic'); });
  document.getElementById('form-create-topic').addEventListener('submit', createTopic);

  // ---- Manage Screen ----
  document.getElementById('btn-back-home').addEventListener('click', () => { hideQuestionForm(); showScreen('home'); loadTopics(); });
  document.getElementById('btn-add-question').addEventListener('click', () => showQuestionForm());
  document.getElementById('btn-cancel-question').addEventListener('click', () => hideQuestionForm());
  document.getElementById('form-question').addEventListener('submit', saveQuestion);
  document.getElementById('btn-start-quiz').addEventListener('click', () => { state.quizRound = 1; startQuiz(); });

  // Question Type Switcher
  document.querySelectorAll('input[name="question_type"]').forEach(radio => {
    radio.addEventListener('change', (e) => switchQuestionType(e.target.value));
  });

  // Import / Export
  document.getElementById('btn-import-json').addEventListener('click', openImportModal);
  document.getElementById('btn-export-json').addEventListener('click', exportJson);
  document.getElementById('modal-close-import').addEventListener('click', () => closeModal('modal-import'));
  document.getElementById('btn-cancel-import').addEventListener('click', () => closeModal('modal-import'));
  document.getElementById('btn-parse-file').addEventListener('click', parseAndPreview);
  document.getElementById('btn-do-import').addEventListener('click', doImport);
  document.getElementById('btn-preview-back').addEventListener('click', () => showImportStep(1));
  document.getElementById('btn-import-done').addEventListener('click', closeImportAndRefresh);
  document.getElementById('btn-remove-file').addEventListener('click', removeSelectedFile);

  // Drag & Drop zone
  const dropzone = document.getElementById('import-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelected(e.dataTransfer.files[0]);
        // Also set the file input for consistency
        const fileInput = document.getElementById('import-file');
        const dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        fileInput.files = dt.files;
      }
    });
  }

  // File input change
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
  });

  // Paste text format detection
  document.getElementById('import-text-input').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    document.getElementById('paste-format-group').style.display = val ? 'block' : 'none';
  });

  // Format radio toggle
  document.querySelectorAll('input[name="paste_format"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.format-radio').forEach(r => r.classList.remove('active'));
      radio.closest('.format-radio').classList.add('active');
    });
  });

  // ---- Quiz Screen ----
  document.getElementById('btn-next-question').addEventListener('click', nextQuestion);
  document.getElementById('btn-submit-essay').addEventListener('click', submitEssay);
  document.getElementById('btn-quit-quiz').addEventListener('click', async () => {
    const confirmed = await showConfirm('⚠️ Thoát Quiz?', 'Tiến trình làm quiz hiện tại sẽ bị mất. Bạn có chắc muốn thoát?');
    if (confirmed) {
      if (String(state.currentTopicId).startsWith('all')) {
        showScreen('home'); loadTopics();
      } else {
        showScreen('manage'); loadQuestions();
      }
    }
  });

  // ---- Results Screen ----
  document.getElementById('btn-retry-quiz').addEventListener('click', retryQuiz);
  document.getElementById('btn-review-wrong').addEventListener('click', createReviewTopic);
  document.getElementById('btn-back-to-topic').addEventListener('click', () => {
    state.quizRound = 1;
    if (String(state.currentTopicId).startsWith('all')) {
      showScreen('home'); loadTopics();
    } else {
      showScreen('manage'); loadQuestions();
    }
  });

  // ---- Settings Screen ----
  document.getElementById('btn-back-from-settings').addEventListener('click', () => { showScreen('home'); loadTopics(); });
  document.getElementById('btn-save-api-key').addEventListener('click', saveSettings);

  // ---- Admin Screen ----
  document.getElementById('btn-admin-users').addEventListener('click', loadAdminUsers);
  document.getElementById('btn-back-from-admin').addEventListener('click', () => { showScreen('home'); loadTopics(); });
  document.getElementById('modal-close-user-detail').addEventListener('click', () => closeModal('modal-user-detail'));
  document.getElementById('modal-user-detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-user-detail'); });

  // ---- AI Review ----
  document.getElementById('btn-submit-review').addEventListener('click', submitUserReview);

  // ---- Initial Start ----
  initAuth();
});
