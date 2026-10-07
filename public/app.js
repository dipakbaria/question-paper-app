// Global Application State
let dbData = { chapters: [], papers: [] };
let currentPaper = null;
let currentRole = 'teacher';
let currentUser = null; // { id, name, mobile, role, schoolId, schoolName, cityName, standard }
let adminPasscode = '';
let sharedFeed = [];

// Master Subjects List
let masterSubjects = ['EVS', 'English', 'Maths', 'Science', 'Gujarati', 'Hindi', 'Social Science', 'General Knowledge', 'Computer', 'Moral Science'];

// Paper Type Question Headings Structure for Exam Studio
let paperTypeHeadings = [
  'Q1. Tick (✓) the correct option:',
  'Q2. Fill in the blanks:',
  'Q3. Write \'T\' for true and \'F\' for false statements:',
  'Q4. Answer the following questions:'
];

let currentExamMode = 'auto'; // 'auto' or 'manual'
let manualSelectedQuestionIds = [];

// Check if running inside native Android / iOS app build or mobile standalone PWA
function isNativeMobileDevice() {
  const ua = navigator.userAgent.toLowerCase();
  const isCapacitor = window.Capacitor !== undefined || window.cordova !== undefined;
  const isMobileUA = /android|iphone|ipad|ipod|mobile/i.test(ua);
  return isCapacitor || (isMobileUA && window.matchMedia('(display-mode: standalone)').matches);
}

// DOM Loaded Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadMasterSubjects();
  loadPaperHeadings();
  enforcePlatformSecurityRules();
  checkAuthSession();
  loadQuestionBank();
  checkGlobalApiKeyStatus();
});

async function saveGlobalAdminApiKey(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('admin-global-api-key');
  const key = input ? input.value.trim() : '';

  if (!key) {
    showToast('Please enter Gemini API Key', 'error');
    return;
  }

  try {
    const res = await fetch('/api/config-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Saved Master Gemini API Key for all schools!', 'success');
      localStorage.setItem('paper_ai_gemini_key', key);
      checkGlobalApiKeyStatus();
      if (input) input.value = '';
    } else {
      showToast(data.error || 'Failed to save key', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server', 'error');
  }
}

async function checkGlobalApiKeyStatus() {
  const statusLabel = document.getElementById('admin-key-status-label');
  try {
    const res = await fetch('/api/config-key');
    if (res.ok) {
      const data = await res.json();
      if (statusLabel) {
        if (data.hasKey) {
          statusLabel.className = 'text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200';
          statusLabel.innerText = `✓ Active Master Key (${data.maskedKey || 'Set'})`;
        } else {
          statusLabel.className = 'text-[11px] font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded border border-rose-200';
          statusLabel.innerText = `⚠ No Master Key Set`;
        }
      }
    }
  } catch (e) {}
}

// Load saved custom subjects
function loadMasterSubjects() {
  try {
    const saved = localStorage.getItem('paper_ai_master_subjects');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) masterSubjects = parsed;
    }
  } catch (e) {}
  populateAllSubjectDropdowns();
}

function saveMasterSubjects() {
  try {
    localStorage.setItem('paper_ai_master_subjects', JSON.stringify(masterSubjects));
  } catch (e) {}
  populateAllSubjectDropdowns();
}

function populateAllSubjectDropdowns() {
  const uploadSelect = document.getElementById('upload-subject');
  const examSelect = document.getElementById('exam-subject-select');
  const filterSelect = document.getElementById('filter-subject');

  if (uploadSelect) {
    const currentVal = uploadSelect.value;
    uploadSelect.innerHTML = masterSubjects.map(s => `<option value="${s}">${s}</option>`).join('') +
      `<option value="ADD_NEW" class="font-bold text-indigo-600">+ Add New Subject...</option>`;
    if (currentVal && masterSubjects.includes(currentVal)) uploadSelect.value = currentVal;
  }

  if (examSelect) {
    const currentVal = examSelect.value;
    examSelect.innerHTML = masterSubjects.map(s => `<option value="${s}">${s}</option>`).join('');
    if (currentVal && masterSubjects.includes(currentVal)) examSelect.value = currentVal;
  }

  if (filterSelect) {
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = `<option value="ALL">All Subjects</option>` + masterSubjects.map(s => `<option value="${s}">${s}</option>`).join('');
    if (currentVal) filterSelect.value = currentVal;
  }
}

function onUploadSubjectChange(selectEl) {
  const container = document.getElementById('container-add-subject');
  if (selectEl.value === 'ADD_NEW') {
    if (container) container.classList.remove('hidden');
  } else {
    if (container) container.classList.add('hidden');
  }
}

function addNewCustomSubject() {
  const input = document.getElementById('input-custom-subject');
  const name = input ? input.value.trim() : '';

  if (!name) {
    showToast('Please enter subject name', 'error');
    return;
  }

  if (!masterSubjects.includes(name)) {
    masterSubjects.push(name);
    saveMasterSubjects();
    showToast(`Added custom subject '${name}'!`);
  }

  const uploadSelect = document.getElementById('upload-subject');
  if (uploadSelect) uploadSelect.value = name;

  const container = document.getElementById('container-add-subject');
  if (container) container.classList.add('hidden');
  if (input) input.value = '';
}

function loadPaperHeadings() {
  try {
    const saved = localStorage.getItem('paper_ai_paper_headings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) paperTypeHeadings = parsed;
    }
  } catch (e) {}
  updatePaperHeadingCountLabel();
}

function savePaperHeadings() {
  try {
    localStorage.setItem('paper_ai_paper_headings', JSON.stringify(paperTypeHeadings));
  } catch (e) {}
  updatePaperHeadingCountLabel();
}

function updatePaperHeadingCountLabel() {
  const label = document.getElementById('exam-heading-count-label');
  if (label) label.innerText = `${paperTypeHeadings.length} Headings Configured`;
}

function enforcePlatformSecurityRules() {
  if (isNativeMobileDevice()) {
    const adminTab = document.getElementById('tab-admin');
    const adminLoginOption = document.getElementById('admin-login-option-container');
    if (adminTab) adminTab.classList.add('hidden');
    if (adminLoginOption) adminLoginOption.classList.add('hidden');
  }
}

function checkAuthSession() {
  try {
    const savedUser = localStorage.getItem('paper_ai_user');
    const savedPass = localStorage.getItem('paper_ai_admin_pass');
    if (savedPass) adminPasscode = savedPass;

    if (savedUser) {
      currentUser = JSON.parse(savedUser);
      updateUserInfoBar();
      switchRole(currentUser.role || 'teacher');
      if (currentUser.role === 'admin') loadAdminDirectory();
    } else {
      openLoginModal();
    }
  } catch (err) {
    openLoginModal();
  }
}

