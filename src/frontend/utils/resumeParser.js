/**
 * resumeParser.js
 *
 * Open-source PDF text extraction and entity parsing for resume auto-fill.
 * Uses pdfjs-dist (legacy build) for robust client-side PDF parsing in web and mobile environments.
 * Extracts: name, email, phone, school name, major, degree, grad year/month, job titles, skills.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

// Set up worker source for browser / web runtime
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
}

/**
 * Common technical and professional skills for matching.
 */
export const COMMON_SKILLS = [
  // Programming Languages
  'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'C', 'Go', 'Golang',
  'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'R', 'SQL', 'HTML', 'CSS', 'HTML5',
  'CSS3', 'Bash', 'Shell', 'PowerShell', 'Dart', 'Scala', 'MATLAB',
  // Frameworks & Libraries
  'React', 'React Native', 'Next.js', 'Vue', 'Vue.js', 'Angular', 'Node.js',
  'Express', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Ruby on Rails',
  'ASP.NET', '.NET', 'Tailwind CSS', 'Bootstrap', 'Redux', 'GraphQL', 'REST API',
  'PyTorch', 'TensorFlow', 'Keras', 'Scikit-Learn', 'Pandas', 'NumPy', 'OpenCV',
  // Databases & Cloud
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Supabase', 'Firebase',
  'DynamoDB', 'Oracle', 'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker',
  'Kubernetes', 'CI/CD', 'Git', 'GitHub', 'GitLab', 'Linux', 'Terraform',
  // Concepts & Domains
  'Machine Learning', 'Deep Learning', 'Data Science', 'Artificial Intelligence',
  'Microservices', 'System Design', 'UI/UX Design', 'Figma', 'Agile', 'Scrum'
];

/**
 * Common job titles for matching and extraction.
 */
export const COMMON_JOB_TITLES = [
  'Software Engineer', 'Software Developer', 'Full Stack Developer', 'Frontend Developer',
  'Backend Developer', 'Mobile Developer', 'iOS Developer', 'Android Developer',
  'Machine Learning Engineer', 'AI Engineer', 'Data Scientist', 'Data Analyst',
  'Data Engineer', 'Product Manager', 'Project Manager', 'DevOps Engineer',
  'Cloud Engineer', 'Systems Engineer', 'Security Engineer', 'QA Engineer',
  'Test Engineer', 'UI/UX Designer', 'Product Designer', 'Research Assistant',
  'Teaching Assistant', 'Software Engineering Intern', 'Software Developer Intern',
  'Data Science Intern', 'Product Management Intern', 'Engineering Intern'
];

/**
 * Common universities & colleges for school name extraction.
 */
export const COMMON_UNIVERSITIES = [
  'Stanford University', 'Harvard University', 'Massachusetts Institute of Technology',
  'MIT', 'UC Berkeley', 'University of California, Berkeley', 'UCLA',
  'University of California, Los Angeles', 'Carnegie Mellon University', 'CMU',
  'Georgia Institute of Technology', 'Georgia Tech', 'University of Washington',
  'University of Michigan', 'University of Illinois Urbana-Champaign', 'UIUC',
  'University of Texas at Austin', 'UT Austin', 'Cornell University', 'Columbia University',
  'Princeton University', 'Yale University', 'University of Pennsylvania', 'UPenn',
  'Brown University', 'Dartmouth College', 'Duke University', 'Northwestern University',
  'Johns Hopkins University', 'New York University', 'NYU', 'University of Southern California',
  'USC', 'Purdue University', 'Texas A&M University', 'University of Florida',
  'San Jose State University', 'Arizona State University', 'Penn State University',
  'Ohio State University', 'Boston University', 'Northeastern University',
  'University of Wisconsin-Madison', 'University of Maryland', 'Rutgers University',
  'University of California, San Diego', 'UCSD', 'University of California, Irvine', 'UCI',
  'University of California, Davis', 'UCD', 'University of California, Santa Barbara', 'UCSB',
  'University of Waterloo', 'University of Toronto', 'Virginia Tech', 'Indiana University'
];

/**
 * Extract raw text from a PDF file (Blob, File, ArrayBuffer, Uint8Array, or uri)
 * @param {Blob|File|ArrayBuffer|Uint8Array|string|object} source
 * @returns {Promise<string>}
 */
