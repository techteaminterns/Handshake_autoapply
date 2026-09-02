const path = require('path');

// Bot-local .env first, then repo root .env files.
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../.env.local') });

function parseList(value) {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseYear(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Bot test profile loaded from environment variables.
 * Copy bot/.env.example to bot/.env and fill in values locally.
 */
function getBotProfile() {
  const required = ['BOT_FIRST_NAME', 'BOT_LAST_NAME', 'BOT_STUDENT_EMAIL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing bot profile env vars: ${missing.join(', ')}. Copy bot/.env.example to bot/.env.`,
    );
  }

  return {
    firstName: process.env.BOT_FIRST_NAME,
    lastName: process.env.BOT_LAST_NAME,
    studentEmail: process.env.BOT_STUDENT_EMAIL,
    phone: process.env.BOT_PHONE || '',
    schoolName: process.env.BOT_SCHOOL_NAME || '',
    major: process.env.BOT_MAJOR || '',
    subField: process.env.BOT_SUB_FIELD || '',
    degreePursuing: process.env.BOT_DEGREE_PURSUING || '',
    educationLevel: process.env.BOT_EDUCATION_LEVEL || '',
    gradMonth: process.env.BOT_GRAD_MONTH || '',
    gradYear: parseYear(process.env.BOT_GRAD_YEAR),
    country: process.env.BOT_COUNTRY || '',
    heardAboutUs: process.env.BOT_HEARD_ABOUT_US || '',
    currentRole: process.env.BOT_CURRENT_ROLE || '',
    linkedinUrl: process.env.BOT_LINKEDIN_URL || '',
    jobTypes: parseList(process.env.BOT_JOB_TYPES),
    locationsOpenTo: parseList(process.env.BOT_LOCATIONS_OPEN_TO),
    jobInterests: parseList(process.env.BOT_JOB_INTERESTS),
    referralCode: process.env.BOT_REFERRAL_CODE || '',
  };
}

module.exports = {
  getBotProfile,
};
