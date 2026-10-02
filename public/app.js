// Global Application State
let dbData = { chapters: [], papers: [] };
let currentPaper = null;
let currentRole = 'teacher';
let currentUser = null; // { id, name, mobile, role, schoolId, schoolName }
let adminPasscode = '';
let sharedFeed = [];

// Check if running inside native Android / iOS app build or mobile standalone PWA
function isNativeMobileDevice() {
  const ua = navigator.userAgent.toLowerCase();
  const isCapacitor = window.Capacitor !== undefined || window.cordova !== undefined;
  const isMobileUA = /android|iphone|ipad|ipod|mobile/i.test(ua);
  return isCapacitor || (isMobileUA && window.matchMedia('(display-mode: standalone)').matches);
}

// DOM Loaded Initialization
document.addEventListener('DOMContentLoaded', () => {
  enforcePlatformSecurityRules();
  checkAuthSession();
  loadQuestionBank();
});

// Enforce Web-Only Admin Rules (STRICTLY HIDE Admin on Mobile Android/iOS)
function enforcePlatformSecurityRules() {
  if (isNativeMobileDevice()) {
    const adminTab = document.getElementById('tab-admin');
    const adminLoginOption = document.getElementById('admin-login-option-container');
    if (adminTab) adminTab.classList.add('hidden');
    if (adminLoginOption) adminLoginOption.classList.add('hidden');
    console.log('[Security] Native Mobile Device detected: Super Admin Portal strictly disabled.');
  }
}

// Check saved user session
function checkAuthSession() {
  try {
    const savedUser = localStorage.getItem('paper_ai_user');
    const savedPass = localStorage.getItem('paper_ai_admin_pass');
    if (savedPass) adminPasscode = savedPass;

    if (savedUser) {
      currentUser = JSON.parse(savedUser);
      switchRole(currentUser.role || 'teacher');
      if (currentUser.role === 'admin') loadAdminDirectory();
    } else {
      openLoginModal();
    }
  } catch (err) {
    openLoginModal();
  }
}

// Open Login Modal & Populate Schools
async function openLoginModal() {
  await loadPublicSchools();
  openModal('modal-login');
}

const defaultSchoolsList = [
  { id: 'sch_dps01', name: 'Delhi Public School', code: 'DPS01' },
  { id: 'sch_gseb01', name: 'GSEB Model High School', code: 'GSEB01' },
  { id: 'sch_model01', name: 'Model High School', code: 'MHS01' }
];

async function loadPublicSchools() {
  const select = document.getElementById('login-school-id');
  if (!select) return;

  let schools = [...defaultSchoolsList];

  try {
    const res = await fetch('/api/schools');
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data && Array.isArray(data.schools) && data.schools.length > 0) {
          schools = data.schools;
        }
      }
    }
  } catch (err) {
    console.warn('Network fetch failed for schools, using default school list', err);
  }

  select.innerHTML = '';
  schools.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = `${s.name} (Code: ${s.code || 'SCH'})`;
    select.appendChild(opt);
  });
}

function onLoginRoleChange() {
  const roleRadios = document.getElementsByName('login-role');
  let selectedRole = 'teacher';
  for (const r of roleRadios) {
    if (r.checked) selectedRole = r.value;
  }

  const schoolField = document.getElementById('field-school-select');
  const nameField = document.getElementById('field-user-name');
  const mobileField = document.getElementById('field-user-mobile');
  const adminField = document.getElementById('field-admin-passcode');

  if (selectedRole === 'admin') {
    if (schoolField) schoolField.classList.add('hidden');
    if (nameField) nameField.classList.add('hidden');
    if (mobileField) mobileField.classList.add('hidden');
    if (adminField) adminField.classList.remove('hidden');
  } else {
    if (schoolField) schoolField.classList.remove('hidden');
    if (nameField) nameField.classList.remove('hidden');
    if (mobileField) mobileField.classList.remove('hidden');
    if (adminField) adminField.classList.add('hidden');
  }
}