function updateUserInfoBar() {
  if (!currentUser) return;
  const nameEl = document.getElementById('bar-user-name');
  const roleEl = document.getElementById('bar-user-role-label');
  const schoolEl = document.getElementById('bar-school-name');

  if (nameEl) nameEl.innerText = currentUser.name || 'User';
  if (roleEl) roleEl.innerText = `${currentUser.role.toUpperCase()} PROFILE`;
  if (schoolEl) {
    const city = currentUser.cityName ? `, ${currentUser.cityName}` : '';
    schoolEl.innerHTML = `<i class="fa-solid fa-school text-indigo-500 mr-1"></i> ${currentUser.schoolName || 'School'}${city}`;
  }
}

async function openLoginModal() {
  await loadPublicSchools();
  switchAuthTab('login');
  openModal('modal-login');
}

// Switch between Login and Register tabs in Auth Modal
function switchAuthTab(tab) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabLoginBtn = document.getElementById('auth-tab-login');
  const tabRegisterBtn = document.getElementById('auth-tab-register');

  if (tab === 'register') {
    if (loginForm) loginForm.classList.add('hidden');
    if (registerForm) registerForm.classList.remove('hidden');
    if (tabLoginBtn) tabLoginBtn.className = 'flex-1 py-2 rounded-lg text-slate-600 hover:text-slate-900 transition font-bold';
    if (tabRegisterBtn) tabRegisterBtn.className = 'flex-1 py-2 rounded-lg bg-emerald-600 text-white shadow transition font-bold';
    onRegisterRoleChange();
  } else {
    if (loginForm) loginForm.classList.remove('hidden');
    if (registerForm) registerForm.classList.add('hidden');
    if (tabLoginBtn) tabLoginBtn.className = 'flex-1 py-2 rounded-lg bg-indigo-600 text-white shadow transition font-bold';
    if (tabRegisterBtn) tabRegisterBtn.className = 'flex-1 py-2 rounded-lg text-slate-600 hover:text-slate-900 transition font-bold';
    onLoginRoleChange();
  }
}

const defaultSchoolsList = [
  { id: 'sch_dps01', name: 'Delhi Public School', code: 'DPS01' },
  { id: 'sch_gseb01', name: 'GSEB Model High School', code: 'GSEB01' },
  { id: 'sch_model01', name: 'Model High School', code: 'MHS01' }
];

async function loadPublicSchools() {
  const loginSelect = document.getElementById('login-school-id');
  const regSelect = document.getElementById('reg-school-id');
  
  let schools = [...defaultSchoolsList];

  try {
    const res = await fetch('/api/schools');
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data && Array.isArray(data.schools) && data.schools.length > 0) schools = data.schools;
      }
    }
  } catch (err) {}

  // Merge locally stored schools added by Admin or users
  try {
    const savedLocal = JSON.parse(localStorage.getItem('paper_ai_local_schools') || '[]');
    savedLocal.forEach(ls => {
      if (!schools.some(s => s.id === ls.id || s.name.toLowerCase() === ls.name.toLowerCase())) {
        schools.push(ls);
      }
    });
  } catch (e) {}

  const populateSelect = (sel) => {
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '';
    schools.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const codeText = s.code ? ` (Code/Locality: ${s.code})` : '';
      opt.innerText = `${s.name}${codeText}`;
      sel.appendChild(opt);
    });
    if (currentVal && schools.some(s => s.id === currentVal)) sel.value = currentVal;
  };

  populateSelect(loginSelect);
  populateSelect(regSelect);
}

function toggleAddSchoolFields() {
  const container = document.getElementById('container-add-school');
  if (container) container.classList.toggle('hidden');
}

function addNewSchoolWithLocality() {
  const nameInput = document.getElementById('new-school-name');
  const localityInput = document.getElementById('new-school-locality');

  const rawName = nameInput ? nameInput.value.trim() : '';
  const rawLocality = localityInput ? localityInput.value.trim() : '';

  if (!rawName) {
    showToast('Please enter School Name', 'error');
    return;
  }

  if (!rawLocality) {
    showToast('missing locality name', 'error');
    return;
  }

  const formattedSchoolName = `${rawName}, ${rawLocality}`;
  const select = document.getElementById('reg-school-id') || document.getElementById('login-school-id');
  
  if (select) {
    const newSchoolId = 'sch_' + Date.now();
    const newCode = rawLocality.substr(0, 3).toUpperCase() + Math.floor(10 + Math.random() * 90);

    const newOpt = document.createElement('option');
    newOpt.value = newSchoolId;
    newOpt.innerText = `${formattedSchoolName} (Code: ${newCode})`;
    select.appendChild(newOpt);
    select.value = newSchoolId;

    const savedLocal = JSON.parse(localStorage.getItem('paper_ai_local_schools') || '[]');
    savedLocal.push({ id: newSchoolId, name: formattedSchoolName, code: newCode });
    localStorage.setItem('paper_ai_local_schools', JSON.stringify(savedLocal));

    fetch('/api/admin/school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-passcode': adminPasscode || 'admin123' },
      body: JSON.stringify({ name: formattedSchoolName, code: newCode })
    }).catch(() => {});

    showToast(`Added '${formattedSchoolName}'!`);
    toggleAddSchoolFields();
    if (nameInput) nameInput.value = '';
    if (localityInput) localityInput.value = '';
    loadPublicSchools();
  }
}

function onRegisterRoleChange() {
  const roleRadios = document.getElementsByName('reg-role');
  let selectedRole = 'teacher';
  for (const r of roleRadios) {
    if (r.checked) selectedRole = r.value;
  }

  const nameLabel = document.getElementById('label-reg-name-input');
  if (nameLabel) {
    if (selectedRole === 'teacher') nameLabel.innerText = 'Teacher Name';
    else if (selectedRole === 'parent') nameLabel.innerText = 'Student Name';
  }
}

function onLoginRoleChange() {
  const roleRadios = document.getElementsByName('login-role');
  let selectedRole = 'teacher';
  for (const r of roleRadios) {
    if (r.checked) selectedRole = r.value;
  }
}

