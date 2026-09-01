const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }

  values.push(value.trim());
  return values;
}

function readLatestProfile(csvFile = process.env.BOT_PROFILE_CSV || path.join(__dirname, '../../data/profile.csv')) {
  if (!fs.existsSync(csvFile)) {
    throw new Error(`Profile CSV not found: ${csvFile}`);
  }

  const lines = fs.readFileSync(csvFile, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error('Profile CSV must contain a header and at least one data row.');
  }

  const headers = parseCsvLine(lines[0]).map(header => header.toLowerCase());
  const values = parseCsvLine(lines[lines.length - 1]);
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));

  const profile = {
    firstName: row.first_name || row.firstname || row.first || '',
    lastName: row.last_name || row.lastname || row.last || '',
    studentEmail: row.student_email || row.email || '',
    phone: row.mobile_number || row.phone || row.mobile || '',
    schoolName: row.school_name || row.school || '',
    major: row.major || '',
    degreePursuing: row.degree_pursuing || row.degree || '',
    gradMonth: row.grad_month || '',
    gradYear: row.grad_year || '',
    linkedinUrl: row.linkedin_url || row.linkedin || '',
  };

  const requiredFields = ['firstName', 'lastName', 'studentEmail'];
  const missingFields = requiredFields.filter(field => !profile[field]);
  if (missingFields.length > 0) {
    throw new Error(`Profile CSV is missing required values: ${missingFields.join(', ')}`);
  }

  if (profile.firstName === 'Replace' || profile.studentEmail === 'student@example.edu') {
    throw new Error('Replace the sample values in bot/data/profile.csv before starting the bot.');
  }

  return profile;
}

module.exports = { readLatestProfile };