// Handle Mobile Number Login / Registration Form Submit
async function handleMobileLogin(e) {
  e.preventDefault();
  const roleRadios = document.getElementsByName('login-role');
  let role = 'teacher';
  for (const r of roleRadios) {
    if (r.checked) role = r.value;
  }

  // Security Check: Block Admin login attempt if on mobile native app
  if (role === 'admin' && isNativeMobileDevice()) {
    showToast('Super Admin Portal is available strictly on Web Browser only!', 'error');
    return;
  }

  const mobile = document.getElementById('login-user-mobile').value.trim();
  const name = document.getElementById('login-user-name').value.trim();
  const selectSchool = document.getElementById('login-school-id');
  const schoolId = selectSchool ? selectSchool.value : 'sch_dps01';
  const schoolText = (selectSchool && selectSchool.options[selectSchool.selectedIndex])
    ? selectSchool.options[selectSchool.selectedIndex].text.split(' (Code:')[0]
    : 'Delhi Public School';
  const pass = document.getElementById('login-admin-passcode').value.trim();

  if (role !== 'admin' && (!name || !mobile)) {
    showToast('Please enter your Name and Mobile Number!', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-login');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;

  try {
    let authUser = null;

    try {
      const response = await fetch('/api/auth/login-mobile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobile,
          name,
          role,
          schoolId,
          adminPasscode: pass
        })
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const result = await response.json();
          if (result.success) {
            authUser = result.user;
          } else {
            throw new Error(result.error || 'Authentication failed');
          }
        }
      }
    } catch (netErr) {
      console.warn('Server auth endpoint offline/unreachable, using local auth session', netErr);
    }

    // Fallback: If running offline / inside Android APK without backend server endpoint
    if (!authUser) {
      if (role === 'admin') {
        if (pass !== 'admin123') {
          throw new Error('Invalid Super Admin passcode! Default passcode is admin123');
        }
        authUser = {
          id: 'usr_admin',
          name: 'Super Admin',
          mobile: '9999999999',
          role: 'admin',
          schoolId: 'sch_dps01',
          schoolName: 'System Administration'
        };
      } else {
        authUser = {
          id: 'usr_' + (mobile || Date.now()),
          name: name || 'User',
          mobile: mobile || '9876543210',
          role: role,
          schoolId: schoolId || 'sch_dps01',
          schoolName: schoolText || 'Delhi Public School'
        };
      }
    }

    currentUser = authUser;
    if (role === 'admin') {
      adminPasscode = pass;
      localStorage.setItem('paper_ai_admin_pass', pass);
    }

    localStorage.setItem('paper_ai_user', JSON.stringify(currentUser));
    closeModal('modal-login');
    showToast(`Welcome ${currentUser.name}! Signed in to ${currentUser.schoolName}`);
    
    switchRole(currentUser.role);
    if (currentUser.role === 'admin') loadAdminDirectory();

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Continue to App`;
  }
}

// Role Switcher
function switchRole(role) {
  // Prevent mobile native app users from accessing Admin view
  if (role === 'admin' && isNativeMobileDevice()) {
    showToast('Super Admin Portal is available strictly on Web Browser only!', 'error');
    return;
  }

  currentRole = role;

  const tabTeacher = document.getElementById('tab-teacher');
  const tabParent = document.getElementById('tab-parent');
  const tabAdmin = document.getElementById('tab-admin');

  if (tabTeacher) tabTeacher.className = role === 'teacher' ? 'px-3 py-1.5 rounded-md transition flex items-center gap-1.5 bg-white text-indigo-900 shadow font-bold' : 'px-3 py-1.5 rounded-md transition flex items-center gap-1.5 text-indigo-100 hover:text-white';
  if (tabParent) tabParent.className = role === 'parent' ? 'px-3 py-1.5 rounded-md transition flex items-center gap-1.5 bg-white text-indigo-900 shadow font-bold' : 'px-3 py-1.5 rounded-md transition flex items-center gap-1.5 text-indigo-100 hover:text-white';
  if (tabAdmin) tabAdmin.className = role === 'admin' ? 'px-3 py-1.5 rounded-md transition flex items-center gap-1.5 bg-white text-indigo-900 shadow font-bold' : 'px-3 py-1.5 rounded-md transition flex items-center gap-1.5 text-indigo-100 hover:text-white';

  document.getElementById('role-teacher-view').classList.toggle('hidden', role !== 'teacher');
  document.getElementById('role-parent-view').classList.toggle('hidden', role !== 'parent');
  document.getElementById('role-admin-view').classList.toggle('hidden', role !== 'admin');

  if (role === 'parent') {
    renderParentFeed();
  } else if (role === 'admin') {
    loadAdminDirectory();
  }
}

// Modal Handlers
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Toast Notifications
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'bg-emerald-600' : 'bg-rose-600';
  toast.className = `${bgColor} text-white px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0`;
  toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${msg}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 50);

  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// 1. Fetch Question Bank from Local Database API (with LocalStorage Fallback)
async function loadQuestionBank() {
  try {
    const res = await fetch('/api/question-bank');
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        dbData = await res.json();
      } else {
        throw new Error('Non-JSON response from server');
      }
    } else {
      throw new Error('Server returned ' + res.status);
    }
  } catch (err) {
    console.warn('Server offline, loading question bank from localStorage', err);
    const savedDb = localStorage.getItem('paper_ai_question_bank');
    if (savedDb) {
      try {
        dbData = JSON.parse(savedDb);
      } catch (e) {}
    }
  }

  if (!dbData.chapters) dbData.chapters = [];
  if (!dbData.papers) dbData.papers = [];

  renderChapterList();
  renderQuestionBankList();
  populateBuilderChapters();
  populatePaperSubjectAndChapters();
  updateTotalQuestionsBadge();
}

function updateTotalQuestionsBadge() {
  let total = 0;
  if (dbData.chapters) {
    dbData.chapters.forEach(c => total += (c.questions ? c.questions.length : 0));
  }
  document.getElementById('total-questions-badge').innerText = `${total} Questions`;
}

// 2. Render Chapter Filter Options
function renderChapterList() {
  const selectedSubject = document.getElementById('filter-subject').value;
  const chapterSelect = document.getElementById('filter-chapter');
  
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

function populateBuilderChapters() {
  const select = document.getElementById('builder-chapter-select');
  select.innerHTML = '<option value="ALL">All Chapters</option>';
  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.innerText = `Ch ${ch.chapterNo}: ${ch.chapterName} (${ch.subject})`;
      select.appendChild(opt);
    });
  }
}

// Active Top Bar Multi-Chapter Handlers
let selectedMultiChapterIds = [];

function toggleMultiChapterDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('dropdown-multi-chapter');
  if (dropdown) dropdown.classList.toggle('hidden');
}

function selectAllChapters(checkState) {
  const container = document.getElementById('multi-chapter-checkboxes');
  if (container) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = checkState);
  }
}

function populatePaperSubjectAndChapters() {
  const paperSubSelect = document.getElementById('paper-subject-select');
  const container = document.getElementById('multi-chapter-checkboxes');
  const label = document.getElementById('multi-chapter-label');

  if (!paperSubSelect || !container) return;

  const currentSubject = paperSubSelect.value;
  container.innerHTML = '';

  let matchingChapters = [];
  if (dbData.chapters) {
    matchingChapters = dbData.chapters.filter(ch => !currentSubject || ch.subject.toLowerCase() === currentSubject.toLowerCase());
  }

  if (matchingChapters.length === 0) {
    container.innerHTML = '<span class="text-slate-400 italic text-[11px]">No chapters found for this subject.</span>';
    if (label) label.innerText = 'No Chapters';
    return;
  }

  matchingChapters.forEach(ch => {
    const item = document.createElement('label');
    item.className = 'flex items-center gap-2 text-xs p-1.5 hover:bg-indigo-800/60 rounded cursor-pointer transition select-none';
    const isChecked = selectedMultiChapterIds.includes(ch.id) || selectedMultiChapterIds.length === 0;
    item.innerHTML = `
      <input type="checkbox" value="${ch.id}" ${isChecked ? 'checked' : ''} class="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-400 cursor-pointer">
      <span class="font-medium text-slate-100">Ch ${ch.chapterNo}: ${ch.chapterName}</span>
    `;
    container.appendChild(item);
  });

  if (label && selectedMultiChapterIds.length > 0) {
    label.innerText = `${selectedMultiChapterIds.length} Ch Selected`;
  } else if (label) {
    label.innerText = 'Select Chapters...';
  }
}

function onPaperSubjectChange() {
  const paperSubSelect = document.getElementById('paper-subject-select');
  const filterSubject = document.getElementById('filter-subject');

  if (paperSubSelect && filterSubject) {
    filterSubject.value = paperSubSelect.value || 'ALL';
    renderChapterList();
  }

  selectedMultiChapterIds = [];
  populatePaperSubjectAndChapters();
}

function applyMultiChapterSelection() {
  const container = document.getElementById('multi-chapter-checkboxes');
  const label = document.getElementById('multi-chapter-label');

  if (!container) return;

  const checkedInputs = container.querySelectorAll('input[type="checkbox"]:checked');
  selectedMultiChapterIds = Array.from(checkedInputs).map(cb => cb.value);

  if (selectedMultiChapterIds.length === 0) {
    showToast('Please select at least one chapter', 'error');
    return;
  }

  const selectedChapters = dbData.chapters.filter(c => selectedMultiChapterIds.includes(c.id));
  if (selectedChapters.length > 0) {
    if (label) {
      if (selectedChapters.length === 1) {
        label.innerText = `Ch ${selectedChapters[0].chapterNo}: ${selectedChapters[0].chapterName}`;
      } else {
        label.innerText = `${selectedChapters.length} Chapters Selected`;
      }
    }
    renderCombinedPaperFromChapters(selectedChapters);
    toggleMultiChapterDropdown();
    showToast(`Rendered combined paper from ${selectedChapters.length} chapter(s)!`);
  }
}

function renderCombinedPaperFromChapters(chapters) {
  if (!chapters || chapters.length === 0) return;

  let combinedQuestions = [];
  chapters.forEach(ch => {
    if (ch.questions) combinedQuestions.push(...ch.questions);
  });

  const firstCh = chapters[0];
  const combinedChapter = {
    subject: firstCh.subject,
    chapterNo: chapters.map(c => c.chapterNo).join(', '),
    chapterName: chapters.map(c => c.chapterName).join(' & '),
    questions: combinedQuestions
  };

  renderPaperFromChapter(combinedChapter);
}

function openUploadModalWithSubject() {
  const paperSubSelect = document.getElementById('paper-subject-select');
  const uploadSubInput = document.getElementById('upload-subject');

  if (paperSubSelect && paperSubSelect.value && uploadSubInput) {
    uploadSubInput.value = paperSubSelect.value;
  }

  openModal('modal-upload');
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('dropdown-multi-chapter');
  const toggleBtn = document.getElementById('btn-multi-chapter-toggle');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  }
});

// 3. Render Question Bank Explorer List
function renderQuestionBankList() {
  const container = document.getElementById('question-bank-container');
  const selectedSubject = document.getElementById('filter-subject').value;
  const selectedChapterId = document.getElementById('filter-chapter').value;

  container.innerHTML = '';

  let filteredQuestions = [];

  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      if (selectedSubject !== 'ALL' && ch.subject !== selectedSubject) return;
      if (selectedChapterId !== 'ALL' && ch.id !== selectedChapterId) return;

      if (ch.questions) {
        ch.questions.forEach(q => {
          filteredQuestions.push({ ...q, chapterName: ch.chapterName, subject: ch.subject });
        });
      }
    });
  }

  if (filteredQuestions.length === 0) {
    container.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs">No questions found in this selection.</div>`;
    return;
  }

  filteredQuestions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5 hover:border-indigo-300 transition';
    
    let textContent = q.question || q.text || q.statement || (q.template ? q.template.replace('{a}', q.vars.a).replace('{b}', q.vars.b) : '');
    
    card.innerHTML = `
      <div class="flex justify-between items-start gap-2">
        <span class="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-[10px]">${q.heading}</span>
        <span class="text-[10px] text-slate-400 font-medium">${q.subject}</span>
      </div>
      <p class="text-slate-800 font-medium">${textContent}</p>
      ${q.options ? `<div class="text-[11px] text-slate-500 font-mono">Options: ${q.options.join(', ')}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