// Handle User Registration Submit (Safe JSON parsing & Password verification)
async function handleUserRegisterSubmit(e) {
  e.preventDefault();

  const roleRadios = document.getElementsByName('reg-role');
  let role = 'teacher';
  for (const r of roleRadios) {
    if (r.checked) role = r.value;
  }

  const std = document.getElementById('reg-user-std').value;
  const name = document.getElementById('reg-user-name').value.trim();
  const city = document.getElementById('reg-user-city').value.trim();
  const mobile = document.getElementById('reg-user-mobile').value.trim();
  const selectSchool = document.getElementById('reg-school-id');
  const schoolId = selectSchool ? selectSchool.value : 'sch_dps01';
  const schoolText = (selectSchool && selectSchool.options[selectSchool.selectedIndex])
    ? selectSchool.options[selectSchool.selectedIndex].text.split(' (Code:')[0]
    : 'Delhi Public School';

  const pass = document.getElementById('reg-user-pass').value.trim();
  const passConfirm = document.getElementById('reg-user-pass-confirm').value.trim();

  if (!name || !mobile || !city) {
    showToast('Please fill all registration fields!', 'error');
    return;
  }

  if (!pass || pass.length < 3) {
    showToast('Password must be at least 3 characters long', 'error');
    return;
  }

  if (pass !== passConfirm) {
    showToast('Password and Confirm Password do not match!', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-register');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registering Account...`;

  try {
    let result = null;

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mobile,
          role,
          standard: std,
          schoolId,
          cityName: city,
          password: pass
        })
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          result = await response.json();
        }
      } else {
        const errText = await response.text();
        let errJson = {};
        try { errJson = JSON.parse(errText); } catch(e) {}
        throw new Error(errJson.error || `Registration failed (HTTP ${response.status})`);
      }
    } catch (netErr) {
      if (netErr.message && !netErr.message.includes('fetch')) throw netErr;
    }

    if (!result) {
      const newUserObj = {
        id: 'usr_' + Date.now(),
        name,
        mobile,
        role,
        standard: std,
        schoolId,
        schoolName: schoolText,
        cityName: city,
        password: pass
      };
      
      const localUsers = JSON.parse(localStorage.getItem('paper_ai_local_users') || '[]');
      localUsers.push(newUserObj);
      localStorage.setItem('paper_ai_local_users', JSON.stringify(localUsers));

      result = {
        success: true,
        message: 'Registration successful! Please login with your password.'
      };
    }

    showToast(result.message || 'Registration successful! Please login.');
    switchAuthTab('login');
    const loginMobile = document.getElementById('login-input-mobile');
    if (loginMobile) loginMobile.value = mobile;

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Create Account & Register`;
  }
}

// Handle User Login Submit
async function handleUserLoginSubmit(e) {
  e.preventDefault();

  const roleRadios = document.getElementsByName('login-role');
  let role = 'teacher';
  for (const r of roleRadios) {
    if (r.checked) role = r.value;
  }

  if (role === 'admin' && isNativeMobileDevice()) {
    showToast('Head Admin Portal is available strictly on Web Browser only!', 'error');
    return;
  }

  const mobileOrName = document.getElementById('login-input-mobile').value.trim();
  const password = document.getElementById('login-input-password').value.trim();

  const btn = document.getElementById('btn-submit-login');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing in...`;

  try {
    let authUser = null;

    try {
      const response = await fetch('/api/auth/login-mobile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobile: mobileOrName,
          name: mobileOrName,
          password,
          role,
          adminPasscode: password
        })
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const result = await response.json();
          if (result.success) authUser = result.user;
          else throw new Error(result.error || 'Invalid credentials');
        }
      } else {
        const errText = await response.text();
        let errJson = {};
        try { errJson = JSON.parse(errText); } catch(e) {}
        throw new Error(errJson.error || `Login failed (HTTP ${response.status})`);
      }
    } catch (netErr) {
      if (netErr.message && !netErr.message.includes('fetch')) throw netErr;
    }

    if (!authUser) {
      const localUsers = JSON.parse(localStorage.getItem('paper_ai_local_users') || '[]');
      const match = localUsers.find(u => (u.mobile === mobileOrName || u.name.toLowerCase() === mobileOrName.toLowerCase()) && u.role === role);
      if (match) {
        if (match.password && password && match.password !== password) {
          throw new Error('Incorrect Password! Please check and try again.');
        }
        authUser = match;
      }
    }

    if (!authUser) {
      authUser = {
        id: 'usr_' + (mobileOrName || Date.now()),
        name: mobileOrName || 'User',
        mobile: mobileOrName || '9876543210',
        role: role,
        standard: 'Std 5',
        schoolId: 'sch_dps01',
        schoolName: 'Delhi Public School'
      };
    }

    currentUser = authUser;
    if (role === 'admin') {
      adminPasscode = password || 'admin123';
      localStorage.setItem('paper_ai_admin_pass', adminPasscode);
    }

    localStorage.setItem('paper_ai_user', JSON.stringify(currentUser));
    updateUserInfoBar();
    closeModal('modal-login');
    showToast(`Welcome ${currentUser.name}! Signed in successfully.`);
    
    switchRole(currentUser.role);
    if (currentUser.role === 'admin') loadAdminDirectory();

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Sign In To Studio`;
  }
}

// Role Switcher & Permissions Enforcement
function switchRole(role) {
  if (role === 'admin' && isNativeMobileDevice()) {
    showToast('Head Admin Portal is available strictly on Web Browser only!', 'error');
    return;
  }

  currentRole = role;

  const tabTeacher = document.getElementById('tab-teacher');
  const tabParent = document.getElementById('tab-parent');
  const tabAdmin = document.getElementById('tab-admin');

  if (tabTeacher) tabTeacher.className = role === 'teacher' ? 'px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 bg-white text-indigo-900 shadow-md font-bold' : 'px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 text-indigo-100 hover:text-white';
  if (tabParent) tabParent.className = role === 'parent' ? 'px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 bg-white text-indigo-900 shadow-md font-bold' : 'px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 text-indigo-100 hover:text-white';
  if (tabAdmin) tabAdmin.className = role === 'admin' ? 'px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 bg-white text-indigo-900 shadow-md font-bold' : 'px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 text-indigo-100 hover:text-white';

  // Keep studio views hidden initially so ONLY Header and 4 Cards are shown!
  document.getElementById('role-teacher-view').classList.add('hidden');
  document.getElementById('role-parent-view').classList.add('hidden');
  document.getElementById('role-admin-view').classList.toggle('hidden', role !== 'admin');

  const badgeLock = document.getElementById('badge-exam-locked');
  const examSubtitle = document.getElementById('card-exam-subtitle');
  const examIcon = document.getElementById('card-exam-icon');
  const examActionLabel = document.getElementById('card-exam-action-label');

  if (role === 'parent') {
    if (badgeLock) badgeLock.classList.remove('hidden');
    if (badgeLock) badgeLock.classList.add('flex');
    if (examSubtitle) examSubtitle.innerText = 'Exam paper generator (Locked)';
    if (examIcon) examIcon.className = 'fa-solid fa-lock text-amber-300';
    if (examActionLabel) examActionLabel.innerText = 'Locked for Parents';
  } else {
    if (badgeLock) badgeLock.classList.add('hidden');
    if (badgeLock) badgeLock.classList.remove('flex');
    if (examSubtitle) examSubtitle.innerText = 'Auto / Manual exam paper generator';
    if (examIcon) examIcon.className = 'fa-solid fa-file-signature';
    if (examActionLabel) examActionLabel.innerText = 'Open Exam Studio';
    if (role === 'admin') loadAdminDirectory();
  }
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'bg-emerald-600' : 'bg-rose-600';
  toast.className = `${bgColor} text-white px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0`;
  toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${msg}`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 50);
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function saveModalApiKey(val) {
  if (val && val.trim()) {
    const key = val.trim();
    localStorage.setItem('paper_ai_gemini_key', key);
    localStorage.setItem('gemini_api_key', key);
    showToast('Saved Gemini API Key for live AI photo extraction!', 'success');
  }
}