export async function extractTextFromPdf(source) {
  let data;
  if (source instanceof Uint8Array) {
    data = source;
  } else if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source);
  } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const arrayBuffer = await source.arrayBuffer();
    data = new Uint8Array(arrayBuffer);
  } else if (typeof source === 'string') {
    const response = await fetch(source);
    const arrayBuffer = await response.arrayBuffer();
    data = new Uint8Array(arrayBuffer);
  } else if (source && typeof source === 'object' && source.uri) {
    const response = await fetch(source.uri);
    const arrayBuffer = await response.arrayBuffer();
    data = new Uint8Array(arrayBuffer);
  } else {
    throw new Error('Unsupported PDF source format');
  }

  const loadingTask = pdfjsLib.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const textPieces = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    
    let lastY = null;
    let pageText = '';
    
    for (const item of content.items) {
      if (!item.str) continue;
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        pageText += '\n';
      } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n') && !item.str.startsWith(' ')) {
        pageText += ' ';
      }
      pageText += item.str;
      lastY = item.transform[5];
    }
    
    textPieces.push(pageText);
  }

  return textPieces.join('\n\n');
}

/**
 * Parse structured entities from resume text.
 * @param {string} text - Raw extracted resume text
 * @returns {object} Extracted and mapped fields
 */
export function parseResumeText(text) {
  if (!text || typeof text !== 'string') {
    return {};
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const cleanFullText = text.replace(/\s+/g, ' ');

  // 1. Email extraction
  let email = null;
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const emailMatch = text.match(emailRegex);
  if (emailMatch) {
    email = emailMatch[1].toLowerCase().trim();
  }

  // 2. Phone extraction
  let phone = null;
  const phoneRegex = /(?:\+?1\s*[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([2-9][0-9]{2})[-.\s]?([0-9]{4})/i;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) {
    phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`;
  }

  // 3. Name extraction
  let firstName = '';
  let lastName = '';
  const headerIgnoreWords = /^(resume|curriculum|vitae|cv|page|contact|email|phone|github|linkedin|portfolio|objective|summary|education|experience|skills)/i;
  
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i];
    if (emailRegex.test(line) || phoneRegex.test(line) || /https?:\/\/|www\./i.test(line) || headerIgnoreWords.test(line)) {
      continue;
    }
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Z][a-zA-Z.'-]*$/.test(w) || /^[A-Z]+$/.test(w))) {
      firstName = words[0];
      lastName = words.slice(1).join(' ');
      break;
    }
  }

  // 4. School / University extraction
  let schoolName = '';
  for (const uni of COMMON_UNIVERSITIES) {
    const uniRegex = new RegExp(`\\b${uni.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (uniRegex.test(text)) {
      schoolName = uni;
      break;
    }
  }

  if (!schoolName) {
    const genericUniRegex = /([A-Z][a-zA-Z\s,&.'-]+(?:University|College|Institute of Technology|Polytechnic|Academy))/i;
    const uniMatch = text.match(genericUniRegex);
    if (uniMatch) {
      schoolName = uniMatch[1].trim().replace(/^[\s,.-]+|[\s,.-]+$/g, '');
    }
  }

  // 5. Major extraction
  let major = '';
  const commonMajors = [
    'Computer Science', 'Computer Engineering', 'Software Engineering',
    'Data Science', 'Electrical Engineering', 'Mechanical Engineering',
    'Information Technology', 'Information Systems', 'Cybersecurity',
    'Biomedical Engineering', 'Chemical Engineering', 'Civil Engineering',
    'Mathematics', 'Applied Mathematics', 'Statistics', 'Physics',
    'Economics', 'Finance', 'Business Administration', 'Accounting',
    'Marketing', 'Psychology', 'Biology', 'Artificial Intelligence',
    'Human-Computer Interaction', 'Cognitive Science'
  ];

  for (const m of commonMajors) {
    const mRegex = new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (mRegex.test(text)) {
      major = m;
      break;
    }
  }

  if (!major) {
    const majorPatternMatch = text.match(/(?:Major|B\.S\.|B\.A\.|M\.S\.|Bachelor of Science|Bachelor of Arts|Master of Science)\s+(?:in|of)\s+([A-Za-z\s]{3,30})/i);
    if (majorPatternMatch) {
      major = majorPatternMatch[1].trim();
    }
  }

  // 6. Degree Pursuing extraction
  let degreePursuing = null;
  if (/Ph\.?D|Doctor of Philosophy|Doctorate/i.test(text)) {
    degreePursuing = 'PhD';
  } else if (/M\.?B\.?A|Master of Business Administration/i.test(text)) {
    degreePursuing = 'MBA';
  } else if (/M\.?S\.|Master of Science|Master of Arts|Master's|Masters/i.test(text)) {
    degreePursuing = "Master's";
  } else if (/B\.?S\.|B\.?A\.|Bachelor of Science|Bachelor of Arts|Bachelor's|Bachelors|Undergraduate/i.test(text)) {
    degreePursuing = "Bachelor's";
  } else if (/Associate|Associate's|A\.?S\.|A\.?A\./i.test(text)) {
    degreePursuing = "Associate's";
  }

  // 7. Graduation Month and Year extraction
  let gradMonth = null;
  let gradYear = null;

  const currentYear = new Date().getFullYear();
  const yearMatches = text.match(/\b(20[2-3][0-9])\b/g);
  if (yearMatches) {
    const validYears = yearMatches
      .map(Number)
      .filter(y => y >= currentYear - 1 && y <= currentYear + 7);
    if (validYears.length > 0) {
      gradYear = String(Math.max(...validYears));
    }
  }

  const monthMap = {
    jan: 'January', january: 'January',
    feb: 'February', february: 'February',
    mar: 'March', march: 'March',
    apr: 'April', april: 'April',
    may: 'May',
    jun: 'June', june: 'June',
    jul: 'July', july: 'July',
    aug: 'August', august: 'August',
    sep: 'September', sept: 'September', september: 'September',
    oct: 'October', october: 'October',
    nov: 'November', november: 'November',
    dec: 'December', december: 'December',
    spring: 'May', summer: 'August', fall: 'December', winter: 'December'
  };

  const gradNearMatch = text.match(/(?:expected|graduation|graduating|class of|dates?)\s*:?\s*(?:in\s*)?([A-Za-z]+)\s*(?:,?\s*(\d{4}))?/i) ||
                        text.match(/([A-Za-z]+)\s+(\d{4})\s*(?:-|–|to)\s*(?:Present|Expected|Current)/i) ||
                        text.match(/(?:-|–|to)\s*([A-Za-z]+)\s+(\d{4})/i);

  if (gradNearMatch) {
    const monthWord = gradNearMatch[1].toLowerCase();
    if (monthMap[monthWord]) {
      gradMonth = monthMap[monthWord];
    }
    if (gradNearMatch[2] && Number(gradNearMatch[2]) >= currentYear - 1) {
      gradYear = String(gradNearMatch[2]);
    }
  }

  if (gradYear && !gradMonth) {
    gradMonth = 'May';
  }

  // 8. Skills extraction
  const foundSkills = [];
  for (const skill of COMMON_SKILLS) {
    const skillRegex = new RegExp(`(^|[^a-zA-Z0-9#+.])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-zA-Z0-9#+.])`, 'i');
    if (skillRegex.test(text)) {
      foundSkills.push(skill);
    }
  }

  // 9. Job Titles extraction
  const foundJobTitles = [];
  for (const title of COMMON_JOB_TITLES) {
    const titleRegex = new RegExp(`\\b${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (titleRegex.test(text)) {
      foundJobTitles.push(title);
    }
  }

  // 10. Job Types inference
  const jobTypes = [];
  if (/intern|internship|co-op|coop/i.test(text)) {
    jobTypes.push('internship');
  }
  if (/full-time|full time|entry-level|entry level|graduate/i.test(text)) {
    jobTypes.push('full_time');
  }
  if (jobTypes.length === 0) {
    jobTypes.push('full_time', 'internship');
  }

  // 11. Format Job Interests
  const interestItems = [
    ...foundJobTitles.slice(0, 3),
    ...foundSkills.slice(0, 5)
  ];
  const jobInterests = interestItems.length > 0 ? interestItems.join(', ') : '';

  return {
    first_name: firstName,
    last_name: lastName,
    student_email: email || '',
    phone: phone || '',
    school_name: schoolName,
    major: major,
    degree_pursuing: degreePursuing,
    grad_month: gradMonth,
    grad_year: gradYear,
    job_types: jobTypes,
    job_interests: jobInterests,
    skills: foundSkills,
    job_titles: foundJobTitles,
    raw_text_snippet: cleanFullText.slice(0, 300),
  };
}