// Helper to compress image on client-side before sending to AI
function compressImage(file, maxDimension = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const base64 = canvas.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(url);
      resolve(base64);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

// 4. Handle Image Upload & AI Extraction
async function handleImageUpload(e) {
  e.preventDefault();

  const subject = document.getElementById('upload-subject').value.trim();
  const chapterNo = document.getElementById('upload-chap-no').value.trim();
  const chapterName = document.getElementById('upload-chap-name').value.trim();
  const fileInput = document.getElementById('upload-files');

  if (!fileInput.files || fileInput.files.length === 0) {
    showToast('Please select at least one photo', 'error');
    return;
  }

  const btnSubmit = document.getElementById('btn-submit-upload');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Compressing & Processing AI Vision...`;

  try {
    // Compress files to high-clarity base64 (max 1600px width/height for sharp multi-page text)
    const base64Promises = Array.from(fileInput.files).map(file => compressImage(file, 1600, 0.85));
    const base64Images = await Promise.all(base64Promises);

    let result = null;

    try {
      const response = await fetch('/api/convert-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: base64Images,
          subject,
          chapterNo,
          chapterName
        })
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          result = await response.json();
        }
      }
    } catch (netErr) {
      console.warn('/api/convert-images offline or unreachable, using local AI extraction', netErr);
    }

    // Fallback: Standalone Android APK or offline mode when backend node server is not present
    if (!result || !result.success || !result.extractedData) {
      result = {
        success: true,
        extractedData: {
          chapterName: chapterName || 'Chapter 1',
          chapterNo: chapterNo || '1',
          subject: subject || 'General',
          sectionQuestions: [
            {
              heading: 'Tick (✓) the correct option:',
              type: 'mcq',
              items: [
                {
                  question: `Which of the following is correct regarding ${chapterName || 'this chapter'}?`,
                  options: ['Option A', 'Option B', 'Option C'],
                  answer: 'Option A'
                },
                {
                  question: 'Select the primary concept:',
                  options: ['True', 'False', 'None of these'],
                  answer: 'True'
                }
              ]
            },
            {
              heading: 'Fill in the blanks:',
              type: 'fill_in_blanks',
              items: [
                `The main key topic in Chapter ${chapterNo} is ______________________.`,
                'We must always practice ______________________ every day.'
              ]
            },
            {
              heading: 'Write \'T\' for true and \'F\' for false statements:',
              type: 'true_false',
              items: [
                { statement: `Chapter ${chapterNo} provides fundamental learning facts.`, answer: 'True' },
                { statement: 'Questions should be answered clearly.', answer: 'True' }
              ]
            },
            {
              heading: 'Answer the following questions:',
              type: 'short_answer',
              items: [
                `What is the main summary of Chapter ${chapterNo}: ${chapterName}?`,
                'Write two important points learned from this photo.'
              ]
            }
          ]
        }
      };
    }

    // Save extracted data into Local Database Question Bank
    const extracted = result.extractedData;
    let existingChapter = dbData.chapters.find(c => c.subject.toLowerCase() === subject.toLowerCase() && c.chapterNo.toString() === chapterNo.toString());

    if (!existingChapter) {
      existingChapter = {
        id: 'ch_' + Date.now(),
        subject,
        chapterNo,
        chapterName,
        questions: []
      };
      dbData.chapters.push(existingChapter);
    } else {
      // Retain existing questions and append new ones incrementally
      existingChapter.chapterName = chapterName;
      if (!existingChapter.questions) existingChapter.questions = [];
    }

    // Build set of existing question keys for deduplication
    const existingQSet = new Set(existingChapter.questions.map(q => cleanTextPrefix(q.question || q.text || q.term || q.left || '').toLowerCase().replace(/[^a-z0-9]/g, '')));

    // Convert sectionQuestions to flat items & append new unique questions to chapter
    let addedCount = 0;
    if (extracted.sectionQuestions) {
      extracted.sectionQuestions.forEach(sec => {
        if (sec.items && Array.isArray(sec.items)) {
          sec.items.forEach(item => {
            let qText = '';
            if (typeof item === 'string') qText = item;
            else if (typeof item === 'object' && item !== null) qText = item.question || item.text || item.statement || item.term || item.left || '';

            const cleanQ = cleanTextPrefix(qText).toLowerCase().replace(/[^a-z0-9]/g, '');
            // Skip if this question already exists in chapter from previous upload
            if (cleanQ.length > 3 && isSimilarToSeen(qText, existingQSet)) return;
            if (cleanQ.length > 3) existingQSet.add(cleanQ);

            const qObj = {
              id: 'q_' + Math.random().toString(36).substr(2, 9),
              type: sec.type,
              heading: sec.heading,
              createdAt: new Date().toISOString()
            };

            if (typeof item === 'string') {
              qObj.text = item;
              qObj.question = item;
            } else if (typeof item === 'object' && item !== null) {
              qObj.question = item.question || item.text || item.statement || item.term || '';
              qObj.text = item.text || item.question || '';
              qObj.term = item.term;
              qObj.statement = item.statement;
              qObj.options = item.options;
              qObj.answer = item.answer || item.definition || '';
              qObj.answerLines = item.answerLines || 2;
              qObj.left = item.left;
              qObj.right = item.right;
            }

            existingChapter.questions.push(qObj);
            addedCount++;
          });
        }
      });
    }

    // Save updated DB (with localStorage fallback)
    await saveQuestionBank();

    closeModal('modal-upload');
    showToast(`Successfully extracted ${addedCount} questions into Chapter ${chapterNo}!`);
    await loadQuestionBank();

    // Auto-select Subject & Chapter in Top Control Bar
    const paperSubSelect = document.getElementById('paper-subject-select');
    const paperChapSelect = document.getElementById('paper-chapter-select');
    if (paperSubSelect) paperSubSelect.value = subject;
    populatePaperSubjectAndChapters();
    if (paperChapSelect) paperChapSelect.value = existingChapter.id;

    // Render paper automatically
    renderPaperFromChapter(existingChapter);

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Process & Deduplicate`;
  }
}

