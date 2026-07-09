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
// IMPORT / EXPORT JSON
// =============================================
function openImportModal() {
  document.getElementById('import-file').value = '';
  document.getElementById('import-json-text').value = '';
  openModal('modal-import');
}

async function doImport() {
  const fileInput = document.getElementById('import-file');
  const textInput = document.getElementById('import-json-text').value.trim();

  let questions = [];

  try {
    if (fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      const text = await file.text();
      questions = JSON.parse(text);
    } else if (textInput) {
      questions = JSON.parse(textInput);
    } else {
      showToast('Vui lòng chọn file JSON hoặc paste nội dung vào ô!', 'error');
      return;
    }
  } catch (e) {
    showToast('Cấu trúc JSON không hợp lệ! Vui lòng kiểm tra lại.', 'error');
    return;
  }

  try {
    const res = await apiPost(`/topics/${state.currentTopicId}/import`, { questions });
    showToast(`Đã import thành công ${res.imported}/${res.total} câu hỏi!`);
    if (res.errors && res.errors.length > 0) {
      console.warn('Import errors:', res.errors);
      alert('Một số câu hỏi bị lỗi:\n' + res.errors.slice(0, 5).join('\n') + (res.errors.length > 5 ? '\n...' : ''));
    }
    closeModal('modal-import');
    loadQuestions();
  } catch (err) {
    showToast(err.message, 'error');
  }
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
  if (isCorrect) state.quizCorrectCount++;

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

  showScreen('results');

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
  document.getElementById('btn-do-import').addEventListener('click', doImport);

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
