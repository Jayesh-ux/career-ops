#!/usr/bin/env node
// Standalone parser test — replicates the exact logic from bridge-server.mjs lines 591-700
// to verify stream-agnostic extraction without needing the server running.

import { readFileSync } from 'fs';

const files = [
  { name: 'Chartered Accountant', path: 'test-resumes/ca-resume.txt' },
  { name: 'Real Estate Agent', path: 'test-resumes/real-estate-resume.txt' },
  { name: 'Doctor', path: 'test-resumes/doctor-resume.txt' },
];

for (const f of files) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${f.name}`);
  console.log(`${'='.repeat(60)}`);

  const text = readFileSync(f.path, 'utf-8');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines[0] || '';
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : '';
  const phoneMatch = text.match(/\+91\s*\d{5}\s*\d{5}|(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : '';

  // ── Skill extraction ──
  const textLower = text.toLowerCase();
  const ROLE_SUFFIXES = /(?:developer|engineer|architect|designer|manager|analyst|scientist|consultant|specialist|lead|administrator|accountant|officer|executive|coordinator|supervisor|therapist|nurse|doctor|agent|broker|assistant|instructor|teacher|professor|technician|mechanic|inspector|auditor|controller|planner|surveyor|pharmacist|dietitian|counselor|social worker)/i;
  let skills = [];
  const skillsSectionMatch = text.match(/(?:skills|tools|technologies|competencies|proficiencies|technical skills)[:\s]*\n([\s\S]*?)(?:\n\s*\n|\n(?=[A-Z]))/i);
  if (skillsSectionMatch) {
    skills = skillsSectionMatch[1]
      .split(/[,|•·–—]/)
      .map(s => s.replace(/^[\s\d.)\-*]+/, '').trim())
      .filter(s => s.length > 1 && s.length < 60)
      .slice(0, 20);
  }
  const nameWords = name.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s*/i, '').split(/\s+/).filter(Boolean);
  if (skills.length === 0) {
    skills = [...new Set(
      lines.flatMap(l => (l.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || []))
        .filter(t => t.length > 3 && !/^(Dear|Subject|Resume|Curriculum|Contact|Phone|Email|Address|Date|References)/.test(t))
        .filter(t => !nameWords.every(w => t.includes(w)))
    )].slice(0, 15);
  }

  // ── Role/title extraction ──
  // Match line-by-line to avoid section headers粘ing to role words after whitespace collapse
  const TITLE_PATTERNS = /\b(?:junior|senior|lead|principal|staff|chief|head|vp|director|associate|assistant|certified|chartered|licensed|registered)?\s*(?:[A-Za-z.#+-]+\s+){0,2}(?:developer|engineer|architect|designer|manager|analyst|scientist|consultant|specialist|lead|administrator|accountant|officer|executive|coordinator|supervisor|therapist|nurse|doctor|agent|broker|assistant|instructor|teacher|professor|technician|mechanic|inspector|auditor|controller|planner|surveyor|pharmacist|dietitian|counselor|social worker)\b/gi;
  const rolePhrases = [...new Set(
    lines.flatMap(l => (l.match(TITLE_PATTERNS) || []).map(r => r.trim()))
  )].slice(0, 8);
  const titleLine = lines.find(l =>
    l.length > 3 && l.length < 80 &&
    !/^[A-Z0-9._%+-]+@/.test(l) &&
    !/^\+?\d/.test(l) &&
    !/^(http|www\.|linkedin|github)/i.test(l) &&
    !/^(curriculum|resume|cv|contact|phone|email|address)/i.test(l) &&
    ROLE_SUFFIXES.test(l)
  );
  const suggestedKeywords = [...new Set([
    ...rolePhrases,
    ...(titleLine ? [titleLine.trim()] : []),
    ...skills.slice(0, 5),
  ])].slice(0, 10);

  // ── Location extraction ──
  const CITY_PATTERN = /\b(?:mumbai|kalyan|thane|navi mumbai|pune|bangalore|bengaluru|delhi|gurgaon|noida|hyderabad|chennai|kolkata|ahmedabad|goa|jaipur|lucknow|coimbatore|indore|nagpur|surat|vadodara|visakhapatnam|remote|india|usa|uk|canada|australia|singapore|dubai|uae|abu dhabi|sharjah|london|manchester|birmingham|new york|san francisco|seattle|toronto|vancouver|berlin|munich|paris|amsterdam|tokyo|seoul|hong kong|shanghai|bangkok|jakarta|manila|nairobi|lagos|johannesburg|cape town|sao paulo|mexico city|buenos aires|madrid|barcelona|rome|milan|zurich|vienna|prague|warsaw|budapest|lisbon|dublin)\b/gi;
  const suggestedLocations = [...new Set(
    (textLower.match(CITY_PATTERN) || []).map(l => l.charAt(0).toUpperCase() + l.slice(1).toLowerCase())
  )].slice(0, 5);

  // ── Compensation guess ──
  const hasSeniorSignals = /senior|lead|principal|staff|head|director|vp|architect|chief|10\+|8\+|12\+|15\+/i.test(text);
  const hasInternSignals = /\bintern(?:ship)?\b|\bfresher\b|\bentry.?level\b|\bjunior\b/i.test(text);
  const hasExperienceYears = (text.match(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/i) || [])[1];
  const expYears = hasExperienceYears ? parseInt(hasExperienceYears) : 0;
  const isMetroCity = /mumbai|bangalore|pune|delhi|gurgaon|noida|hyderabad|chennai|london|new york|san francisco|singapore|dubai|toronto|berlin|tokyo/i.test(textLower);
  let compensationGuess = '';
  let compensationReason = '';
  if (hasInternSignals) {
    compensationGuess = '1.5-3 LPA';
    compensationReason = 'Resume mentions intern/fresher level — typical entry-level range';
  } else if (hasSeniorSignals || expYears >= 8) {
    compensationGuess = isMetroCity ? '15-30 LPA' : '10-20 LPA';
    compensationReason = `Senior-level signals detected${isMetroCity ? ' in a metro city' : ''} — senior range`;
  } else if (expYears >= 3) {
    compensationGuess = isMetroCity ? '6-12 LPA' : '4-8 LPA';
    compensationReason = `${expYears} years experience${isMetroCity ? ' in a metro city' : ''} — mid-level range`;
  } else if (isMetroCity) {
    compensationGuess = '3-6 LPA';
    compensationReason = 'Metro city location detected — typical range for early-career roles';
  } else {
    compensationGuess = '2.5-5 LPA';
    compensationReason = 'No strong seniority signals — entry-to-mid range estimate';
  }

  console.log(`name: "${name}"`);
  console.log(`email: "${email}"`);
  console.log(`phone: "${phone}"`);
  console.log(`suggestedKeywords: ${JSON.stringify(suggestedKeywords)}`);
  console.log(`suggestedLocations: ${JSON.stringify(suggestedLocations)}`);
  console.log(`compensationGuess: "${compensationGuess}"`);
  console.log(`compensationReason: "${compensationReason}"`);
  console.log(`[debug] rolePhrases: ${JSON.stringify(rolePhrases)}`);
  console.log(`[debug] titleLine: "${titleLine || '(none)'}"`);
  console.log(`[debug] skills (from section): ${JSON.stringify(skills)}`);
}