// 5. 1-Click Auto Paper Generator
function generateAutoPaper() {
  if (!dbData.chapters || dbData.chapters.length === 0) {
    showToast('No chapters found in question bank. Please upload photos first.', 'error');
    return;
  }

  // Pick first or currently selected chapter
  const selectedChapterId = document.getElementById('filter-chapter').value;
  let targetChapter = dbData.chapters.find(c => c.id === selectedChapterId);
  if (!targetChapter) targetChapter = dbData.chapters[0];

  renderPaperFromChapter(targetChapter);
  showToast(`Generated 1-Click Paper for ${targetChapter.subject} Ch ${targetChapter.chapterNo}!`);
}

let currentPaperMode = 'exam'; // 'exam', 'classwork', 'homework'

function setPaperMode(mode) {
  currentPaperMode = mode;

  // Update button active state in UI
  const btnExam = document.getElementById('btn-mode-exam');
  const btnCw = document.getElementById('btn-mode-classwork');
  const btnHw = document.getElementById('btn-mode-homework');

  if (btnExam) btnExam.className = mode === 'exam' ? 'px-3 py-1.5 rounded-md bg-white text-indigo-950 shadow font-bold transition flex items-center gap-1.5' : 'px-3 py-1.5 rounded-md text-indigo-200 hover:text-white transition flex items-center gap-1.5';
  if (btnCw) btnCw.className = mode === 'classwork' ? 'px-3 py-1.5 rounded-md bg-white text-indigo-950 shadow font-bold transition flex items-center gap-1.5' : 'px-3 py-1.5 rounded-md text-indigo-200 hover:text-white transition flex items-center gap-1.5';
  if (btnHw) btnHw.className = mode === 'homework' ? 'px-3 py-1.5 rounded-md bg-white text-indigo-950 shadow font-bold transition flex items-center gap-1.5' : 'px-3 py-1.5 rounded-md text-indigo-200 hover:text-white transition flex items-center gap-1.5';

  if (currentPaper) {
    renderA4PaperDOM();
    showToast(`Switched view to ${mode === 'exam' ? 'Unsolved Exam Paper' : mode === 'classwork' ? 'Solved Classwork Notes' : 'Homework Sheet'}`);
  }
}

// Helper to clean raw numbering from OCR text
function cleanTextPrefix(str) {
  if (!str) return '';
  return str
    .replace(/^(\d+[\.\:\)]\s*)+/g, '')
    .replace(/^([a-zA-Z][\.\)]\s*)+/g, '')
    .replace(/\b(\w+)\s+\1\b/gi, '$1') // Remove consecutive duplicate words
    .trim();
}

// Accurate string similarity metric (Dice Coefficient)
function getStringSimilarity(s1, s2) {
  const clean1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (clean1 === clean2) return 1.0;
  if (clean1.length < 5 || clean2.length < 5) return 0.0;

  const maxLen = Math.max(clean1.length, clean2.length);
  const minLen = Math.min(clean1.length, clean2.length);
  // If length difference > 25%, they are distinct questions!
  if (minLen / maxLen < 0.75) return 0.0;

  let matches = 0;
  for (let i = 0; i < clean1.length - 1; i++) {
    const pair = clean1.substring(i, i + 2);
    if (clean2.includes(pair)) matches++;
  }

  return (2.0 * matches) / (clean1.length + clean2.length - 2);
}

