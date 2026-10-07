const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Data directory setup (Offline Local DB)
const DATA_DIR = path.join(__dirname, 'data');
const QUESTION_BANK_FILE = path.join(DATA_DIR, 'question_bank.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(QUESTION_BANK_FILE)) {
  fs.writeFileSync(QUESTION_BANK_FILE, JSON.stringify({ chapters: [], papers: [] }, null, 2));
}

// Helper: Auto Cleanup data older than 1 year (365 days)
function autoCleanupExpiredData() {
  try {
    const raw = fs.readFileSync(QUESTION_BANK_FILE, 'utf8');
    const data = JSON.parse(raw);
    const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
    
    let totalRemoved = 0;
    if (data.chapters) {
      data.chapters.forEach(ch => {
        if (ch.questions) {
          const originalCount = ch.questions.length;
          ch.questions = ch.questions.filter(q => !q.createdAt || new Date(q.createdAt).getTime() > oneYearAgo);
          totalRemoved += (originalCount - ch.questions.length);
        }
      });
    }

    if (totalRemoved > 0) {
      fs.writeFileSync(QUESTION_BANK_FILE, JSON.stringify(data, null, 2));
      console.log(`[Auto Cleanup] Removed ${totalRemoved} expired questions (>1 year old).`);
    }
  } catch (err) {
    console.error('[Auto Cleanup Error]:', err.message);
  }
}

// Run cleanup on startup & hourly
autoCleanupExpiredData();
setInterval(autoCleanupExpiredData, 60 * 60 * 1000);

// Initialize Gemini API (Free Tier)
let apiKey = process.env.GEMINI_API_KEY || '';

// Endpoint to update API Key on the fly from UI
app.post('/api/config-key', (req, res) => {
  const { key } = req.body;
  if (key !== undefined) {
    apiKey = key.trim();
    process.env.GEMINI_API_KEY = apiKey;
    return res.json({ success: true, message: 'Gemini API Key updated successfully!' });
  }
  res.status(400).json({ error: 'Key is required' });
});

app.get('/api/config-key', (req, res) => {
  res.json({ hasKey: Boolean(apiKey && apiKey.length > 5) });
});