function openWorkModal(workType) {
  const titleEl = document.getElementById('upload-modal-title');
  const workTypeInput = document.getElementById('upload-work-type');
  const dateInput = document.getElementById('upload-date');
  const apiKeyInput = document.getElementById('input-modal-api-key');

  if (workTypeInput) workTypeInput.value = workType;
  if (titleEl) {
    if (workType === 'homework') titleEl.innerHTML = `<i class="fa-solid fa-house-laptop text-emerald-600"></i> Upload Home Work Photos`;
    else titleEl.innerHTML = `<i class="fa-solid fa-chalkboard-user text-blue-600"></i> Upload Class Work Photos`;
  }

  if (dateInput && !dateInput.value) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
  }

  if (apiKeyInput) {
    const saved = localStorage.getItem('paper_ai_gemini_key') || localStorage.getItem('gemini_api_key') || '';
    apiKeyInput.value = saved;
  }

  populateAllSubjectDropdowns();
  openModal('modal-upload');
}

function updateFileCountLabel() {
  const fileInput = document.getElementById('upload-files');
  const cameraInput = document.getElementById('camera-files');
  const statusLabel = document.getElementById('upload-file-status');
  if (!statusLabel) return;

  const galleryCount = (fileInput && fileInput.files) ? fileInput.files.length : 0;
  const cameraCount = (cameraInput && cameraInput.files) ? cameraInput.files.length : 0;
  const totalCount = galleryCount + cameraCount;

  if (totalCount === 0) {
    statusLabel.innerText = 'No photos selected yet.';
  } else {
    statusLabel.innerText = `✓ ${totalCount} photo(s) selected & ready for AI processing`;
  }
}

function addCameraPhotoToUpload(input) {
  if (input && input.files && input.files.length > 0) {
    updateFileCountLabel();
    showToast('Photo captured from Live Camera!', 'success');
  }
}

async function loadQuestionBank() {
  try {
    const res = await fetch('/api/question-bank');
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        dbData = await res.json();
      }
    }
  } catch (err) {
    const savedDb = localStorage.getItem('paper_ai_question_bank');
    if (savedDb) {
      try { dbData = JSON.parse(savedDb); } catch (e) {}
    }
  }

  if (!dbData.chapters) dbData.chapters = [];
  if (!dbData.papers) dbData.papers = [];

  renderChapterList();
  renderQuestionBankList();
  populateAllSubjectDropdowns();
}

async function saveQuestionBank() {
  try {
    localStorage.setItem('paper_ai_question_bank', JSON.stringify(dbData));
  } catch (e) {}

  try {
    await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dbData)
    });
  } catch (err) {}
}

function renderChapterList() {
  const filterSubEl = document.getElementById('filter-subject');
  const chapterSelect = document.getElementById('filter-chapter');
  
  if (!filterSubEl || !chapterSelect) return;
  const selectedSubject = filterSubEl.value;
  chapterSelect.innerHTML = '<option value="ALL">All Chapters</option>';
  
  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      if (selectedSubject === 'ALL' || ch.subject.toLowerCase() === selectedSubject.toLowerCase()) {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.innerText = `Ch ${ch.chapterNo}: ${ch.chapterName} (${ch.subject})`;
        chapterSelect.appendChild(opt);
      }
    });
  }

  renderQuestionBankList();
}

function renderQuestionBankList() {
  const container = document.getElementById('question-bank-container');
  const filterSubEl = document.getElementById('filter-subject');
  const filterChapEl = document.getElementById('filter-chapter');
  if (!container || !filterSubEl || !filterChapEl) return;

  const selectedSubject = filterSubEl.value;
  const selectedChapterId = filterChapEl.value;

  let allQuestions = [];
  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      const matchSub = (selectedSubject === 'ALL' || ch.subject.toLowerCase() === selectedSubject.toLowerCase());
      const matchChap = (selectedChapterId === 'ALL' || ch.id === selectedChapterId);
      if (matchSub && matchChap && ch.questions) {
        ch.questions.forEach(q => {
          allQuestions.push({ ...q, chapterNo: ch.chapterNo, chapterName: ch.chapterName, subject: ch.subject });
        });
      }
    });
  }

  if (allQuestions.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs italic">No questions found. Click "HOME WORK" or "CLASS WORK" to upload photos.</div>`;
    return;
  }

  container.innerHTML = allQuestions.map((q, idx) => `
    <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 hover:border-indigo-300 transition">
      <div class="flex justify-between items-start">
        <span class="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded">
          ${q.subject} | Ch ${q.chapterNo} ${q.workType ? '| ' + q.workType.toUpperCase() : ''}
        </span>
        <span class="text-[10px] font-medium text-slate-400">Q${idx + 1}</span>
      </div>
      <p class="text-xs font-semibold text-slate-800 line-clamp-2">${q.heading || ''}: ${q.question || q.text || ''}</p>
    </div>
  `).join('');
}

function compressImage(file, maxWidth = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

function cleanTextPrefix(str) {
  return (str || '').replace(/^Q\d*[\.:\s]*/i, '').trim();
}

function isSimilarToSeen(qText, existingQSet) {
  const cleanQ = cleanTextPrefix(qText).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanQ.length < 4) return false;
  return existingQSet.has(cleanQ);
}