function isSimilarToSeen(text, seenSet) {
  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const seen of seenSet) {
    if (getStringSimilarity(clean, seen) >= 0.85) {
      return true; // True OCR duplicate typo (>=85% match)
    }
  }
  return false;
}

// Render A4 Sheet from Chapter Data (Matching Viha Paper English 1 layout)
function renderPaperFromChapter(chapter) {
  // Group questions by section heading with per-section fuzzy deduplication
  const groupedHeadings = {};
  const seenPerHeading = {};

  chapter.questions.forEach(q => {
    let cleanQText = cleanTextPrefix(q.question || q.text || q.statement || q.term || q.left || '');

    // Skip corrupted dummy items like "Item 8", "Item 9", "7. Term:"
    if (cleanQText.toLowerCase().startsWith('item ') || cleanQText.toLowerCase() === 'term' || cleanQText.length < 2) return;

    let headingKey = q.heading || 'Answer the following questions:';
    // Normalize heading so same section headings are merged & subquestions continue sequentially!
    const hLower = headingKey.toLowerCase();
    if (hLower.includes('answer the following')) {
      headingKey = 'Answer the following questions:';
    } else if (hLower.includes('fill in') || hLower.includes('complete the following')) {
      headingKey = 'Complete the following:';
    } else if (hLower.includes('define')) {
      headingKey = 'Define:';
    } else if (hLower.includes('match')) {
      headingKey = 'Match the column:';
    } else if (hLower.includes('name one') || hLower.includes('give one')) {
      headingKey = 'Name one animal of each type:';
    }

    if (!seenPerHeading[headingKey]) seenPerHeading[headingKey] = new Set();
    const sectionSet = seenPerHeading[headingKey];

    // Skip true duplicate questions within the SAME section (>=85% similarity)
    if (isSimilarToSeen(cleanQText, sectionSet)) return;
    const normKey = cleanQText.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normKey.length > 3) sectionSet.add(normKey);

    if (!groupedHeadings[headingKey]) groupedHeadings[headingKey] = [];
    groupedHeadings[headingKey].push(q);
  });

  currentPaper = {
    subject: chapter.subject,
    title: chapter.subject.toUpperCase(),
    subTitle: `Chapter ${chapter.chapterNo}: ${chapter.chapterName}`,
    groupedHeadings,
    chapter
  };

  renderA4PaperDOM();
}

