import { parseResumeText } from './src/frontend/utils/resumeParser.js';

const sampleResume1 = `
Jane Doe
jane.doe@university.edu | (555) 234-5678 | San Francisco, CA | github.com/janedoe | linkedin.com/in/janedoe

EDUCATION
University of California, Berkeley
Bachelor of Science in Computer Science
Expected Graduation: May 2026 | GPA: 3.85

SKILLS
Languages: Python, JavaScript, TypeScript, Java, C++, SQL, HTML/CSS
Frameworks & Tools: React, Node.js, Express, PostgreSQL, MongoDB, Docker, Git, AWS

EXPERIENCE
Software Engineering Intern | Acme Corp (June 2024 - August 2024)
- Developed full-stack web applications using React, TypeScript, and Node.js.
- Implemented REST APIs and optimized PostgreSQL database queries.

PROJECTS
Handshake Job Bot
- Automated job search workflow with Machine Learning and Node.js.
`;

const sampleResume2 = `
Alex Smith
alex.smith99@gmail.com
+1 415 555 9876

Summary
Passionate Software Developer seeking Summer Internship opportunities.

Education
Purdue University
Master of Science in Electrical Engineering
Graduation: December 2025

Technical Skills
Python, Go, Docker, Kubernetes, PyTorch, Linux, CI/CD, Redis, FastAPI

Experience
Full Stack Developer Intern - Tech Solutions Inc.
- Built microservices and cloud deployments with GCP and Docker.
`;

console.log('--- Testing Sample Resume 1 ---');
const parsed1 = parseResumeText(sampleResume1);
console.log(JSON.stringify(parsed1, null, 2));

console.log('\n--- Testing Sample Resume 2 ---');
const parsed2 = parseResumeText(sampleResume2);
console.log(JSON.stringify(parsed2, null, 2));

// Assertions
let failures = 0;
function assert(condition, desc) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${desc}`);
    failures++;
  } else {
    console.log(`✅ Passed: ${desc}`);
  }
}

assert(parsed1.first_name === 'Jane', 'Sample 1 first_name is Jane');
assert(parsed1.last_name === 'Doe', 'Sample 1 last_name is Doe');
assert(parsed1.student_email === 'jane.doe@university.edu', 'Sample 1 email');
assert(parsed1.phone === '(555) 234-5678', 'Sample 1 phone');
assert(parsed1.school_name === 'University of California, Berkeley', 'Sample 1 school');
assert(parsed1.major === 'Computer Science', 'Sample 1 major');
assert(parsed1.degree_pursuing === "Bachelor's", 'Sample 1 degree');
assert(parsed1.grad_month === 'May', 'Sample 1 grad month');
assert(parsed1.grad_year === '2026', 'Sample 1 grad year');
assert(parsed1.skills.includes('React') && parsed1.skills.includes('Python'), 'Sample 1 skills');
assert(parsed1.job_titles.includes('Software Engineering Intern'), 'Sample 1 job title');

assert(parsed2.first_name === 'Alex', 'Sample 2 first_name is Alex');
assert(parsed2.last_name === 'Smith', 'Sample 2 last_name is Smith');
assert(parsed2.student_email === 'alex.smith99@gmail.com', 'Sample 2 email');
assert(parsed2.phone === '(415) 555-9876', 'Sample 2 phone');
assert(parsed2.school_name === 'Purdue University', 'Sample 2 school');
assert(parsed2.major === 'Electrical Engineering', 'Sample 2 major');
assert(parsed2.degree_pursuing === "Master's", 'Sample 2 degree');
assert(parsed2.grad_month === 'December', 'Sample 2 grad month');
assert(parsed2.grad_year === '2025', 'Sample 2 grad year');
assert(parsed2.skills.includes('PyTorch') && parsed2.skills.includes('Docker'), 'Sample 2 skills');
assert(parsed2.job_types.includes('internship'), 'Sample 2 job type');

if (failures > 0) {
  process.exit(1);
}
console.log('\n🎉 ALL RESUME PARSING TESTS PASSED!');