// Helper to get available vision models for the user's API Key via REST
async function getWorkingVisionModels(key) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[AI Vision] ListModels API Error (${response.status}):`, errText);
      return [];
    }
    const data = await response.json();
    if (data.models && Array.isArray(data.models)) {
      // Filter out TTS, Audio, Embedding, Imagen, Gemma models
      const visionEligible = data.models
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .filter(name => 
          !name.includes('tts') && 
          !name.includes('audio') && 
          !name.includes('embedding') && 
          !name.includes('imagen') && 
          !name.includes('gemma') && 
          !name.includes('veo') && 
          !name.includes('bison')
        );
      
      console.log(`[AI Vision] Vision Eligible models for key:`, visionEligible);

      // Preferred priority order for fast OCR
      const preferredOrder = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-pro-latest', 'gemini-1.5-pro'];
      
      const prioritized = [];
      preferredOrder.forEach(p => {
        if (visionEligible.includes(p)) prioritized.push(p);
      });
      visionEligible.forEach(m => {
        if (!prioritized.includes(m)) prioritized.push(m);
      });

      return prioritized.length > 0 ? prioritized : preferredOrder;
    }
  } catch (err) {
    console.warn(`[AI Vision] ListModels fetch failed:`, err.message);
  }
  return ['gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'];
}

// Helper to call Gemini REST API directly
async function callGeminiVisionREST(modelName, key, prompt, imageParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
  
  // Build parts with explicit Page Labels so AI vision reads every page equally
  const parts = [{ text: prompt }];
  imageParts.forEach((img, idx) => {
    parts.push({ text: `\n=== ATTACHED PHOTO PAGE ${idx + 1} OF ${imageParts.length} ===` });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: img.inlineData.data
      }
    });
  });

  const contents = [{ parts }];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.0
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson.error ? errJson.error.message : `HTTP ${res.status}`;
      throw new Error(`[Model ${modelName}] ${msg}`);
    }

    const data = await res.json();
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
      const text = data.candidates[0].content.parts.map(p => p.text).join('');
      return text;
    }
    throw new Error(`[Model ${modelName}] Invalid or empty response structure`);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`[Model ${modelName}] Request timed out after 45s`);
    }
    throw err;
  }
}

// Users & Schools Database Setup
const USERS_SCHOOLS_FILE = path.join(DATA_DIR, 'users_and_schools.json');

if (!fs.existsSync(USERS_SCHOOLS_FILE)) {
  fs.writeFileSync(USERS_SCHOOLS_FILE, JSON.stringify({
    schools: [
      { id: "sch_dps01", name: "Delhi Public School", code: "DPS01", subscriptionStatus: "active", expiryDate: "2028-12-31", createdAt: new Date().toISOString() }
    ],
    users: [],
    systemConfig: { globalApiKey: "", adminPasscode: "admin123" }
  }, null, 2));
}

function getUsersSchoolsData() {
  try {
    const raw = fs.readFileSync(USERS_SCHOOLS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { schools: [], users: [], systemConfig: { adminPasscode: "admin123" } };
  }
}

function saveUsersSchoolsData(data) {
  fs.writeFileSync(USERS_SCHOOLS_FILE, JSON.stringify(data, null, 2));
}

// --- API ENDPOINTS ---

// 0. AUTH & USER MANAGEMENT ENDPOINTS

// Get public school list for registration dropdown
app.get('/api/schools', (req, res) => {
  const db = getUsersSchoolsData();
  const publicSchools = db.schools.map(s => ({ id: s.id, name: s.name, code: s.code, status: s.subscriptionStatus }));
  res.json({ schools: publicSchools });
});

// Registration Endpoint with Password & Confirm Password
app.post('/api/auth/register', (req, res) => {
  const { name, mobile, role, standard, schoolId, cityName, password } = req.body;

  if (!mobile || mobile.length < 10) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number is required' });
  }

  if (!password || password.length < 3) {
    return res.status(400).json({ error: 'Password must be at least 3 characters long' });
  }

  const db = getUsersSchoolsData();
  const existingUser = db.users.find(u => u.mobile === mobile.trim() && u.role === role);

  if (existingUser) {
    return res.status(400).json({ error: 'Mobile number is already registered for this role. Please Login!' });
  }

  const targetSchool = db.schools.find(s => s.id === schoolId) || db.schools[0];
  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    name: (name || 'User').trim(),
    mobile: mobile.trim(),
    role: role || 'teacher',
    standard: standard || 'Std 5',
    schoolId: targetSchool ? targetSchool.id : 'sch_dps01',
    cityName: cityName || '',
    password: password.trim(),
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveUsersSchoolsData(db);

  res.json({
    success: true,
    message: 'Registration successful! Please login with your Mobile Number and Password.',
    user: {
      ...newUser,
      schoolName: targetSchool ? targetSchool.name : 'Default School'
    }
  });
});

// Mobile Number / Name & Password Login Endpoint
app.post('/api/auth/login-mobile', (req, res) => {
  const { mobile, name, password, role, schoolId, adminPasscode } = req.body;

  const db = getUsersSchoolsData();

  // Super Admin Authentication (Web-Only)
  if (role === 'admin') {
    const validPasscode = (db.systemConfig && db.systemConfig.adminPasscode) || 'admin123';
    if (adminPasscode !== validPasscode && password !== validPasscode) {
      return res.status(401).json({ error: 'Invalid Super Admin Passcode' });
    }
    let adminUser = db.users.find(u => u.role === 'admin');
    if (!adminUser) {
      adminUser = { id: 'usr_admin', name: name || 'Super Admin', mobile: mobile || '9999999999', role: 'admin', schoolId: schoolId || 'sch_dps01', createdAt: new Date().toISOString() };
      db.users.push(adminUser);
      saveUsersSchoolsData(db);
    }
    return res.json({
      success: true,
      message: 'Super Admin Login Successful',
      user: { ...adminUser, schoolName: 'Global Super Admin' }
    });
  }

  // Teacher / Parent Mobile Number & Password Login
  const searchInput = (mobile || name || '').trim();
  let existingUser = db.users.find(u => (u.mobile === searchInput || u.name.toLowerCase() === searchInput.toLowerCase()) && u.role === role);

  if (!existingUser) {
    return res.status(404).json({ error: 'Account not found! Please Register first.' });
  }

  if (existingUser.password && password && existingUser.password !== password.trim()) {
    return res.status(401).json({ error: 'Incorrect Password! Please check and try again.' });
  }

  const school = db.schools.find(s => s.id === existingUser.schoolId);

  if (role === 'teacher' && school && school.subscriptionStatus === 'inactive') {
    return res.status(403).json({ error: `School '${school.name}' subscription is currently INACTIVE. Please contact Head Admin.` });
  }

  res.json({
    success: true,
    user: {
      ...existingUser,
      schoolName: school ? school.name : 'Default School',
      subscriptionStatus: school ? school.subscriptionStatus : 'active'
    }
  });
});

// WEB-ONLY SUPER ADMIN DIRECTORY (Standard-wise Listing of Teachers & Parents)
app.get('/api/admin/directory', (req, res) => {
  const passcode = req.headers['x-admin-passcode'];
  const db = getUsersSchoolsData();
  const validPass = (db.systemConfig && db.systemConfig.adminPasscode) || 'admin123';

  if (passcode !== validPass) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Passcode' });
  }

  const directory = db.schools.map(school => {
    const schoolUsers = db.users.filter(u => u.schoolId === school.id);
    const teachers = schoolUsers.filter(u => u.role === 'teacher').map(t => ({ name: t.name, mobile: t.mobile, standard: t.standard || 'Std 5', joined: t.createdAt }));
    const parents = schoolUsers.filter(u => u.role === 'parent').map(p => ({ name: p.name, mobile: p.mobile, standard: p.standard || 'Std 5', joined: p.createdAt }));

    return {
      id: school.id,
      name: school.name,
      code: school.code,
      subscriptionStatus: school.subscriptionStatus || 'active',
      teachersCount: teachers.length,
      parentsCount: parents.length,
      teachers,
      parents
    };
  });

  res.json({
    success: true,
    schools: directory,
    globalApiKey: (db.systemConfig && db.systemConfig.globalApiKey) || apiKey
  });
});

// Admin: Add New School
app.post('/api/admin/school', (req, res) => {
  const passcode = req.headers['x-admin-passcode'];
  const { name, code } = req.body;
  const db = getUsersSchoolsData();
  const validPass = (db.systemConfig && db.systemConfig.adminPasscode) || 'admin123';

  if (passcode !== validPass) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Passcode' });
  }

  if (!name || !code) {
    return res.status(400).json({ error: 'School name and code are required' });
  }

  const newSchool = {
    id: 'sch_' + Date.now(),
    name: name.trim(),
    code: code.trim().toUpperCase(),
    subscriptionStatus: 'active',
    expiryDate: '2028-12-31',
    createdAt: new Date().toISOString()
  };

  db.schools.push(newSchool);
  saveUsersSchoolsData(db);

  res.json({ success: true, message: 'New school added successfully!', school: newSchool });
});

// Admin: Toggle School Subscription Status
app.post('/api/admin/subscription', (req, res) => {
  const passcode = req.headers['x-admin-passcode'];
  const { schoolId, status } = req.body;
  const db = getUsersSchoolsData();
  const validPass = (db.systemConfig && db.systemConfig.adminPasscode) || 'admin123';

  if (passcode !== validPass) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Passcode' });
  }

  const school = db.schools.find(s => s.id === schoolId);
  if (!school) return res.status(404).json({ error: 'School not found' });

  school.subscriptionStatus = status; // 'active' or 'inactive'
  saveUsersSchoolsData(db);

  res.json({ success: true, message: `Updated subscription status for ${school.name} to ${status}` });
});

// 1. Get All Question Banks (by Subject / Chapter)
app.get('/api/question-bank', (req, res) => {
  try {
    const raw = fs.readFileSync(QUESTION_BANK_FILE, 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read question bank' });
  }
});

// 2. Save / Update Question Bank
app.post('/api/question-bank', (req, res) => {
  try {
    const newData = req.body;
    fs.writeFileSync(QUESTION_BANK_FILE, JSON.stringify(newData, null, 2));
    res.json({ success: true, message: 'Question bank updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save question bank' });
  }
});

// 3. AI Vision OCR & Extraction (Converts photos to structured JSON questions)
app.post('/api/convert-images', async (req, res) => {
  const { images, chapterName, chapterNo, subject } = req.body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  // Fallback demo extraction if API key is not yet set by user
  if (!apiKey || apiKey === 'YOUR_FREE_GEMINI_API_KEY_HERE') {
    return res.json({
      success: true,
      demoMode: true,
      message: 'Demo Mode (Add your free GEMINI_API_KEY in Admin tab for live AI vision extraction)',
      extractedData: {
        chapterName: chapterName || 'Sample Chapter',
        chapterNo: chapterNo || '1',
        subject: subject || 'Moral Science',
        sectionQuestions: [
          {
            heading: 'Tick (✓) the correct option:',
            type: 'mcq',
            items: [
              {
                question: 'The Taj Mahal is situated in:',
                options: ['Delhi', 'Agra', 'Ajmer'],
                answer: 'Agra'
              },
              {
                question: 'Our National Flag is:',
                options: ['One colour', 'Two colour', 'Tri-colour'],
                answer: 'Tri-colour'
              }
            ]
          },
          {
            heading: 'Fill in the blanks:',
            type: 'fill_in_blanks',
            items: [
              'The Golden Temple is situated in ______________________.',
              'In olden days, India was called ______________________.',
              'We got freedom on ______________________.'
            ]
          },
          {
            heading: 'Write \'T\' for true and \'F\' for false statements:',
            type: 'true_false',
            items: [
              { statement: 'The Tri-colour flag was hoisted on the Red Fort.', answer: 'True' },
              { statement: 'The Red Fort is situated in Agra.', answer: 'False' }
            ]
          },
          {
            heading: 'Answer the following questions:',
            type: 'short_answer',
            items: [
              'Name any five monuments of India.',
              'Why was India called the \'Golden Sparrow\'?'
            ]
          }
        ]
      }
    });
  }

  try {
    const candidateModels = await getWorkingVisionModels(apiKey);
    
    if (candidateModels.length === 0) {
      return res.status(400).json({ error: 'Your Gemini API key is invalid or has no accessible models. Please check key in Admin tab.' });
    }

    // Prepare image inline data
    const imageParts = images.map(imgBase64 => {
      const base64Data = imgBase64.replace(/^data:image\/\w+;base64,/, '');
      return {
        inlineData: {
          data: base64Data,
          mimeType: 'image/jpeg'
        }
      };
    });

    const prompt = `