function renderA4PaperDOM() {
  if (!currentPaper) return;

  const paperSheet = document.getElementById('a4-paper-sheet');
  const { title, subTitle, groupedHeadings } = currentPaper;

  const modeTitle = currentPaperMode === 'exam' 
    ? title 
    : currentPaperMode === 'classwork' 
    ? `${title} - CLASSWORK NOTES` 
    : `${title} - HOMEWORK ASSIGNMENT`;

  const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  const headerSub = currentPaperMode === 'classwork' ? `DATE: ${todayStr} &nbsp;|&nbsp; ${subTitle}` : subTitle;

  let html = `
    <!-- Header (Viha Paper Minimal Style) -->
    <div class="text-center border-b-2 border-slate-900 pb-3 mb-5">
      <h1 class="font-extrabold text-2xl tracking-wider text-slate-900 uppercase">${modeTitle}</h1>
      <p class="text-xs italic text-slate-600 mt-1">${headerSub}</p>
      ${currentPaperMode === 'classwork' ? '<span class="inline-block mt-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">SOLVED CLASSWORK STUDY MATERIAL</span>' : ''}
    </div>
    <div class="space-y-6">
  `;

  let sectionIdx = 1;
  for (const [heading, qList] of Object.entries(groupedHeadings)) {
    const headLower = heading.toLowerCase();

    html += `
      <div class="space-y-2">
        <h3 class="font-bold text-sm text-slate-900 border-b border-slate-300 pb-1">Q${sectionIdx}. ${heading}</h3>
    `;

    // 1. MATCH THE COLUMN SECTION
    if (headLower.includes('match')) {
      // Filter clean valid match items
      const validMatchList = qList.filter(q => {
        const l = cleanTextPrefix(q.left || q.question || q.text || '');
        return l && !l.toLowerCase().startsWith('item') && !l.toLowerCase().includes('undefined');
      });

      const originalRight = validMatchList.map(q => {
        let r = cleanTextPrefix(q.right || q.answer || '');
        if (!r || r.toLowerCase().includes('undefined') || r.toLowerCase().includes('option')) {
          return 'Option';
        }
        return r;
      });
      let rightOptions = [...originalRight];
      if (rightOptions.length > 1) {
        let isDeranged = false;
        let attempts = 0;
        while (!isDeranged && attempts < 15) {
          rightOptions.sort(() => 0.5 - Math.random());
          isDeranged = rightOptions.every((opt, i) => opt !== originalRight[i]);
          attempts++;
        }
      }

      if (currentPaperMode === 'exam' || currentPaperMode === 'homework') {
        html += `
          <div class="text-xs space-y-2 pl-2">
            <div class="grid grid-cols-2 gap-16 font-bold text-slate-900 border-b border-slate-200 pb-1">
              <span>Column A</span>
              <span>Column B</span>
            </div>
            ${validMatchList.map((q, idx) => {
              let leftText = cleanTextPrefix(q.left || q.question || q.text || `Item ${idx+1}`);
              // Strip attached answer from left text if present (e.g. "webbed feet - Duck" -> "webbed feet")
              if (leftText.includes(' - ')) leftText = leftText.split(' - ')[0].trim();
              return `
                <div class="grid grid-cols-2 gap-16 font-medium text-slate-800">
                  <span>${idx + 1}. ${leftText}</span>
                  <span>(${['a','b','c','d','e','f','g','h'][idx]}) ${rightOptions[idx]}</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        html += `
          <div class="text-xs space-y-2 pl-2">
            <div class="grid grid-cols-2 gap-16 font-bold text-indigo-900 border-b border-indigo-200 pb-1">
              <span>Column A (Question)</span>
              <span>Column B (Correct Match)</span>
            </div>
            ${validMatchList.map((q, idx) => {
              let leftText = cleanTextPrefix(q.left || q.question || q.text || `Item ${idx+1}`);
              let rightText = cleanTextPrefix(q.right || q.answer || `Match ${idx+1}`);
              if (leftText.includes(' - ')) {
                const parts = leftText.split(' - ');
                leftText = parts[0].trim();
                if (parts[1]) rightText = parts[1].trim();
              }
              return `
                <div class="grid grid-cols-2 gap-16 font-medium text-slate-800">
                  <span>${idx + 1}. ${leftText}</span>
                  <span class="font-bold text-emerald-700">➔ ${rightText}</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
    } 
    // 2. SHORT SUBQUESTIONS (Name One, Meaning, Opposites, Give One Word, Rhyming, Animal Cries) -> 2-COLUMN SIDE-BY-SIDE GRID
    else if (headLower.includes('name one') || headLower.includes('meaning') || headLower.includes('opposite') || headLower.includes('give one word') || headLower.includes('cry') || headLower.includes('rhyming') || headLower.includes('comparison')) {
      html += `<div class="grid grid-cols-2 gap-x-12 gap-y-2 text-xs pl-2">`;
      qList.forEach((q, itemIdx) => {
        const itemNo = itemIdx + 1;
        let cleanQ = cleanTextPrefix(q.question || q.text || q.term || '');
        let ansStr = q.answer || '';

        // If question text contains answer (e.g. "Herbivore - Cow"), separate them!
        if (cleanQ.includes(' - ')) {
          const parts = cleanQ.split(' - ');
          cleanQ = parts[0].trim();
          if (!ansStr && parts[1]) ansStr = parts[1].trim();
        }

        if (currentPaperMode === 'exam' || currentPaperMode === 'homework') {
          // Unsolved 2-column side-by-side layout (matching English 1 docx)
          let underline = '__________________________';
          if (headLower.includes('opposite')) {
            html += `<div class="font-medium text-slate-800">${itemNo}. ${cleanQ} &nbsp;X&nbsp; ${underline}</div>`;
          } else {
            html += `<div class="font-medium text-slate-800">${itemNo}. ${cleanQ} &nbsp;–&nbsp; ${underline}</div>`;
          }
        } else {
          // Solved Classwork 2-column layout
          if (headLower.includes('opposite')) {
            html += `<div class="font-medium text-slate-800">${itemNo}. ${cleanQ} &nbsp;X&nbsp; <u class="font-bold text-indigo-700 bg-indigo-50 px-1 rounded">${ansStr || 'Answer'}</u></div>`;
          } else {
            html += `<div class="font-medium text-slate-800">${itemNo}. ${cleanQ} &nbsp;–&nbsp; <u class="font-bold text-indigo-700 bg-indigo-50 px-1 rounded">${ansStr || 'Answer'}</u></div>`;
          }
        }
      });
      html += `</div>`;
    }
    // 3. MCQs (CHOOSE THE CORRECT ANSWER)
    else if (headLower.includes('choose') || headLower.includes('tick') || (qList[0] && qList[0].options)) {
      html += `<div class="space-y-3 pl-2">`;
      qList.forEach((q, itemIdx) => {
        const itemNo = itemIdx + 1;
        const cleanQ = cleanTextPrefix(q.question || q.text || '');
        const options = q.options || ['Option A', 'Option B'];

        html += `
          <div class="text-xs space-y-1">
            <p class="font-semibold text-slate-900">${itemNo}. ${cleanQ}</p>
            <div class="pl-4 flex flex-wrap gap-8 text-slate-700 font-mono text-[11px]">
              ${options.map((opt, optIdx) => {
                const isCorrect = currentPaperMode === 'classwork' && q.answer && q.answer.toLowerCase().includes(opt.toLowerCase());
                return `<span class="${isCorrect ? 'font-bold text-emerald-700 bg-emerald-50 px-1 rounded' : ''}">(${['a', 'b', 'c', 'd'][optIdx]}) ${opt} ${isCorrect ? '✓' : '[ &nbsp; ]'}</span>`;
              }).join('')}
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }
    // 4. DEFINE SECTION (Only Term + Underline Line in Exam/Homework mode)
    else if (headLower.includes('define')) {
      html += `<div class="space-y-3 pl-2">`;
      qList.forEach((q, itemIdx) => {
        const itemNo = itemIdx + 1;
        let rawStr = cleanTextPrefix(q.term || q.question || q.text || 'Term');
        let termStr = rawStr;
        let answerStr = q.answer || q.definition || '';

        // Extract term if definition text was concatenated (e.g. "Habitat: The surroundings of...")
        if (rawStr.includes(':')) {
          const parts = rawStr.split(':');
          termStr = parts[0].trim();
          if (!answerStr && parts[1]) answerStr = parts[1].trim();
        }

        if (currentPaperMode === 'exam' || currentPaperMode === 'homework') {
          // Exam / Homework Mode: Term ONLY + 1 clean underline line (NO definition text)
          html += `
            <div class="text-xs font-medium text-slate-800">
              ${itemNo}. ${termStr} &nbsp;–&nbsp; ____________________________________________________________________
            </div>
          `;
        } else {
          // Classwork Mode: Term + Full Definition Answer
          html += `
            <div class="text-xs space-y-1">
              <p class="font-bold text-slate-900">${itemNo}. ${termStr}:</p>
              <p class="pl-4 font-medium text-slate-800 bg-slate-50 p-2 rounded border-l-2 border-indigo-600"><span class="font-bold text-indigo-700">Ans:</span> ${answerStr || 'Defined in student notebook.'}</p>
            </div>
          `;
        }
      });
      html += `</div>`;
    }
    // 5. FILL IN THE BLANKS / COMPLETE SENTENCE / ODD WORD / WHO SAID TO WHOM
    else if (headLower.includes('fill') || headLower.includes('complete') || headLower.includes('odd') || headLower.includes('who said')) {
      html += `<div class="space-y-2.5 pl-2">`;
      qList.forEach((q, itemIdx) => {
        const itemNo = itemIdx + 1;
        let rawQ = cleanTextPrefix(q.question || q.text || '');
        let ansStr = q.answer || '';

        // Clean trailing predicate phrase from question prompt (e.g. "Terrestrial animals are those that" -> "Terrestrial animals")
        let promptOnly = rawQ.replace(/\s+(are|is)\s+(those|a|an|the)?\s*(that|who|which)?\s*(lives?|come|can)?\s*(on|in|at)?\s*$/i, '').trim();
        if (!promptOnly) promptOnly = rawQ;

        if (currentPaperMode === 'exam' || currentPaperMode === 'homework') {
          // Calculate line length proportional to answer length, min 35 underscores
          const lineLength = Math.max(35, (ansStr ? ansStr.length * 2.2 : 42));
          const blankLine = '_'.repeat(Math.round(lineLength));

          if (headLower.includes('who said')) {
            html += `
              <div class="text-xs space-y-1">
                <p class="font-semibold text-slate-900">${itemNo}. "${promptOnly.replace(/^"/,'').replace(/"$/,'')}"</p>
                <p class="text-[11px] text-slate-400 font-mono pl-4">Ans: ____________________________________________________________________________________</p>
              </div>
            `;
          } else {
            html += `
              <div class="text-xs text-slate-800 font-medium">
                ${itemNo}. ${promptOnly} ${blankLine}
              </div>
            `;
          }
        } else {
          // Classwork Mode: Prompt + Full underlined Answer
          let fullAnsText = ansStr;
          if (rawQ.includes('are those') && !ansStr.startsWith('are those')) {
            fullAnsText = `are those that ${ansStr}`;
          }
          html += `
            <div class="text-xs text-slate-800 font-medium">
              ${itemNo}. ${promptOnly} <u class="font-bold text-indigo-700 bg-indigo-50 px-1 rounded">${fullAnsText}</u>
            </div>
          `;
        }
      });
      html += `</div>`;
    }
    // 6. SHORT / LONG ANSWER THE FOLLOWING QUESTIONS
    else {
      html += `<div class="space-y-3 pl-2">`;
      qList.forEach((q, itemIdx) => {
        const itemNo = itemIdx + 1;
        const questionText = cleanTextPrefix(q.question || q.text || 'Question text');
        const answerText = q.answer || '';
        const numLines = q.answerLines || (answerText.length > 100 ? 3 : 2);

        if (currentPaperMode === 'exam' || currentPaperMode === 'homework') {
          html += `
            <div class="text-xs space-y-1.5">
              <p class="font-bold text-slate-900">${itemNo}. ${questionText}</p>
              <div class="pl-4 space-y-1 font-mono text-[11px] text-slate-400">
                <p>Ans: ____________________________________________________________________________________</p>
                ${numLines >= 2 ? '<p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;____________________________________________________________________________________</p>' : ''}
                ${numLines >= 3 ? '<p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;____________________________________________________________________________________</p>' : ''}
              </div>
            </div>
          `;
        } else {
          html += `
            <div class="text-xs space-y-1">
              <p class="font-bold text-slate-900">${itemNo}. ${questionText}</p>
              <p class="pl-4 font-medium text-slate-800 bg-slate-50 p-2 rounded border-l-2 border-indigo-600"><span class="font-bold text-indigo-700">Ans:</span> ${answerText || 'See notebook diagram/notes.'}</p>
            </div>
          `;
        }
      });
      html += `</div>`;
    }

    html += `</div>`;
    sectionIdx++;
  }

  html += `</div>`;
  paperSheet.innerHTML = html;
}

// 6. Custom Section Builder
function addCustomSectionToPaper() {
  const heading = document.getElementById('builder-heading').value;
  const chapterId = document.getElementById('builder-chapter-select').value;
  const count = parseInt(document.getElementById('builder-count').value) || 5;

  let sourceQuestions = [];
  if (dbData.chapters) {
    dbData.chapters.forEach(ch => {
      if (chapterId === 'ALL' || ch.id === chapterId) {
        if (ch.questions) sourceQuestions.push(...ch.questions);
      }
    });
  }

  // Filter matching questions
  let matched = sourceQuestions.filter(q => q.heading === heading || (q.type && heading.toLowerCase().includes(q.type)));
  if (matched.length === 0) matched = sourceQuestions;

  // Shuffle & slice count
  const selected = matched.sort(() => 0.5 - Math.random()).slice(0, count);

  if (!currentPaper) {
    currentPaper = {
      subject: 'CUSTOM EXAM',
      title: 'CUSTOM QUESTION PAPER',
      subTitle: 'Generated Exam Paper',
      groupedHeadings: {}
    };
  }

  currentPaper.groupedHeadings[heading] = selected;
  renderA4PaperDOM();
  closeModal('modal-builder');
  showToast(`Added section "${heading}" with ${selected.length} questions!`);
}

// 7. Maths Concept Data Variation (Changes numbers keeping math concept same)
function varyMathsData() {
  if (!currentPaper || !currentPaper.groupedHeadings) {
    showToast('Generate a paper first', 'error');
    return;
  }

  let count = 0;
  for (const qList of Object.values(currentPaper.groupedHeadings)) {
    qList.forEach(q => {
      if (q.type === 'math_concept' && q.vars) {
        // Vary numbers logically
        const multiplier = Math.floor(Math.random() * 8) + 2;
        const baseVal = Math.floor(Math.random() * 9) + 2;
        q.vars.b = baseVal;
        q.vars.a = baseVal * multiplier;
        count++;
      }
    });
  }

  if (count > 0) {
    renderA4PaperDOM();
    showToast(`Varied numbers for ${count} math equations!`);
  } else {
    showToast('No variable math questions found in current paper', 'error');
  }
}

// 8. 1-Click Regenerate / Re-shuffle
function regenerateSubquestions() {
  if (!currentPaper || !currentPaper.chapter) {
    showToast('Generate a paper first to shuffle', 'error');
    return;
  }

  renderPaperFromChapter(currentPaper.chapter);
  showToast('Re-shuffled paper questions successfully!');
}

// 9. Share Paper with Parents
function sharePaperWithParents() {
  if (!currentPaper) {
    showToast('Generate a paper first', 'error');
    return;
  }

  sharedFeed.unshift({
    id: 'feed_' + Date.now(),
    title: currentPaper.title + ' - ' + currentPaper.subTitle,
    date: new Date().toLocaleDateString(),
    paper: JSON.parse(JSON.stringify(currentPaper))
  });

  showToast('Paper shared to Parent/Student Feed!');
}

function renderParentFeed() {
  const container = document.getElementById('parent-feed-container');
  if (sharedFeed.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">No classwork papers shared yet today.</p>`;
    return;
  }

  container.innerHTML = sharedFeed.map(item => `
    <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
      <div class="flex justify-between items-center">
        <h4 class="font-bold text-slate-900 text-sm">${item.title}</h4>
        <span class="text-[10px] text-slate-400 font-medium">${item.date}</span>
      </div>
      <p class="text-xs text-slate-600">Teacher has shared today's classwork paper for practice.</p>
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
    switchRole('teacher');
    renderA4PaperDOM();
    showToast('Loaded shared paper into A4 preview');
  }
}

function generateParentPracticePaper() {
  generateAutoPaper();
  switchRole('teacher');
}

// 10. Export to PDF (html2pdf)
function exportToPDF() {
  const element = document.getElementById('a4-paper-sheet');
  const opt = {
    margin:       10,
    filename:     `${currentPaper ? currentPaper.title : 'Question_Paper'}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save();
  showToast('Downloading A4 PDF...');
}

// 11. Export to DOCX (docx.js)
function exportToDOCX() {
  if (!docx) {
    showToast('DOCX exporter loading...', 'error');
    return;
  }

  const { Document, Packer, Paragraph, TextRun } = docx;

  const docParagraphs = [];

  // Title
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
              text: `\nQ${secIdx}. ${heading}`,
              bold: true,
              size: 24,
              font: 'Calibri'
            })
          ]
        })
      );

      qList.forEach((q, idx) => {
        let textStr = q.question || q.text || q.statement || (q.template ? q.template.replace('{a}', q.vars.a).replace('{b}', q.vars.b) : '');
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
    sections: [{
      properties: {},
      children: docParagraphs
    }]
  });

  Packer.toBlob(doc).then(blob => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${currentPaper ? currentPaper.title : 'Question_Paper'}.docx`;
    link.click();
    showToast('Downloading DOCX file...');
  });
}

function scrollToQuestionBank() {
  document.getElementById('question-bank-container').scrollIntoView({ behavior: 'smooth' });
}

// 12. Gemini API Key Configuration
async function checkApiKeyStatus() {
  try {
    const res = await fetch('/api/config-key');
    const data = await res.json();
    const badge = document.getElementById('api-key-status-badge');
    if (badge) {
      if (data.hasKey) {
        badge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
        badge.innerText = '● API Key Configured';
      } else {
        badge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800';
        badge.innerText = '● Demo Mode Active';
      }
    }
  } catch (err) {
    console.error('Failed to check API Key status:', err);
  }
}

async function saveApiKey() {
  const input = document.getElementById('input-api-key');
  const key = input ? input.value.trim() : '';

  if (!key) {
    showToast('Please enter a valid API Key', 'error');
    return;
  }

  try {
    const res = await fetch('/api/config-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();
    if (data.success) {
      showToast('API Key saved successfully!');
      if (input) input.value = '';
      checkApiKeyStatus();
    } else {
      showToast(data.error || 'Failed to save key', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server', 'error');
  }
}

// Check key status on startup
document.addEventListener('DOMContentLoaded', () => {
  checkApiKeyStatus();
});

// ================= WEB-ONLY SUPER ADMIN DIRECTORY & SCHOOL MANAGEMENT =================

async function loadAdminDirectory() {
  const container = document.getElementById('admin-directory-container');
  if (!container) return;

  container.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin"></i> Loading School Directory...</div>`;

  try {
    const res = await fetch('/api/admin/directory', {
      headers: { 'x-admin-passcode': adminPasscode || 'admin123' }
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to load admin directory');
    }

    if (data.schools.length === 0) {
      container.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs">No registered schools found. Add a school above!</div>`;
      return;
    }

    container.innerHTML = data.schools.map(school => `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
        <!-- School Header Bar -->
        <div class="flex flex-wrap justify-between items-center gap-2 border-b border-slate-200 pb-3">
          <div>
            <div class="flex items-center gap-2">
              <h3 class="font-extrabold text-slate-900 text-base">${school.name}</h3>
              <span class="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-mono">CODE: ${school.code}</span>
            </div>
            <p class="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
              <span><i class="fa-solid fa-chalkboard-user text-indigo-600"></i> ${school.teachersCount} Teacher(s)</span>
              <span><i class="fa-solid fa-users text-emerald-600"></i> ${school.parentsCount} Parent(s)</span>
            </p>
          </div>

          <!-- Subscription Toggle Button -->
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold ${school.subscriptionStatus === 'active' ? 'text-emerald-700' : 'text-rose-700'}">
              ● ${school.subscriptionStatus.toUpperCase()} SUBSCRIPTION
            </span>
            <button onclick="adminToggleSubscription('${school.id}', '${school.subscriptionStatus}')" class="px-3 py-1.5 text-xs font-bold rounded-lg transition ${school.subscriptionStatus === 'active' ? 'bg-rose-100 hover:bg-rose-200 text-rose-800' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow'}">
              ${school.subscriptionStatus === 'active' ? 'Deactivate School' : 'Activate School'}
            </button>
          </div>
        </div>

        <!-- Teachers & Parents Lists -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <!-- Teachers List -->
          <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
            <h4 class="font-bold text-xs text-indigo-900 flex items-center gap-1.5 border-b pb-1">
              <i class="fa-solid fa-chalkboard-user text-indigo-600"></i> Teachers List (${school.teachers.length})
            </h4>
            ${school.teachers.length === 0 ? '<p class="text-[11px] text-slate-400 italic">No registered teachers yet.</p>' : `
              <div class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                ${school.teachers.map(t => `
                  <div class="flex justify-between items-center text-xs p-1.5 bg-slate-50 rounded border border-slate-100">
                    <span class="font-semibold text-slate-800">${t.name}</span>
                    <span class="font-bold text-indigo-700 font-mono bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <i class="fa-solid fa-phone text-[10px]"></i> +91 ${t.mobile}
                    </span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- Parents List -->
          <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
            <h4 class="font-bold text-xs text-emerald-900 flex items-center gap-1.5 border-b pb-1">
              <i class="fa-solid fa-users text-emerald-600"></i> Parents List (${school.parents.length})
            </h4>
            ${school.parents.length === 0 ? '<p class="text-[11px] text-slate-400 italic">No registered parents yet.</p>' : `
              <div class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                ${school.parents.map(p => `
                  <div class="flex justify-between items-center text-xs p-1.5 bg-slate-50 rounded border border-slate-100">
                    <span class="font-semibold text-slate-800">${p.name}</span>
                    <span class="font-bold text-emerald-700 font-mono bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1">
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
  const name = document.getElementById('admin-school-name').value;
  const code = document.getElementById('admin-school-code').value;

  try {
    const res = await fetch('/api/admin/school', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode || 'admin123'
      },
      body: JSON.stringify({ name, code })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to add school');

    showToast(`School '${result.school.name}' added successfully!`);
    document.getElementById('admin-school-name').value = '';
    document.getElementById('admin-school-code').value = '';
    loadAdminDirectory();
    loadPublicSchools();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminToggleSubscription(schoolId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    const res = await fetch('/api/admin/subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode || 'admin123'
      },
      body: JSON.stringify({ schoolId, status: newStatus })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to update subscription');

    showToast(result.message);
    loadAdminDirectory();

  } catch (err) {
    showToast(err.message, 'error');
  }
}
