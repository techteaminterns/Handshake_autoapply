import { extractTextFromPdf, parseResumeText, COMMON_SKILLS, COMMON_JOB_TITLES, COMMON_UNIVERSITIES } from './src/frontend/utils/resumeParser.js';

const EMPTY_DRAFT = {
  first_name: '', last_name: '', student_email: '', phone: '',
  school_name: '', major: '', degree_pursuing: null,
  grad_month: null, grad_year: null, school_additional_info: '',
  job_types: [],
  locations_open_to: '',
  job_interests:    '',
  profile_visibility: 'community', job_alerts_opt_in: true,
  has_existing_handshake_account: null,
  handshake_email: '',
  handshake_password: '',
  resume_storage_path: null, resume_file_name: null, resume_file_size_bytes: null,
};

console.log('🧪 Starting Resume PDF Parsing & Auto-fill Test Suite...\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// Test 1: Verify constants exported
console.log('Test 1: Constant Dictionaries');
assert(COMMON_SKILLS.includes('Python') && COMMON_SKILLS.includes('React'), 'COMMON_SKILLS contains standard languages/frameworks');
assert(COMMON_JOB_TITLES.includes('Software Engineer'), 'COMMON_JOB_TITLES contains standard job roles');
assert(COMMON_UNIVERSITIES.includes('Stanford University') && COMMON_UNIVERSITIES.includes('UC Berkeley'), 'COMMON_UNIVERSITIES contains university names');

// Test 2: Parse plain resume text with full profile
console.log('\nTest 2: Standard Resume Text Parsing');
const resumeText1 = `
David Miller
david.miller@gatech.edu | (404) 555-0182 | Atlanta, GA
linkedin.com/in/davidmiller | github.com/davidmiller

EDUCATION
Georgia Institute of Technology
Bachelor of Science in Computer Science, Minor in Mathematics
Expected Graduation: May 2026
GPA: 3.92 / 4.0

TECHNICAL SKILLS
Languages: Python, Java, C++, TypeScript, JavaScript, SQL
Frameworks: React, Node.js, Express, Next.js, Django, FastAPI
Developer Tools: Docker, Kubernetes, AWS, Git, Linux, PostgreSQL, MongoDB

EXPERIENCE
Software Engineer Intern
TechCorp Solutions (May 2024 - August 2024)
- Developed microservices with Node.js and TypeScript handling 10k requests/min.
- Built responsive UI components in React and Tailwind CSS.
`;

const parsed1 = parseResumeText(resumeText1);
assert(parsed1.first_name === 'David', 'Extracts first name "David"');
assert(parsed1.last_name === 'Miller', 'Extracts last name "Miller"');
assert(parsed1.student_email === 'david.miller@gatech.edu', 'Extracts student email');
assert(parsed1.phone === '(404) 555-0182', 'Extracts formatted phone number');
assert(parsed1.school_name === 'Georgia Institute of Technology', 'Extracts school name');
assert(parsed1.major === 'Computer Science', 'Extracts major');
assert(parsed1.degree_pursuing === "Bachelor's", 'Extracts degree pursuing');
assert(parsed1.grad_month === 'May', 'Extracts graduation month');
assert(parsed1.grad_year === '2026', 'Extracts graduation year');
assert(parsed1.skills.includes('Python') && parsed1.skills.includes('React') && parsed1.skills.includes('Docker'), 'Extracts skills');
assert(parsed1.job_titles.includes('Software Engineer Intern') || parsed1.job_titles.includes('Software Engineer'), 'Extracts job titles');

// Test 3: Auto-fill Draft Mapping Simulation (matching OnboardingScreen logic)
console.log('\nTest 3: Onboarding Draft Auto-fill Simulation');
let currentDraft = { ...EMPTY_DRAFT };

// Simulate user picking the resume
const simulateAutoFill = (draft, parsedResult, fileInfo) => {
  const updated = {
    ...draft,
    resume_storage_path: fileInfo.storage_path,
    resume_file_name: fileInfo.file_name,
    resume_file_size_bytes: fileInfo.file_size,
  };

  if (parsedResult.first_name) updated.first_name = parsedResult.first_name;
  if (parsedResult.last_name)  updated.last_name = parsedResult.last_name;
  if (parsedResult.student_email) {
    updated.student_email = parsedResult.student_email;
    if (updated.has_existing_handshake_account && !updated.handshake_email) {
      updated.handshake_email = parsedResult.student_email;
    }
  }
  if (parsedResult.phone) updated.phone = parsedResult.phone;
  if (parsedResult.school_name) updated.school_name = parsedResult.school_name;
  if (parsedResult.major) updated.major = parsedResult.major;
  if (parsedResult.degree_pursuing) updated.degree_pursuing = parsedResult.degree_pursuing;
  if (parsedResult.grad_month) updated.grad_month = parsedResult.grad_month;
  if (parsedResult.grad_year) updated.grad_year = parsedResult.grad_year;
  if (parsedResult.job_interests && !draft.job_interests) {
    updated.job_interests = parsedResult.job_interests;
  }
  if (parsedResult.job_types?.length && (!draft.job_types || draft.job_types.length === 0)) {
    updated.job_types = parsedResult.job_types;
  }
  return updated;
};

currentDraft = simulateAutoFill(currentDraft, parsed1, {
  storage_path: 'user_123/resume.pdf',
  file_name: 'David_Miller_Resume.pdf',
  file_size: 45200,
});

assert(currentDraft.first_name === 'David', 'Draft first_name auto-filled');
assert(currentDraft.last_name === 'Miller', 'Draft last_name auto-filled');
assert(currentDraft.student_email === 'david.miller@gatech.edu', 'Draft student_email auto-filled');
assert(currentDraft.phone === '(404) 555-0182', 'Draft phone auto-filled');
assert(currentDraft.school_name === 'Georgia Institute of Technology', 'Draft school_name auto-filled');
assert(currentDraft.major === 'Computer Science', 'Draft major auto-filled');
assert(currentDraft.degree_pursuing === "Bachelor's", 'Draft degree_pursuing auto-filled');
assert(currentDraft.grad_month === 'May', 'Draft grad_month auto-filled');
assert(currentDraft.grad_year === '2026', 'Draft grad_year auto-filled');
assert(currentDraft.resume_file_name === 'David_Miller_Resume.pdf', 'Draft resume_file_name set');

// User edits draft test (user can edit before submit)
currentDraft.phone = '(404) 555-9999';
currentDraft.school_additional_info = 'Campus Honors Program';
assert(currentDraft.phone === '(404) 555-9999', 'User can edit auto-filled phone field');
assert(currentDraft.school_additional_info === 'Campus Honors Program', 'User can add optional fields');

// Test 4: PDF Extraction from Binary Buffer
console.log('\nTest 4: PDF Stream Extraction & Parsing End-to-End');
const pdfBuffer = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 260 >>
stream
BT
/F1 12 Tf
50 700 Td
(Sarah Connor) Tj
0 -20 Td
(sarah.c@mit.edu | 617-555-4321) Tj
0 -20 Td
(Massachusetts Institute of Technology) Tj
0 -20 Td
(Master of Science in Data Science | Graduating December 2025) Tj
0 -20 Td
(Skills: Python, Machine Learning, PyTorch, SQL, AWS) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000222 00000 n 
0000000299 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
610
%%EOF`;

async function testPdfBinary() {
  const uint8 = new Uint8Array(Buffer.from(pdfBuffer));
  const rawText = await extractTextFromPdf(uint8);
  assert(rawText.includes('Sarah Connor'), 'Extracts text containing name from PDF stream');
  assert(rawText.includes('sarah.c@mit.edu'), 'Extracts text containing email from PDF stream');
  
  const parsedPdf = parseResumeText(rawText);
  assert(parsedPdf.first_name === 'Sarah', 'PDF parsed first name "Sarah"');
  assert(parsedPdf.last_name === 'Connor', 'PDF parsed last name "Connor"');
  assert(parsedPdf.student_email === 'sarah.c@mit.edu', 'PDF parsed email');
  assert(parsedPdf.phone === '(617) 555-4321', 'PDF parsed phone');
  assert(parsedPdf.school_name === 'Massachusetts Institute of Technology', 'PDF parsed school name');
  assert(parsedPdf.major === 'Data Science', 'PDF parsed major');
  assert(parsedPdf.degree_pursuing === "Master's", 'PDF parsed degree');
  assert(parsedPdf.grad_month === 'December', 'PDF parsed grad month');
  assert(parsedPdf.grad_year === '2025', 'PDF parsed grad year');
  assert(parsedPdf.skills.includes('Machine Learning') && parsedPdf.skills.includes('PyTorch'), 'PDF parsed skills');

  console.log(`\n========================================`);
  console.log(`Results: ${passedTests} / ${totalTests} tests passed (${Math.round(passedTests/totalTests*100)}%)`);
  console.log(`========================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

testPdfBinary().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