async function handleImageUpload(e) {
  e.preventDefault();

  const workType = document.getElementById('upload-work-type').value || 'homework';
  const dateVal = document.getElementById('upload-date').value || new Date().toISOString().split('T')[0];
  const stdVal = document.getElementById('upload-std').value || 'Std 5';
  const subject = document.getElementById('upload-subject').value.trim();
  const chapterNo = document.getElementById('upload-chap-no').value.trim();
  const chapterName = document.getElementById('upload-chap-name').value.trim();

  const fileInput = document.getElementById('upload-files');
  const cameraInput = document.getElementById('camera-files');

  const filesArr = [];
  if (fileInput && fileInput.files) Array.from(fileInput.files).forEach(f => filesArr.push(f));
  if (cameraInput && cameraInput.files) Array.from(cameraInput.files).forEach(f => filesArr.push(f));

  if (filesArr.length === 0) {
    showToast('Please select at least one photo or capture from camera', 'error');
    return;
  }

  const btnSubmit = document.getElementById('btn-submit-upload');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing AI Vision...`;

  try {
    const base64Promises = filesArr.map(file => compressImage(file, 1600, 0.85));
    const base64Images = await Promise.all(base64Promises);

    let result = null;
    let errMessage = 'Failed to extract questions. Please check your Gemini API key.';
    try {
      const modalKeyEl = document.getElementById('input-modal-api-key');
      const modalKeyVal = modalKeyEl ? modalKeyEl.value.trim() : '';
      const savedClientKey = modalKeyVal || localStorage.getItem('paper_ai_gemini_key') || localStorage.getItem('gemini_api_key') || '';

      if (modalKeyVal) {
        localStorage.setItem('paper_ai_gemini_key', modalKeyVal);
        localStorage.setItem('gemini_api_key', modalKeyVal);
      }

      const response = await fetch('/api/convert-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: base64Images, subject, chapterNo, chapterName, apiKey: savedClientKey })
      });

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        result = await response.json();
      }

      if (!response.ok && result && result.error) {
        errMessage = result.error;
      }
    } catch (netErr) {
      errMessage = netErr.message || 'Network error while contacting AI vision server.';
    }

    if (!result || !result.success || !result.extractedData) {
      showToast(errMessage, 'error');
      const keyInput = document.getElementById('input-modal-api-key');
      if (keyInput) {
        keyInput.focus();
        keyInput.classList.add('ring-4', 'ring-rose-500');
      }
      return;
    }

    const extracted = result.extractedData;
    let existingChapter = dbData.chapters.find(c => c.subject.toLowerCase() === subject.toLowerCase() && c.chapterNo.toString() === chapterNo.toString());

    if (!existingChapter) {
      existingChapter = {
        id: 'ch_' + Date.now(),
        subject,
        chapterNo,
        chapterName,
        standard: stdVal,
        questions: []
      };
      dbData.chapters.push(existingChapter);
    } else {
      existingChapter.chapterName = chapterName;
      existingChapter.standard = stdVal;
      if (!existingChapter.questions) existingChapter.questions = [];
    }

    const existingQSet = new Set(existingChapter.questions.map(q => cleanTextPrefix(q.question || q.text || '').toLowerCase().replace(/[^a-z0-9]/g, '')));

    let addedCount = 0;
    if (extracted.sectionQuestions) {
      extracted.sectionQuestions.forEach(sec => {
        if (sec.items && Array.isArray(sec.items)) {
          sec.items.forEach(item => {
            let qText = '';
            if (typeof item === 'string') qText = item;
            else if (typeof item === 'object' && item !== null) qText = item.question || item.text || item.statement || '';

            const cleanQ = cleanTextPrefix(qText).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanQ.length > 3 && isSimilarToSeen(qText, existingQSet)) return;
            if (cleanQ.length > 3) existingQSet.add(cleanQ);

            const qObj = {
              id: 'q_' + Math.random().toString(36).substr(2, 9),
              type: sec.type,
              heading: sec.heading,
              workType,
              date: dateVal,
              standard: stdVal,
              createdAt: new Date().toISOString()
            };

            if (typeof item === 'string') {
              qObj.text = item;
              qObj.question = item;
            } else if (typeof item === 'object' && item !== null) {
              qObj.question = item.question || item.text || '';
              qObj.text = item.text || item.question || '';
              qObj.options = item.options;
              qObj.answer = item.answer || '';
            }

            existingChapter.questions.push(qObj);
            addedCount++;
          });
        }
      });
    }

    await saveQuestionBank();
    closeModal('modal-upload');
    showToast(`Extracted ${addedCount} questions into ${stdVal} ${subject} Ch ${chapterNo}!`);
    await loadQuestionBank();

    currentPaper = {
      title: `${workType.toUpperCase()} - ${stdVal} ${subject}`,
      isClasswork: (workType === 'classwork' || workType === 'homework'),
      schoolName: currentUser ? currentUser.schoolName : 'School Name',
      date: dateVal,
      standard: stdVal,
      subject: subject,
      chapterNo: chapterNo,
      chapterName: chapterName,
      groupedHeadings: groupQuestionsByHeading(existingChapter.questions)
    };

    document.getElementById('role-teacher-view').classList.remove('hidden');
    renderA4PaperDOM();
    const studio = document.getElementById('role-teacher-view');
    if (studio) studio.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles font-bold"></i> Process & Extract Questions`;
  }
}

function groupQuestionsByHeading(questions) {
  const grouped = {};
  if (!questions) return grouped;
  questions.forEach(q => {
    const h = q.heading || 'General Questions';
    if (!grouped[h]) grouped[h] = [];
    grouped[h].push(q);
  });
  return grouped;
}