You are an expert exam paper OCR & Multi-Page Question Extractor.
You have been provided with ${images.length} image(s) for Subject: "${subject || 'General'}", Chapter ${chapterNo || '1'}: "${chapterName || 'Chapter'}".

STRICT EXTRACTION & DEDUPLICATION RULES:
1. Inspect ALL ${images.length} attached images thoroughly from top to bottom.
2. Compare all pages and include each unique question ONLY ONCE. Do NOT repeat any question or heading.
3. For EVERY question, extract BOTH the question text AND the complete correct answer.
4. Estimate answerLines (1, 2, or 3) for short/long answers based on how long a student's handwritten response would be.
5. For Match Column questions, separate Left Column (item) and Right Column (matched option) into structured pairs.
6. For Fill in the Blanks / Complete the Following: Any text underlined in pencil/pen is the student's ANSWER. Extract ONLY the main un-underlined subject (e.g. 'Terrestrial animals', 'Nocturnal animals', 'Aquatic animals', 'Arboreal animals') as 'question'. Everything after the subject that was written/underlined by the student (e.g. 'are those that lives on land.') MUST be stored in 'answer'. Do NOT include 'are those that' inside 'question'.

Return ONLY a valid JSON object matching this structure (no markdown wrapper, no extra text):
{
  "chapterName": "${chapterName || 'Chapter'}",
  "chapterNo": "${chapterNo || '1'}",
  "subject": "${subject || 'General'}",
  "sectionQuestions": [
    {
      "heading": "Tick (✓) the correct option:",
      "type": "mcq",
      "items": [
        { "question": "Question text...", "options": ["Option A", "Option B", "Option C"], "answer": "Option B" }
      ]
    },
    {
      "heading": "Fill in the blanks:",
      "type": "fill_in_blanks",
      "items": [
        { "question": "The Golden Temple is situated in ________________.", "answer": "Amritsar", "blankWordCount": 1 }
      ]
    },
    {
      "heading": "Write 'T' for true and 'F' for false statements:",
      "type": "true_false",
      "items": [
        { "statement": "Statement text...", "answer": "True" }
      ]
    },
    {
      "heading": "Define:",
      "type": "define",
      "items": [
        { "term": "Habitat", "answer": "The natural surroundings of an animal where it lives." }
      ]
    },
    {
      "heading": "Answer the following questions:",
      "type": "short_answer",
      "items": [
        { "question": "What are mammals?", "answer": "Mammals are warm-blooded animals that give birth to young ones.", "answerLines": 2 }
      ]
    },
    {
      "heading": "Match the column:",
      "type": "match_column",
      "items": [
        { "left": "Webbed feet", "right": "Duck" },
        { "left": "Scratching feet", "right": "Hen" }
      ]
    }
  ]
}
`;

    let responseText = null;
    let lastErr = null;

    // Try available models sequentially
    for (const modelName of candidateModels.slice(0, 4)) {
      try {
        console.log(`[AI Vision REST] Attempting model: ${modelName}`);
        responseText = await callGeminiVisionREST(modelName, apiKey, prompt, imageParts);
        if (responseText) {
          console.log(`[AI Vision REST] Successfully generated with model: ${modelName}`);
          break;
        }
      } catch (mErr) {
        console.warn(`[AI Vision REST] Model ${modelName} error:`, mErr.message);
        lastErr = mErr;
      }
    }

    if (!responseText) {
      throw lastErr || new Error('All accessible Gemini models failed to process the image.');
    }

    const cleanJsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(cleanJsonStr);

    res.json({
      success: true,
      extractedData: parsedData
    });

  } catch (err) {
    console.error('[AI Vision OCR Error]:', err);
    res.status(500).json({ error: 'Failed to extract questions: ' + err.message });
  }
});

// 4. Serve PWA frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Question Paper App running at http://localhost:${PORT}`);
  console.log(`====================================================`);
});