function showDashboardHome() {
  document.getElementById('role-teacher-view').classList.add('hidden');
  document.getElementById('role-parent-view').classList.add('hidden');
  document.getElementById('role-admin-view').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleExamPaperCardClick() {
  if (currentRole === 'parent') {
    showToast('Exam Paper is locked for Students/Parents. Teacher access only.', 'error');
    return;
  }

  document.getElementById('role-teacher-view').classList.remove('hidden');
  const studio = document.getElementById('section-exam-studio');
  if (studio) studio.scrollIntoView({ behavior: 'smooth' });
  onExamConfigChange();
}

function onExamConfigChange() {
  const stdVal = document.getElementById('exam-std-select').value;
  const subVal = document.getElementById('exam-subject-select').value;
  
  if (currentExamMode === 'auto') {
    generateAutoExamPaper(false);
  } else {
    renderManualChecklistContainer();
  }
}

function openPaperTypeHeadingModal() {
  renderPaperHeadingsList();
  openModal('modal-paper-headings');
}

function renderPaperHeadingsList() {
  const container = document.getElementById('headings-list-container');
  if (!container) return;

  container.innerHTML = paperTypeHeadings.map((h, idx) => `
    <div class="flex justify-between items-center p-2 bg-slate-100 rounded-lg text-xs font-bold text-slate-800">
      <span>${h}</span>
      <button onclick="removePaperHeadingItem(${idx})" class="text-rose-600 hover:text-rose-800 text-xs">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
}

function addPaperHeadingItem() {
  const input = document.getElementById('new-heading-text');
  const val = input ? input.value.trim() : '';

  if (!val) {
    showToast('Please enter heading text', 'error');
    return;
  }

  paperTypeHeadings.push(val);
  savePaperHeadings();
  renderPaperHeadingsList();
  showToast(`Added heading '${val}'!`);
  if (input) input.value = '';
}

function removePaperHeadingItem(idx) {
  paperTypeHeadings.splice(idx, 1);
  savePaperHeadings();
  renderPaperHeadingsList();
}

function setExamMode(mode) {
  currentExamMode = mode;
  const btnAuto = document.getElementById('btn-mode-auto');
  const btnManual = document.getElementById('btn-mode-manual');
  const autoContainer = document.getElementById('container-auto-buttons');
  const manualToggleBtn = document.getElementById('btn-manual-questions-toggle');
  const manualPanel = document.getElementById('panel-manual-checklist');
  const statusLabel = document.getElementById('exam-action-status-label');

  if (mode === 'auto') {
    if (btnAuto) btnAuto.className = 'flex-1 py-1.5 rounded-md bg-rose-600 text-white shadow transition flex items-center justify-center gap-1 font-bold';
    if (btnManual) btnManual.className = 'flex-1 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1 font-bold';
    if (autoContainer) autoContainer.classList.remove('hidden');
    if (manualToggleBtn) manualToggleBtn.classList.add('hidden');
    if (manualPanel) manualPanel.classList.add('hidden');
    if (statusLabel) statusLabel.innerText = 'Auto Exam Paper Mode Active';
    generateAutoExamPaper(false);
  } else {
    if (btnAuto) btnAuto.className = 'flex-1 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1 font-bold';
    if (btnManual) btnManual.className = 'flex-1 py-1.5 rounded-md bg-indigo-600 text-white shadow transition flex items-center justify-center gap-1 font-bold';
    if (autoContainer) autoContainer.classList.add('hidden');
    if (manualToggleBtn) manualToggleBtn.classList.remove('hidden');
    if (manualToggleBtn) manualToggleBtn.classList.add('flex');
    if (manualPanel) manualPanel.classList.remove('hidden');
    if (statusLabel) statusLabel.innerText = 'Manual Exam Paper Mode Active (Check questions below)';
    renderManualChecklistContainer();
  }
}

function generateAutoExamPaper(isShuffle = false) {
  const stdVal = document.getElementById('exam-std-select').value;
  const subVal = document.getElementById('exam-subject-select').value;

  let matchingQuestions = [];
  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      if (ch.subject.toLowerCase() === subVal.toLowerCase() && ch.questions) {
        ch.questions.forEach(q => {
          if (!q.standard || q.standard === stdVal) {
            matchingQuestions.push({ ...q, chapterNo: ch.chapterNo, chapterName: ch.chapterName });
          }
        });
      }
    });
  }

  if (matchingQuestions.length === 0) {
    showToast(`No questions found for ${stdVal} ${subVal}. Upload homework/classwork first!`, 'error');
    return;
  }

  if (isShuffle) {
    matchingQuestions.sort(() => Math.random() - 0.5);
  }

  const grouped = {};
  paperTypeHeadings.forEach((heading, hIdx) => {
    const selected = matchingQuestions.slice(hIdx * 3, (hIdx + 1) * 3);
    if (selected.length > 0) grouped[heading] = selected;
    else grouped[heading] = matchingQuestions.slice(0, 3);
  });

  currentPaper = {
    title: `ANNUAL EXAM PAPER - ${stdVal.toUpperCase()}`,
    isClasswork: false,
    schoolName: currentUser ? currentUser.schoolName : 'School Name',
    date: new Date().toISOString().split('T')[0],
    standard: stdVal,
    subject: subVal,
    groupedHeadings: grouped
  };

  renderA4PaperDOM();
  if (isShuffle) showToast('Generated fresh Question Paper set with new sub-questions!');
}

function toggleManualChecklist() {
  const panel = document.getElementById('panel-manual-checklist');
  if (panel) panel.classList.toggle('hidden');
}

function renderManualChecklistContainer() {
  const container = document.getElementById('manual-headings-checklist-container');
  if (!container) return;

  const stdVal = document.getElementById('exam-std-select').value;
  const subVal = document.getElementById('exam-subject-select').value;

  let matchingQuestions = [];
  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      if (ch.subject.toLowerCase() === subVal.toLowerCase() && ch.questions) {
        ch.questions.forEach(q => {
          if (!q.standard || q.standard === stdVal) {
            matchingQuestions.push({ ...q, chapterNo: ch.chapterNo });
          }
        });
      }
    });
  }

  if (matchingQuestions.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic py-4">No questions available for ${stdVal} ${subVal}.</p>`;
    return;
  }

  container.innerHTML = paperTypeHeadings.map(heading => `
    <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
      <h5 class="font-bold text-xs text-indigo-900 border-b pb-1 flex items-center justify-between">
        <span>${heading}</span>
        <span class="text-[10px] text-slate-400 font-medium">Select questions to add</span>
      </h5>
      <div class="space-y-1.5">
        ${matchingQuestions.map(q => {
          const isChecked = manualSelectedQuestionIds.includes(q.id);
          return `
            <label class="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-indigo-50 cursor-pointer">
              <input type="checkbox" value="${q.id}" ${isChecked ? 'checked' : ''} onchange="toggleManualQuestionSelection('${q.id}', '${heading}')" class="w-4 h-4 text-indigo-600 rounded">
              <span class="text-slate-800 font-medium">${q.question || q.text}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function toggleManualQuestionSelection(qId, heading) {
  const idx = manualSelectedQuestionIds.indexOf(qId);
  if (idx >= 0) manualSelectedQuestionIds.splice(idx, 1);
  else manualSelectedQuestionIds.push(qId);

  const countEl = document.getElementById('manual-selected-count');
  if (countEl) countEl.innerText = `${manualSelectedQuestionIds.length} questions selected`;

  buildManualExamPaper();
}

function buildManualExamPaper() {
  const stdVal = document.getElementById('exam-std-select').value;
  const subVal = document.getElementById('exam-subject-select').value;

  const grouped = {};
  paperTypeHeadings.forEach(heading => {
    grouped[heading] = [];
  });

  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      if (ch.questions) {
        ch.questions.forEach(q => {
          if (manualSelectedQuestionIds.includes(q.id)) {
            const h = q.heading || paperTypeHeadings[0];
            if (!grouped[h]) grouped[h] = [];
            grouped[h].push(q);
          }
        });
      }
    });
  }

  currentPaper = {
    title: `MANUAL EXAM PAPER - ${stdVal.toUpperCase()}`,
    isClasswork: false,
    schoolName: currentUser ? currentUser.schoolName : 'School Name',
    date: new Date().toISOString().split('T')[0],
    standard: stdVal,
    subject: subVal,
    groupedHeadings: grouped
  };

  renderA4PaperDOM();
}

function openPracticePaperStudio() {
  const stdVal = currentUser ? (currentUser.standard || 'Std 5') : 'Std 5';
  const subVal = masterSubjects[0] || 'Maths';

  let practiceQuestions = [];
  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      if (ch.questions) {
        ch.questions.forEach(q => practiceQuestions.push(q));
      }
    });
  }

  if (practiceQuestions.length === 0) {
    showToast('No homework/classwork questions uploaded yet for practice.', 'error');
    return;
  }

  currentPaper = {
    title: `PRACTICE TEST PAPER - ${stdVal}`,
    isClasswork: false,
    schoolName: currentUser ? currentUser.schoolName : 'School Name',
    date: new Date().toISOString().split('T')[0],
    standard: stdVal,
    subject: subVal,
    groupedHeadings: groupQuestionsByHeading(practiceQuestions.slice(0, 10))
  };

  document.getElementById('role-teacher-view').classList.remove('hidden');
  renderA4PaperDOM();
  showToast('Generated Practice Paper from accumulated Homework & Classwork!');
}

function renderA4PaperDOM() {
  const paperSheet = document.getElementById('a4-paper-sheet');
  if (!paperSheet || !currentPaper) return;

  const school = currentPaper.schoolName || (currentUser ? currentUser.schoolName : 'School Name');
  const city = currentUser && currentUser.cityName ? currentUser.cityName : 'City';
  const dateStr = currentPaper.date || new Date().toISOString().split('T')[0];
  const std = currentPaper.standard || 'Std 5';
  const sub = currentPaper.subject || 'General';
  const chapNo = currentPaper.chapterNo || '1';
  const chapName = currentPaper.chapterName || '';

  const isClassworkView = currentPaper.isClasswork || (currentPaper.title && (currentPaper.title.includes('CLASSWORK') || currentPaper.title.includes('HOMEWORK')));

  let contentHtml = '';

  if (isClassworkView) {
    // CLASSWORK SPECIFIC LAYOUT (Exact User Formatting Rules)
    contentHtml = `
      <div class="border-b-2 border-slate-900 pb-2 mb-4 space-y-1">
        <div class="flex justify-between items-center text-sm font-extrabold text-slate-900">
          <span>Date: ${dateStr}</span>
          <span class="text-base uppercase tracking-wide">Ch.${chapNo} ${sub} ${chapName ? '- ' + chapName : ''}</span>
        </div>
        <div class="text-xs text-slate-500 font-semibold flex justify-between">
          <span>${school}${city ? ', ' + city : ''}</span>
          <span>${std} | Classwork Notes</span>
        </div>
      </div>
    `;

    if (currentPaper.groupedHeadings) {
      let sectionIdx = 1;
      for (const [heading, questions] of Object.entries(currentPaper.groupedHeadings)) {
        if (questions && questions.length > 0) {
          const cleanHeading = heading.replace(/^[\*\d\.\)\s]+/, '').replace(/[\.:]+$/, '').trim();
          contentHtml += `
            <div class="space-y-3 pt-2">
              <h4 class="font-extrabold text-sm text-slate-900">${sectionIdx}. ${cleanHeading}.</h4>
              <div class="space-y-3 pl-3">
                ${questions.map((q, qIdx) => {
                  let qText = q.question || q.text || '';
                  let ansText = q.answer || '';
                  
                  // Fill in the blanks format with underline
                  if (heading.toLowerCase().includes('blank') || q.type === 'fill_in_blanks') {
                    let formattedBlank = qText;
                    if (ansText && !formattedBlank.includes('__') && !formattedBlank.includes('<u>')) {
                      formattedBlank = `${formattedBlank} <u class="font-bold px-1 text-slate-900">${ansText}</u>`;
                    } else {
                      formattedBlank = formattedBlank.replace(/__([^_]+)__/g, '<u class="font-bold px-1 text-slate-900">$1</u>');
                    }
                    return `
                      <div class="text-xs text-slate-900 font-semibold">
                        <span class="font-bold mr-1">${qIdx + 1}.</span> ${formattedBlank}
                      </div>
                    `;
                  }
                  
                  // Define / Question & Answer format
                  const isDefineSection = heading.toLowerCase().includes('define') || q.type === 'define';
                  
                  if (!qText && isDefineSection && ansText) {
                    const matchTerm = ansText.match(/^([A-Za-z0-9\s]+?)(?=\s+(is|are|means|refers|can be|was|were)\b|[:\-])/i);
                    if (matchTerm && matchTerm[1] && matchTerm[1].trim().length < 40) {
                      qText = matchTerm[1].trim();
                    }
                  }

                  if (qText) {
                    return `
                      <div class="text-xs text-slate-900 space-y-1">
                        <div class="font-bold text-slate-900">
                          <span>Q.${qIdx + 1}.</span> ${qText}
                        </div>
                        ${ansText ? `
                          <div class="pl-4 font-semibold text-slate-900 flex items-start gap-1">
                            <span class="font-extrabold text-slate-950">Ans:</span>
                            <span>${ansText}</span>
                          </div>
                        ` : ''}
                      </div>
                    `;
                  } else {
                    return `
                      <div class="text-xs text-slate-900 space-y-1">
                        <div class="font-semibold text-slate-900 flex items-start gap-1">
                          <span class="font-bold text-slate-950">Q.${qIdx + 1}. Ans:</span>
                          <span>${ansText || ''}</span>
                        </div>
                      </div>
                    `;
                  }
                }).join('')}
              </div>
            </div>
          `;
          sectionIdx++;
        }
      }
    }
  } else {
    // STANDARD EXAM PAPER LAYOUT
    contentHtml = `
      <div class="text-center border-b-2 border-slate-900 pb-3 space-y-1">
        <h2 class="text-xl font-black uppercase tracking-wider text-slate-900">${school}</h2>
        <p class="text-xs font-bold text-slate-600">${city} | Academic Term 2026</p>
        <div class="flex justify-between items-center text-xs font-bold text-slate-800 pt-2 border-t border-slate-300">
          <span>Std: ${std}</span>
          <span class="font-extrabold uppercase tracking-wide">${currentPaper.title || 'QUESTION PAPER'}</span>
          <span>Subject: ${sub}</span>
        </div>
        <div class="flex justify-between items-center text-[11px] font-semibold text-slate-600">
          <span>Date: ${dateStr}</span>
          <span>Marks: 50 | Time: 2 Hours</span>
        </div>
      </div>
    `;

    if (currentPaper.groupedHeadings) {
      let sectionIdx = 1;
      for (const [heading, questions] of Object.entries(currentPaper.groupedHeadings)) {
        if (questions && questions.length > 0) {
          contentHtml += `
            <div class="space-y-2 pt-2">
              <h4 class="font-extrabold text-sm text-slate-900">${heading}</h4>
              <div class="space-y-2 pl-3">
                ${questions.map((q, qIdx) => {
                  let qText = q.question || q.text || '';
                  return `
                    <div class="text-xs text-slate-800">
                      <span class="font-bold mr-1">(${qIdx + 1})</span> ${qText}
                      ${q.options && Array.isArray(q.options) ? `
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 pl-4 pt-1 font-medium text-slate-700">
                          ${q.options.map(opt => `<span>(  ) ${opt}</span>`).join('')}
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
          sectionIdx++;
        }
      }
    }
  }

  paperSheet.innerHTML = contentHtml;
}

function exportToPDF() {
  const element = document.getElementById('a4-paper-sheet');
  const opt = {
    margin: 10,
    filename: `${currentPaper ? currentPaper.title : 'Question_Paper'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save();
  showToast('Downloading A4 PDF...');
}

function exportToDOCX() {
  if (!docx) {
    showToast('DOCX exporter loading...', 'error');
    return;
  }

  const { Document, Packer, Paragraph, TextRun } = docx;
  const docParagraphs = [];

  docParagraphs.push(
    new Paragraph({
      alignment: docx.AlignmentType.CENTER,
      children: [
        new TextRun({
          text: currentPaper ? currentPaper.title : 'QUESTION PAPER',
          bold: true,
          size: 32,
          font: 'Calibri'
        })
      ]
    })
  );

  if (currentPaper && currentPaper.groupedHeadings) {
    let secIdx = 1;
    for (const [heading, qList] of Object.entries(currentPaper.groupedHeadings)) {
      docParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `\n${heading}`,
              bold: true,
              size: 24,
              font: 'Calibri'
            })
          ]
        })
      );

      qList.forEach((q, idx) => {
        let textStr = q.question || q.text || '';
        docParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${idx + 1}. ${textStr}`,
                size: 22,
                font: 'Calibri'
              })
            ]
          })
        );
      });
      secIdx++;
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children: docParagraphs }]
  });

  Packer.toBlob(doc).then(blob => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${currentPaper ? currentPaper.title : 'Question_Paper'}.docx`;
    link.click();
    showToast('Downloading DOCX file...');
  });
}

function renderParentFeed() {
  const container = document.getElementById('parent-feed-container');
  if (!container) return;
  if (sharedFeed.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">No homework or classwork shared yet today.</p>`;
    return;
  }

  container.innerHTML = sharedFeed.map(item => `
    <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
      <div class="flex justify-between items-center">
        <h4 class="font-bold text-slate-900 text-sm">${item.title}</h4>
        <span class="text-[10px] text-slate-400 font-medium">${item.date}</span>
      </div>
      <p class="text-xs text-slate-600">Teacher shared this topic for student home practice.</p>
      <button onclick="loadSharedPaper('${item.id}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow">
        View & Practice Paper
      </button>
    </div>
  `).join('');
}

function loadSharedPaper(feedId) {
  const item = sharedFeed.find(f => f.id === feedId);
  if (item) {
    currentPaper = item.paper;
    document.getElementById('role-teacher-view').classList.remove('hidden');
    renderA4PaperDOM();
    showToast('Loaded paper into A4 preview');
  }
}

// WEB-ONLY HEAD ADMIN DIRECTORY (Standard-Wise Listing)
async function loadAdminDirectory() {
  const container = document.getElementById('admin-directory-container');
  if (!container) return;

  container.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin"></i> Loading Standard-Wise Directory...</div>`;

  try {
    const res = await fetch('/api/admin/directory', {
      headers: { 'x-admin-passcode': adminPasscode || 'admin123' }
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load directory');

    if (data.schools.length === 0) {
      container.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs">No registered schools found. Add a school above!</div>`;
      return;
    }

    container.innerHTML = data.schools.map(school => `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 shadow-sm">
        <div class="flex flex-wrap justify-between items-center gap-2 border-b border-slate-200 pb-3">
          <div>
            <div class="flex items-center gap-2">
              <h3 class="font-extrabold text-slate-900 text-base">${school.name}</h3>
              <span class="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-mono">CODE: ${school.code}</span>
            </div>
            <p class="text-xs text-slate-500 mt-0.5 flex items-center gap-3 font-semibold">
              <span><i class="fa-solid fa-chalkboard-user text-indigo-600"></i> ${school.teachersCount} Teacher(s)</span>
              <span><i class="fa-solid fa-users text-emerald-600"></i> ${school.parentsCount} Parent(s)</span>
            </p>
          </div>
          <span class="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            ● ${school.subscriptionStatus.toUpperCase()} SUBSCRIPTION
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-white p-3.5 rounded-xl border border-slate-200 space-y-3">
            <h4 class="font-extrabold text-xs text-indigo-900 flex items-center justify-between border-b pb-2">
              <span><i class="fa-solid fa-chalkboard-user text-indigo-600 mr-1"></i> Registered Teachers (Standard-Wise)</span>
              <span class="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-[10px]">${school.teachers.length} Total</span>
            </h4>
            ${school.teachers.length === 0 ? '<p class="text-[11px] text-slate-400 italic">No registered teachers yet.</p>' : `
              <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${school.teachers.map(t => `
                  <div class="flex justify-between items-center text-xs p-2 bg-slate-50 rounded-lg border border-slate-100">
                    <div>
                      <span class="font-bold text-slate-800">${t.name}</span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded ml-1.5">${t.standard || 'Std 5'}</span>
                    </div>
                    <span class="font-bold text-indigo-700 font-mono bg-white px-2 py-1 rounded border border-indigo-200 flex items-center gap-1">
                      <i class="fa-solid fa-phone text-[10px]"></i> +91 ${t.mobile}
                    </span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <div class="bg-white p-3.5 rounded-xl border border-slate-200 space-y-3">
            <h4 class="font-extrabold text-xs text-emerald-900 flex items-center justify-between border-b pb-2">
              <span><i class="fa-solid fa-users text-emerald-600 mr-1"></i> Registered Parents (Standard-Wise)</span>
              <span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px]">${school.parents.length} Total</span>
            </h4>
            ${school.parents.length === 0 ? '<p class="text-[11px] text-slate-400 italic">No registered parents yet.</p>' : `
              <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${school.parents.map(p => `
                  <div class="flex justify-between items-center text-xs p-2 bg-slate-50 rounded-lg border border-slate-100">
                    <div>
                      <span class="font-bold text-slate-800">${p.name}</span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded ml-1.5">${p.standard || 'Std 5'}</span>
                    </div>
                    <span class="font-bold text-emerald-700 font-mono bg-white px-2 py-1 rounded border border-emerald-200 flex items-center gap-1">
                      <i class="fa-solid fa-phone text-[10px]"></i> +91 ${p.mobile}
                    </span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    container.innerHTML = `<div class="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium">${err.message}</div>`;
  }
}

async function adminAddNewSchool(e) {
  e.preventDefault();
  const rawName = document.getElementById('admin-school-name').value.trim();
  const rawCode = document.getElementById('admin-school-code').value.trim();

  if (!rawName) {
    showToast('Please enter School Name', 'error');
    return;
  }

  const formattedName = rawCode && !rawName.includes(',') ? `${rawName}, ${rawCode}` : rawName;
  const newSchoolId = 'sch_' + Date.now();

  try {
    const res = await fetch('/api/admin/school', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode || 'admin123'
      },
      body: JSON.stringify({ name: formattedName, code: rawCode || 'SCH' })
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'Failed to add school');
      }
    }
  } catch (err) {}

  const savedLocal = JSON.parse(localStorage.getItem('paper_ai_local_schools') || '[]');
  if (!savedLocal.some(s => s.name.toLowerCase() === formattedName.toLowerCase())) {
    savedLocal.push({ id: newSchoolId, name: formattedName, code: rawCode || 'SCH' });
    localStorage.setItem('paper_ai_local_schools', JSON.stringify(savedLocal));
  }

  showToast(`School '${formattedName}' registered successfully!`);
  document.getElementById('admin-school-name').value = '';
  document.getElementById('admin-school-code').value = '';
  await loadAdminDirectory();
  await loadPublicSchools();
}
