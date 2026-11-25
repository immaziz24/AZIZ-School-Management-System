// School registration wizard (Registration Mark 1, Batch 98). Platform administrators only: the database rules and the server
// functions decide who may do what, not this file. A full-screen, resumable form that replaces the old Register a school pop-up.
// Mark 1 covers categories A to E (school, recognition, address, owner, principal). F to O are listed and arrive in Marks 2 to 4.
// ---------- field registry: one declarative list drives the form, the validation, the progress and the review ----------
const INDIA_STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const opts = (list) => list.map((x) => (Array.isArray(x) ? x : [x, x]));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9][0-9 -]{6,17}$/;
// Option lists. The server keeps its own copy (functions/index.js); a test checks that the two agree.
export const CLASS_LADDER = ['Nursery', 'KG 1', 'KG 2', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'];
export const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const ATTENDANCE_METHODS = ['Manual', 'QR code', 'Selfie', 'Biometric', 'GPS'];
export const EXAM_SYSTEMS = ['Two terms', 'Three terms', 'Semesters', 'Annual only', 'Unit tests and finals', 'Continuous assessment'];
export const GRADING_SYSTEMS = ['Marks only', 'Percentage', 'Letter grades', '10-point grade (CGPA)', 'Division'];
export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card', 'Online gateway'];
export const CURRENCIES = ['INR', 'BDT', 'NPR', 'AED', 'USD'];
const COMMON_SUBJECTS = ['English', 'Bengali', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'History', 'Geography', 'Physics', 'Chemistry', 'Biology',
  'Computer Science', 'Environmental Studies', 'Art and Craft', 'Physical Education', 'Music'];
export const DOMAIN_PREFERENCES = ['AZIZ subdomain only', 'Connect my own domain later', 'Connect my own domain now'];
export const UPLOAD_LIMITS = { logo: 1024 * 1024, favicon: 256 * 1024, heroImage: 2 * 1024 * 1024, gallery1: 2 * 1024 * 1024, gallery2: 2 * 1024 * 1024, gallery3: 2 * 1024 * 1024,
  gallery4: 2 * 1024 * 1024, gallery5: 2 * 1024 * 1024, gallery6: 2 * 1024 * 1024, ownerPhoto: 1024 * 1024, principalPhoto: 1024 * 1024,
  recognitionCert: 5 * 1024 * 1024, affiliationCert: 5 * 1024 * 1024, ownershipDoc: 5 * 1024 * 1024 };
const DOCUMENT_SLOTS = ['recognitionCert', 'affiliationCert', 'ownershipDoc'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const DOMAIN_NAME = /^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const RESERVED_SUBDOMAINS = ['www', 'app', 'admin', 'api', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'login', 'auth', 'dashboard', 'billing', 'support', 'help', 'status', 'blog', 'docs', 'test', 'demo', 'staging', 'dev', 'aziz', 'root', 'ns1', 'ns2'];
// The colours of each website theme, copied from school.mjs (a test checks the two lists agree).
export const THEME_PALETTES = {
  'classic': ['#14243d', '#faf6ec', '#b8913a'],
  'royal': ['#2e1a4d', '#f7f3fb', '#c29b3f'],
  'emerald': ['#0f3d2e', '#f3f8f4', '#c0a040'],
  'crimson': ['#5a1020', '#fbf4f2', '#c79a3a'],
  'midnight': ['#0b1020', '#e8ecf5', '#d4af37'],
  'teal': ['#0d4a52', '#f1f8f8', '#d0a23c'],
  'maroon': ['#4a0f1f', '#fbf5f4', '#c9a24a'],
  'indigo': ['#1f2a6b', '#f4f5fc', '#d1a53c'],
  'forest': ['#1f4d2b', '#f5f8f1', '#bf9b3a'],
  'sunrise': ['#9a3412', '#fff7ed', '#eab308'],
  'rose': ['#8a1e4a', '#fdf3f6', '#c9a24a'],
  'charcoal': ['#222222', '#f5f5f3', '#c8a24a'],
  'sky': ['#0f5c8a', '#f2f9fd', '#e0b43c'],
  'saffron': ['#7a2e0e', '#fdf6ee', '#d19a2a'],
  'ocean': ['#0b3550', '#f1f7fa', '#c9a23c'],
  'slate': ['#2b2f38', '#f4f5f7', '#b8913a'],
  'obsidian': ['#121212', '#f3ecd6', '#d4af37'],
  'champagne': ['#5b4a2e', '#fbf6ea', '#c9a86a'],
  'sapphire': ['#0b2a5b', '#f4f7fc', '#d4b04a'],
  'emerald-noir': ['#06241c', '#e6f2ec', '#d1b05a'],
  'ruby': ['#6b0f2a', '#fbf3f5', '#e0b55a'],
  'rose-gold': ['#5a3a3f', '#fdf6f4', '#d08a93'],
  'sandstone': ['#6b4f3a', '#faf4ea', '#d9a45e'],
  'lavender': ['#4a3f6b', '#f7f4fc', '#c3aaf0'],
  'sage': ['#3d5a47', '#f4f7f1', '#d2bc72'],
  'blush': ['#8c4a3c', '#fff5f0', '#f0b27c'],
  'pearl': ['#2f3a4a', '#fcfbf7', '#c4a55a'],
  'platinum': ['#3a3f47', '#f6f7f8', '#b4bcc7'],
  'copper': ['#4a2c1a', '#fbf5ee', '#d18b4c'],
  'abyss': ['#04202f', '#e4f1f6', '#6fd0d8'],
  'amethyst': ['#1b1033', '#ece6f7', '#cdb0ff'],
  'bordeaux': ['#3a1020', '#fbf4f3', '#d2a56c'],
  'olive': ['#3b4220', '#f8f7ee', '#cdb84a'],
  'denim': ['#2c4a6e', '#faf5ea', '#d9b66a'],
  'mocha': ['#4b3621', '#f8f1e7', '#d0a778'],
  'aurora': ['#101a2e', '#e8f0ff', '#7fdcc8']
};
const DARK_THEMES = ['obsidian', 'emerald-noir', 'abyss', 'amethyst', 'aurora'];
const THEME_OPTIONS = Object.keys(THEME_PALETTES).map((key) => [key, key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())]);
const socialOk = (url, hosts) => { try { const u = new URL(url); return u.protocol === 'https:' && hosts.includes(u.hostname.replace(/^www\./, '')) && !u.username && !u.password; } catch { return false; } };
export const LOGIN_ROLES = ['owner', 'principal', 'teacher', 'accountant', 'staff', 'office', 'parent', 'student'];
export const INVITATION_METHODS = ['Owner signs in at the app with the invited email', 'Email invitation (when email sending is set up)'];
export const TWO_FACTOR_POLICIES = ['Optional', 'Required for owner and principal', 'Required for all staff'];
export const RETENTION_OPTIONS = ['Standard (platform policy)', 'Extended (7 years)', 'Minimum allowed'];
export const VERIFICATION_STATUSES = ['Unverified', 'Documents received', 'Verified', 'Rejected'];
export const BILLING_CYCLES = ['Monthly', 'Yearly'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_OPTIONS = MONTH_NAMES.map((name, i) => [String(i + 1), name]);
const CLASS_OPTIONS = CLASS_LADDER.map((c) => [c, c]);
const splitList = (value) => String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
// The classes between the lowest and the highest class (empty until both are chosen).
const rangeOf = (v) => { const a = CLASS_LADDER.indexOf(v.lowestClass); const b = CLASS_LADDER.indexOf(v.highestClass); return a >= 0 && b >= a ? CLASS_LADDER.slice(a, b + 1) : []; };
const usesGps = (v) => v.studentAttendanceMethod === 'GPS' || splitList(v.teacherAttendanceMethods).includes('GPS');
const DEFAULT_SESSION = (() => { const y = new Date().getFullYear(); return y + '-' + String(y + 1).slice(2); })();
// "Class 1=A,B|Class 2=A" <-> a map of class name to section names.
const parseSections = (value) => Object.fromEntries(String(value || '').split('|').map((p) => [p.slice(0, Math.max(p.indexOf('='), 0)).trim(), splitList(p.slice(p.indexOf('=') + 1))]).filter(([k]) => k));

export const CATEGORIES = [
  { id: 'A', title: 'Basic school information' }, { id: 'B', title: 'Recognition and affiliation' }, { id: 'C', title: 'Address and contact' },
  { id: 'D', title: 'School owner' }, { id: 'E', title: 'Principal and administration' },
  { id: 'F', title: 'Academic configuration' }, { id: 'G', title: 'Capacity and staff' },
  { id: 'H', title: 'Timing and attendance' }, { id: 'I', title: 'Fees and finance' },
  { id: 'J', title: 'Website and branding' }, { id: 'K', title: 'Domain configuration' },
  { id: 'L', title: 'Facilities' }, { id: 'M', title: 'Subscription and commercial' },
  { id: 'N', title: 'Login and security' }, { id: 'O', title: 'Verification and activation' },
];
const noAffiliation = (v) => !v.board || v.board === 'none' || v.board === 'state';

export const FIELDS = [
  { id: 'F001', key: 'name', cat: 'A', label: 'Official school name', type: 'text', req: true, max: 120, help: 'As it appears on the recognition certificate.' },
  { id: 'F002', key: 'shortName', cat: 'A', label: 'School short name', type: 'text', max: 40 },
  { id: 'F004', key: 'estYear', cat: 'A', label: 'Year of establishment', type: 'number',
    validate: (x) => (x && (!/^[0-9]{4}$/.test(x) || Number(x) < 1800 || Number(x) > new Date().getFullYear()) ? 'Enter a four digit year from 1800 to this year.' : '') },
  { id: 'F005', key: 'schoolType', cat: 'A', label: 'School type', type: 'select', req: true, options: opts(['Government', 'Government aided', 'Private unaided', 'Trust or society run', 'Other']) },
  { id: 'F006', key: 'schoolLevel', cat: 'A', label: 'School level', type: 'select', req: true, options: opts(['Pre-primary', 'Primary', 'Upper primary', 'Secondary', 'Higher secondary', 'Pre-primary to higher secondary']) },
  { id: 'F007', key: 'genderComposition', cat: 'A', label: 'Gender composition', type: 'select', req: true, options: opts(['Co-educational', 'Boys only', 'Girls only']) },
  { id: 'F008', key: 'medium', cat: 'A', label: 'Medium of instruction', type: 'select', req: true, options: opts(['Bengali', 'English', 'Hindi', 'Urdu', 'Nepali', 'More than one', 'Other']) },
  { id: 'F009', key: 'motto', cat: 'A', label: 'School motto', type: 'text', max: 120 },
  { id: 'F010', key: 'description', cat: 'A', label: 'School description', type: 'textarea', max: 1000, wide: true },

  { id: 'F011', key: 'board', cat: 'B', label: 'Education board', type: 'select', req: true,
    options: opts([['none', 'Not affiliated yet'], ['state', 'State board'], ['CBSE', 'CBSE'], ['ICSE', 'ICSE / ISC'], ['Madrasah', 'Madrasah board'], ['NIOS', 'NIOS'], ['Other', 'Other board']]) },
  { id: 'F012', key: 'affiliationNo', cat: 'B', label: 'Board affiliation number', type: 'text', max: 40, showIf: (v) => !noAffiliation(v), reqIf: (v) => !noAffiliation(v), help: 'Needed for CBSE, ICSE, Madrasah, NIOS and other boards.' },
  { id: 'F013', key: 'udise', cat: 'B', label: 'UDISE+ code', type: 'text', max: 20, help: '11 digits. Leave empty if the school has none yet.',
    validate: (x) => (x && !/^[0-9]{11}$/.test(x.replace(/\s/g, '')) ? 'The UDISE+ code has 11 digits.' : '') },
  { id: 'F014', key: 'recognitionNo', cat: 'B', label: 'School recognition number', type: 'text', max: 40 },
  { id: 'F015', key: 'trustName', cat: 'B', label: 'Registered trust or society name', type: 'text', max: 120, showIf: (v) => ['Private unaided', 'Trust or society run', 'Government aided'].includes(v.schoolType) },
  { id: 'F016', key: 'trustRegNo', cat: 'B', label: 'Trust or society registration number', type: 'text', max: 40, showIf: (v) => ['Private unaided', 'Trust or society run', 'Government aided'].includes(v.schoolType) },

  { id: 'F019', key: 'country', cat: 'C', label: 'Country', type: 'select', req: true, options: opts(['India', 'Bangladesh', 'Nepal', 'Other']) },
  { id: 'F020', key: 'state', cat: 'C', label: 'State', req: true, max: 60, dynamicType: (v) => (v.country === 'India' ? 'select' : 'text'), options: opts(INDIA_STATES) },
  { id: 'F021', key: 'district', cat: 'C', label: 'District', type: 'text', req: true, max: 60 },
  { id: 'F022', key: 'block', cat: 'C', label: 'Block or municipality', type: 'text', max: 60 },
  { id: 'F023', key: 'town', cat: 'C', label: 'Village, town or city', type: 'text', req: true, max: 80 },
  { id: 'F024', key: 'street', cat: 'C', label: 'Complete street address', type: 'textarea', req: true, max: 200, wide: true },
  { id: 'F025', key: 'pin', cat: 'C', label: 'PIN code', type: 'text', req: true, max: 10,
    validate: (x, v) => (x && v.country === 'India' && !/^[1-9][0-9]{5}$/.test(x) ? 'An Indian PIN code has 6 digits and does not start with 0.' : x && v.country !== 'India' && !/^[A-Za-z0-9 -]{3,10}$/.test(x) ? 'Enter a valid postal code.' : '') },
  { id: 'F026', key: 'schoolPhone', cat: 'C', label: 'Official school phone', type: 'phone', req: true },
  { id: 'F027', key: 'schoolEmail', cat: 'C', label: 'Official school email', type: 'email', req: true, help: 'The school\'s own address. The owner signs in with the owner email in the next section.' },
  { id: 'F028', key: 'mapLocation', cat: 'C', label: 'Google Maps link or GPS position', type: 'text', max: 200, help: 'For example a maps link, or 22.5726, 88.3639.' },

  { id: 'F029', key: 'ownerName', cat: 'D', label: 'Owner full name', type: 'text', req: true, max: 80 },
  { id: 'F030', key: 'ownerDesignation', cat: 'D', label: 'Owner designation', type: 'text', req: true, max: 60, help: 'For example Chairman, Secretary or Proprietor.' },
  { id: 'F031', key: 'ownerEmail', cat: 'D', label: 'Owner email', type: 'email', req: true, help: 'The owner signs in with this email and accepts the invitation. It must be a real address the owner can open.' },
  { id: 'F032', key: 'ownerMobile', cat: 'D', label: 'Owner mobile', type: 'phone', req: true },
  { id: 'F033', key: 'ownerWhatsapp', cat: 'D', label: 'Owner WhatsApp', type: 'phone' },
  { id: 'F034', key: 'ownerAddress', cat: 'D', label: 'Owner correspondence address', type: 'textarea', max: 300, wide: true },

  { id: 'F037', key: 'principalName', cat: 'E', label: 'Principal full name', type: 'text', max: 80 },
  { id: 'F038', key: 'principalEmail', cat: 'E', label: 'Principal email', type: 'email' },
  { id: 'F039', key: 'principalMobile', cat: 'E', label: 'Principal mobile', type: 'phone' },
  { id: 'F041', key: 'adminName', cat: 'E', label: 'Administrative contact person', type: 'text', max: 80 },
  { id: 'F042', key: 'adminEmail', cat: 'E', label: 'Administrative contact email', type: 'email' },
  { id: 'F043', key: 'adminPhone', cat: 'E', label: 'Administrative contact phone', type: 'phone' },

  // ----- Mark 2: academic, capacity, timing and fees (F044 to F077) -----
  { id: 'F044', key: 'sessionLabel', cat: 'F', label: 'Current academic session', type: 'text', req: true, max: 7, def: DEFAULT_SESSION, help: 'For example 2026-27.',
    validate: (x) => { const m = /^(20[0-9]{2})-([0-9]{2})$/.exec(x); return !m || (Number(m[1]) + 1) % 100 !== Number(m[2]) ? 'Write the session as 2026-27 (the second year is the next one).' : ''; } },
  { id: 'F045', key: 'sessionStartMonth', cat: 'F', label: 'Session starting month', type: 'select', def: '4', options: MONTH_OPTIONS },
  { id: 'F046', key: 'sessionEndMonth', cat: 'F', label: 'Session ending month', type: 'select', def: '3', options: MONTH_OPTIONS },
  { id: 'F047', key: 'lowestClass', cat: 'F', label: 'Lowest class', type: 'select', req: true, redraw: true, options: CLASS_OPTIONS },
  { id: 'F048', key: 'highestClass', cat: 'F', label: 'Highest class', type: 'select', req: true, redraw: true, options: CLASS_OPTIONS,
    validate: (x, v) => (v.lowestClass && CLASS_LADDER.indexOf(x) < CLASS_LADDER.indexOf(v.lowestClass) ? 'The highest class cannot be below the lowest class.' : '') },
  { id: 'F049', key: 'classesOffered', cat: 'F', label: 'Available classes', type: 'multi', wide: true, redraw: true, showIf: (v) => rangeOf(v).length > 0, optionsFn: (v) => rangeOf(v).map((c) => [c, c]),
    help: 'Leave all unticked to offer every class in the range.' },
  { id: 'F050', key: 'sectionsByClass', cat: 'F', label: 'Sections for each class', type: 'sections', wide: true, showIf: (v) => rangeOf(v).length > 0, max: 900,
    help: 'Write the section names separated by commas, for example A, B. A class left empty gets one section, A.' },
  { id: 'F051', key: 'subjects', cat: 'F', label: 'Subjects offered', type: 'subjects', wide: true, max: 900,
    help: 'Every offered class gets these subjects. You can change that later in Academic Setup.' },
  { id: 'F052', key: 'examSystem', cat: 'F', label: 'Examination system', type: 'select', options: opts(EXAM_SYSTEMS) },
  { id: 'F053', key: 'gradingSystem', cat: 'F', label: 'Grading system', type: 'select', options: opts(GRADING_SYSTEMS) },

  { id: 'F054', key: 'studentCount', cat: 'G', label: 'Current student count', type: 'int', req: true, maxInt: 100000 },
  { id: 'F055', key: 'maxCapacity', cat: 'G', label: 'Maximum student capacity', type: 'int', maxInt: 100000,
    validate: (x, v) => (/^[0-9]+$/.test(v.studentCount || '') && Number(x) < Number(v.studentCount) ? 'Capacity cannot be lower than the current student count.' : '') },
  { id: 'F056', key: 'teacherCount', cat: 'G', label: 'Teacher count', type: 'int', req: true, maxInt: 10000 },
  { id: 'F057', key: 'nonTeachingCount', cat: 'G', label: 'Non-teaching staff count', type: 'int', maxInt: 10000 },
  { id: 'F058', key: 'adminStaffCount', cat: 'G', label: 'Administrative staff count', type: 'int', maxInt: 10000 },
  { id: 'F059', key: 'classroomCount', cat: 'G', label: 'Classroom count', type: 'int', maxInt: 5000 },
  { id: 'F060', key: 'campusCount', cat: 'G', label: 'Campus or branch count', type: 'int', min: 1, maxInt: 50, def: '1' },

  { id: 'F061', key: 'openTime', cat: 'H', label: 'School opening time', type: 'time' },
  { id: 'F062', key: 'closeTime', cat: 'H', label: 'School closing time', type: 'time',
    validate: (x, v) => (v.openTime && x <= v.openTime ? 'Closing time must be after the opening time.' : '') },
  { id: 'F063', key: 'workingDays', cat: 'H', label: 'Working days', type: 'multi', wide: true, def: 'Mon,Tue,Wed,Thu,Fri,Sat', options: opts(WEEK_DAYS) },
  { id: 'F064', key: 'weeklyHolidays', cat: 'H', label: 'Weekly holidays', type: 'multi', wide: true, def: 'Sun', options: opts(WEEK_DAYS),
    validate: (x, v) => (splitList(x).some((d) => splitList(v.workingDays).includes(d)) ? 'A day cannot be both a working day and a weekly holiday.' : '') },
  { id: 'F065', key: 'teacherReportTime', cat: 'H', label: 'Teacher reporting time', type: 'time', redraw: true,
    validate: (x, v) => (v.closeTime && x >= v.closeTime ? 'Reporting time must be before the closing time.' : '') },
  { id: 'F066', key: 'lateGraceMinutes', cat: 'H', label: 'Late grace period (minutes)', type: 'int', maxInt: 180, showIf: (v) => Boolean(v.teacherReportTime) },
  { id: 'F067', key: 'studentAttendanceMethod', cat: 'H', label: 'Student attendance method', type: 'select', redraw: true, options: opts(ATTENDANCE_METHODS) },
  { id: 'F068', key: 'teacherAttendanceMethods', cat: 'H', label: 'Teacher attendance methods', type: 'multi', wide: true, redraw: true, options: opts(ATTENDANCE_METHODS),
    help: 'Choosing a method only records the school\'s wish. QR, selfie and biometric devices are set up separately, and may need a plan that includes them.' },
  { id: 'F069', key: 'geofenceRadius', cat: 'H', label: 'GPS geofencing radius (metres)', type: 'int', min: 10, maxInt: 5000, showIf: (v) => usesGps(v), reqIf: (v) => usesGps(v),
    help: 'Needed when GPS attendance is chosen. Location is collected only with the staff member\'s permission.' },

  { id: 'F070', key: 'currency', cat: 'I', label: 'Currency', type: 'select', def: 'INR', options: opts(CURRENCIES) },
  { id: 'F071', key: 'admissionFee', cat: 'I', label: 'Admission fee', type: 'money' },
  { id: 'F072', key: 'tuitionFee', cat: 'I', label: 'Monthly tuition fee structure', type: 'textarea', max: 500, wide: true, help: 'For example: Class 1 to 5: 500, Class 6 to 8: 700. You can set exact fees per class after registration.' },
  { id: 'F073', key: 'annualFee', cat: 'I', label: 'Annual fees', type: 'money' },
  { id: 'F074', key: 'examFee', cat: 'I', label: 'Examination fees', type: 'money' },
  { id: 'F075', key: 'feeDueDay', cat: 'I', label: 'Monthly fee due date (day of the month)', type: 'int', min: 1, maxInt: 28 },
  { id: 'F076', key: 'latePolicy', cat: 'I', label: 'Late payment policy', type: 'textarea', max: 500, wide: true },
  { id: 'F077', key: 'paymentMethods', cat: 'I', label: 'Accepted payment methods', type: 'multi', wide: true, options: opts(PAYMENT_METHODS) },

  // ----- Mark 3: uploads of Marks 1 to 2, then website, domain and facilities (F078 to F100) -----
  { id: 'F017', key: 'recognitionCert', cat: 'B', label: 'Recognition certificate', type: 'upload', wide: true, help: 'PDF, JPG, PNG or WEBP, up to 5 MB. Kept private.' },
  { id: 'F018', key: 'affiliationCert', cat: 'B', label: 'Affiliation certificate', type: 'upload', wide: true, help: 'PDF, JPG, PNG or WEBP, up to 5 MB. Kept private.' },
  { id: 'F035', key: 'ownerPhoto', cat: 'D', label: 'Owner photograph', type: 'upload', wide: true, help: 'JPG, PNG or WEBP, up to 1 MB. Kept private.' },
  { id: 'F036', key: 'ownershipDoc', cat: 'D', label: 'Ownership or authorization document', type: 'upload', wide: true, help: 'PDF, JPG, PNG or WEBP, up to 5 MB. Kept private.' },
  { id: 'F040', key: 'principalPhoto', cat: 'E', label: 'Principal photograph', type: 'upload', wide: true, help: 'JPG, PNG or WEBP, up to 1 MB. Kept private.' },

  { id: 'F078', key: 'logo', cat: 'J', label: 'School logo', type: 'upload', help: 'PNG, JPG or WEBP, up to 1 MB. SVG is not accepted.' },
  { id: 'F079', key: 'favicon', cat: 'J', label: 'Favicon (small browser icon)', type: 'upload', help: 'PNG, JPG or WEBP, up to 256 KB.' },
  { id: 'F080', key: 'heroImage', cat: 'J', label: 'Hero image (home page banner)', type: 'upload', wide: true, help: 'PNG, JPG or WEBP, up to 2 MB.' },
  { id: 'F081', key: 'websiteTheme', cat: 'J', label: 'Website theme', type: 'select', options: THEME_OPTIONS, help: 'Preview only. Nothing is published to a public website at registration.' },
  { id: 'F082', key: 'brandPrimary', cat: 'J', label: 'Primary brand colour', type: 'colour', help: 'Like #14243D. Leave empty to use the theme.' },
  { id: 'F083', key: 'brandSecondary', cat: 'J', label: 'Secondary brand colour', type: 'colour' },
  { id: 'F084', key: 'principalMessage', cat: 'J', label: 'Principal\'s message', type: 'textarea', max: 900, wide: true },
  { id: 'F085', key: 'mission', cat: 'J', label: 'Mission', type: 'textarea', max: 500, wide: true },
  { id: 'F086', key: 'vision', cat: 'J', label: 'Vision', type: 'textarea', max: 500, wide: true },
  { id: 'F087', key: 'gallery', cat: 'J', label: 'Gallery images (up to 6)', type: 'gallery', wide: true, help: 'PNG, JPG or WEBP, up to 2 MB each.' },

  { id: 'F088', key: 'preferredSubdomain', cat: 'K', label: 'Preferred subdomain', type: 'subdomain', wide: true, max: 30,
    validate: (x) => (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(x) || x.includes('--') ? 'Use 3 to 30 lowercase letters, numbers or single dashes, starting with a letter.' : RESERVED_SUBDOMAINS.includes(x) ? 'That name is reserved by the platform.' : '') },
  { id: 'F089', key: 'customDomain', cat: 'K', label: 'Existing custom domain', type: 'text', max: 100, wide: true, help: 'For example school.example.com. Ownership is checked through a DNS record, below.',
    showIf: (v) => v.domainPreference !== 'AZIZ subdomain only', reqIf: (v) => v.domainPreference === 'Connect my own domain now',
    validate: (x) => (DOMAIN_NAME.test(x) ? '' : 'Enter a domain like school.example.com (lowercase, no https://).') },
  { id: 'F090', key: 'domainPreference', cat: 'K', label: 'Domain configuration preference', type: 'select', def: 'AZIZ subdomain only', redraw: true, options: opts(DOMAIN_PREFERENCES) },
  { id: 'F091', key: 'facebookUrl', cat: 'K', label: 'Facebook page link', type: 'url', max: 300, validate: (x) => (socialOk(x, ['facebook.com', 'fb.com']) ? '' : 'Enter an https link on facebook.com.') },
  { id: 'F092', key: 'instagramUrl', cat: 'K', label: 'Instagram link', type: 'url', max: 300, validate: (x) => (socialOk(x, ['instagram.com']) ? '' : 'Enter an https link on instagram.com.') },
  { id: 'F093', key: 'youtubeUrl', cat: 'K', label: 'YouTube link', type: 'url', max: 300, validate: (x) => (socialOk(x, ['youtube.com', 'youtu.be']) ? '' : 'Enter an https link on youtube.com.') },

  { id: 'F094', key: 'facilityTransport', cat: 'L', label: 'Transport (school buses)', type: 'toggle' },
  { id: 'F095', key: 'facilityHostel', cat: 'L', label: 'Hostel', type: 'toggle' },
  { id: 'F096', key: 'facilityLibrary', cat: 'L', label: 'Library', type: 'toggle' },
  { id: 'F097', key: 'facilityLab', cat: 'L', label: 'Laboratory', type: 'toggle' },
  { id: 'F098', key: 'facilityComputerLab', cat: 'L', label: 'Computer laboratory', type: 'toggle' },
  { id: 'F099', key: 'facilityCanteen', cat: 'L', label: 'Canteen', type: 'toggle' },
  { id: 'F100', key: 'facilitySports', cat: 'L', label: 'Sports and playground', type: 'toggle' },
  // ----- Mark 4: commercial, login and security, verification (F101 to F120). Prices come from the server; the form only shows them. -----
  { id: 'F101', key: 'planId', cat: 'M', label: 'Subscription plan', type: 'plan', req: true, help: 'From the plan catalog. Plan changes are made by a platform administrator only.' },
  { id: 'F102', key: 'trialEnabled', cat: 'M', label: 'Start with a free trial', type: 'select', def: 'Yes', redraw: true, options: [['Yes', 'Yes'], ['No', 'No']], help: 'A trial is a billing state, not a separate plan.' },
  { id: 'F103', key: 'trialDays', cat: 'M', label: 'Trial duration', type: 'select', def: '30', showIf: (v) => v.trialEnabled !== 'No', options: [['30', '30 days'], ['60', '60 days'], ['90', '90 days']] },
  { id: 'F104', key: 'billingCycle', cat: 'M', label: 'Billing cycle', type: 'select', def: 'Monthly', options: opts(BILLING_CYCLES) },
  { id: 'F105', key: 'setupFee', cat: 'M', label: 'Setup fee', type: 'calc', help: 'Worked out by the server from the plan catalog.' },
  { id: 'F106', key: 'subscriptionPrice', cat: 'M', label: 'Subscription price', type: 'calc', wide: true },
  { id: 'F107', key: 'discountPercent', cat: 'M', label: 'Special discount (percent of the recurring price)', type: 'int', def: '0', maxInt: 100, help: 'Taken off the subscription price only. It is recorded in the audit log with the reason you give at the end.' },
  { id: 'F108', key: 'maxStudents', cat: 'M', label: 'Maximum student allowance', type: 'calc' },
  { id: 'F109', key: 'storageAllocated', cat: 'M', label: 'Allocated cloud storage', type: 'calc' },
  { id: 'F110', key: 'entitlements', cat: 'M', label: 'Paid feature entitlements', type: 'calc', wide: true, help: 'The features of the chosen plan, as listed in the catalog.' },

  { id: 'F111', key: 'ownerLoginEmail', cat: 'N', label: 'Owner login email', type: 'calc', help: 'Taken from the owner email in step D. The owner must sign in with this verified email to accept the invitation.' },
  { id: 'F112', key: 'invitationMethod', cat: 'N', label: 'Invitation method', type: 'select', req: true, def: INVITATION_METHODS[0], options: opts(INVITATION_METHODS), help: 'Email delivery of invitations is set up in Mark 5. Until then the owner signs in at the app.' },
  { id: 'F113', key: 'twoFactorPolicy', cat: 'N', label: 'Two-factor authentication policy', type: 'select', req: true, def: 'Optional', options: opts(TWO_FACTOR_POLICIES), help: 'Recorded now. Enforcing it at sign-in is switched on in a later release.' },
  { id: 'F114', key: 'loginRoles', cat: 'N', label: 'Enabled login roles', type: 'multi', wide: true, req: true, def: LOGIN_ROLES.join(','), options: opts(LOGIN_ROLES),
    validate: (x) => (splitList(x).includes('owner') ? '' : 'The owner role must stay enabled.') },
  { id: 'F115', key: 'dataRetention', cat: 'N', label: 'Data retention and privacy configuration', type: 'select', req: true, def: RETENTION_OPTIONS[0], options: opts(RETENTION_OPTIONS) },

  { id: 'F116', key: 'verificationStatus', cat: 'O', label: 'School verification status', type: 'select', req: true, def: 'Unverified', options: opts(VERIFICATION_STATUSES), help: 'Change it after you have checked the documents. Activation needs "Verified".' },
  { id: 'F117', key: 'termsAccepted', cat: 'O', label: 'Terms of service acceptance', type: 'consent', help: 'Only the school owner can accept, after signing in. You cannot accept for them.' },
  { id: 'F118', key: 'privacyAccepted', cat: 'O', label: 'Privacy and data processing agreement', type: 'consent', help: 'Only the school owner can accept, after signing in.' },
  { id: 'F119', key: 'internalNotes', cat: 'O', label: 'Registration reason and internal notes', type: 'textarea', max: 500, wide: true, help: 'Private to the platform. The school never sees these.' },
  { id: 'F120', key: 'activationStatus', cat: 'O', label: 'Activation status', type: 'calc', help: 'Set by the server. Activation needs the owner\'s consent and a Verified school.' },
];
FIELDS.sort((a, b) => a.id.localeCompare(b.id));
const ACTIVE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];

const typeOf = (field, v) => (field.dynamicType ? field.dynamicType(v) : field.type);
const visible = (field, v) => !field.showIf || field.showIf(v);
const required = (field, v) => visible(field, v) && (field.req === true || (field.reqIf ? field.reqIf(v) : false));
// Returns the problem with one field, or ''. Hidden fields are never checked (C08).
export function fieldProblem(field, v) {
  if (!visible(field, v)) return '';
  const x = String(v[field.key] ?? '').trim();
  if (!x) return required(field, v) ? field.label + ' is required.' : '';
  const type = typeOf(field, v);
  if (field.max && x.length > field.max) return field.label + ' is too long (' + field.max + ' characters at most).';
  if (type === 'email' && !EMAIL.test(x)) return 'Enter a valid email address.';
  if (type === 'phone' && !PHONE.test(x)) return 'Enter a phone number with digits only (a leading + is fine).';
  if (type === 'select' && !field.options.some(([value]) => value === x)) return 'Choose one of the listed options.';
  if (type === 'multi') { const list = field.optionsFn ? field.optionsFn(v) : field.options; if (splitList(x).some((item) => !list.some(([value]) => value === item))) return 'Choose from the listed options.'; }
  if (type === 'colour' && !HEX.test(x)) return 'Enter a colour like #14243D.';
  if (type === 'url' && !/^https:\/\//.test(x)) return 'The link must start with https://.';
  if (type === 'time' && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(x)) return 'Enter a time like 08:30.';
  if (type === 'int') {
    if (!/^[0-9]{1,6}$/.test(x)) return 'Enter a whole number, zero or more.';
    if (field.min !== undefined && Number(x) < field.min) return 'Enter ' + field.min + ' or more.';
    if (field.maxInt !== undefined && Number(x) > field.maxInt) return 'Enter ' + field.maxInt + ' or less.';
  }
  if (type === 'money' && !/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(x)) return 'Enter an amount with at most 2 decimals, for example 1500 or 1500.50.';
  if (type === 'sections') {
    const range = rangeOf(v);
    for (const [name, list] of Object.entries(parseSections(x))) {
      if (!range.includes(name)) return name + ' is not in the class range.';
      if (list.length > 8) return name + ' can have at most 8 sections.';
      if (list.some((n) => !/^[A-Za-z0-9 ]{1,10}$/.test(n))) return 'Section names use letters and numbers, up to 10 characters.';
    }
  }
  if (type === 'subjects') {
    const names = splitList(x);
    if (names.length > 40) return 'Add at most 40 subjects.';
    if (names.some((n) => n.length > 80 || !/[A-Za-z0-9]/.test(n))) return 'A subject name is too long or has no letters.';
  }
  return field.validate ? field.validate(x, v) : '';
}
export const stepProblems = (cat, v) => FIELDS.filter((f) => f.cat === cat).map((f) => ({ field: f, message: fieldProblem(f, v) })).filter((p) => p.message);
// A section with required fields is done when they are all filled and valid. A section with none (principal and administration) is done once something valid is entered.
export const stepDone = (cat, v) => {
  const own = FIELDS.filter((f) => f.cat === cat && visible(f, v));
  const mustFill = own.filter((f) => required(f, v));
  if (stepProblems(cat, v).length || !mustFill.every((f) => String(v[f.key] ?? '').trim())) return false;
  return mustFill.length > 0 || own.some((f) => String(v[f.key] ?? '').trim() && String(v[f.key]).trim() !== f.def);
};
// Progress counts only the steps that are valid and applicable, not the steps that were merely visited.
export const progressOf = (v) => ACTIVE.filter((cat) => stepDone(cat, v)).length;
const newDraftId = () => 'OB-' + Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');

const STYLE = `
#onb{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--navy);color:var(--ivory)}
#onb *{box-sizing:border-box}
#onb .ob-top{display:flex;align-items:center;gap:14px;padding:12px 22px;border-bottom:1px solid var(--line);background:var(--navy2)}
#onb .ob-top h1{font-size:1.5rem;flex:1;margin:0}
#onb .ob-chip{font-size:.82rem;color:var(--muted)}#onb .ob-chip.bad{color:var(--red)}#onb .ob-chip.ok{color:var(--green)}
#onb .ob-body{flex:1;overflow:auto}
#onb .ob-wrap{display:grid;grid-template-columns:270px minmax(0,1fr);gap:26px;max-width:1240px;margin:0 auto;padding:22px}
#onb nav.ob-nav{position:sticky;top:0;align-self:start}
#onb nav.ob-nav button{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:none;border:0;border-radius:10px;padding:8px 10px;color:var(--ivory);cursor:pointer}
#onb nav.ob-nav button:hover:not(:disabled){background:#16264f}
#onb nav.ob-nav button.on{background:#1b2c58;box-shadow:inset 3px 0 0 var(--gold)}
#onb nav.ob-nav button:disabled{color:var(--muted);cursor:default;opacity:.7}
#onb nav.ob-nav b{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--line);font-size:.8rem;flex:none}
#onb nav.ob-nav b.done{background:var(--green);border-color:var(--green);color:#06150e}
#onb nav.ob-nav small{display:block;color:var(--muted)}
#onb .ob-fs{border:1px solid var(--line);border-radius:12px;margin:12px 0 4px;padding:6px 14px 12px;grid-column:1/-1;min-width:0}
#onb .ob-fs legend{padding:0 6px;color:var(--muted);font-size:.85rem}
#onb .ob-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:2px 14px}
#onb .ob-checks label,#onb .ob-sections label{display:flex;gap:8px;align-items:center;margin:4px 0}
#onb .ob-checks input{width:auto}
#onb .ob-sections{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 16px}
#onb .ob-sections label{display:block}
#onb .ob-file{display:flex;gap:12px;align-items:center;margin:6px 0}
#onb .ob-thumb{width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff}
#onb .ob-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 14px}
#onb .ob-toggle{display:flex;gap:8px;align-items:center}
#onb .ob-toggle input{width:auto}
#onb .ob-preview{margin:16px 0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--pv-bg,#faf6ec);color:var(--pv-ink,#1b1b1b);max-width:520px;padding-bottom:10px}
#onb .pv-bar{display:flex;gap:10px;align-items:center;padding:10px 14px;background:var(--pv-main,#14243d);color:#fff}
#onb .pv-logo{width:30px;height:30px;object-fit:contain;background:#fff;border-radius:6px}
#onb .pv-hero{min-height:110px;padding:18px 14px;background-size:cover;background-position:center;background-color:rgba(0,0,0,.04)}
#onb .pv-msg{margin:0;background:rgba(255,255,255,.82);color:#1b1b1b;padding:8px 10px;border-radius:8px;font-size:.9rem}
#onb .pv-btn{display:inline-block;margin:0 14px;padding:6px 14px;border-radius:20px;background:var(--pv-accent,#b8913a);color:#111;font-weight:600;font-size:.85rem}
#onb .ob-preview small{display:block;margin:8px 14px 0;opacity:.7}
#onb .ob-pick{display:none}
#onb .ob-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 18px}
#onb .ob-grid .wide{grid-column:1/-1}
#onb .ob-grid label,#onb .ob-pickl{display:block;margin:10px 0 2px}
#onb .ob-id{display:inline-block;font-size:.72rem;color:var(--muted);margin-left:6px}
#onb .ob-req{color:var(--gold)}
#onb .ob-help{color:var(--muted);font-size:.8rem;margin:3px 0 0}
#onb .ob-err{color:var(--red);font-size:.82rem;margin:3px 0 0;min-height:1em}
#onb [aria-invalid=true]{border-color:var(--red)}
#onb .ob-sum{border:1px solid var(--red);border-radius:12px;padding:10px 14px;margin:0 0 14px}
#onb .ob-warn{border:1px solid #7a6226;background:#2a2410;border-radius:12px;padding:10px 14px;margin:0 0 14px}
#onb .ob-foot{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 22px;border-top:1px solid var(--line);background:var(--navy2)}
#onb .ob-bar{height:8px;background:#1b2542;border-radius:6px;overflow:hidden;margin:6px 0 14px}#onb .ob-bar i{display:block;height:100%;background:var(--gold)}
#onb table.ob-rev td:first-child{width:38%;color:var(--muted)}
#onb .ob-list a{display:block;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin:6px 0;text-decoration:none;color:var(--ivory)}
#onb .ob-list a:hover{border-color:var(--gold)}
@media (max-width:820px){#onb .ob-wrap{grid-template-columns:1fr;padding:14px}#onb nav.ob-nav{display:none}#onb .ob-pick{display:block}#onb .ob-grid{grid-template-columns:1fr}#onb .ob-top{padding:10px 14px}#onb .ob-foot{padding:10px 14px;flex-wrap:wrap}}
`;

// ---------- the wizard ----------
// ctx: { app, user, h, toast, friendly, plans: () => Promise<[[value, label]]>, goSchool: (id) => void }
// Drafts are read and saved by server functions (the browser rules do not expose them), so no Firestore import is needed here.
export async function mountOnboarding(ctx, draftIdFromRoute) {
  const { app, h, toast, friendly } = ctx;
  unmountOnboarding();
  if (!document.getElementById('onb-style')) document.head.append(h('style', { id: 'onb-style' }, STYLE));
  const root = h('div', { id: 'onb' });
  document.body.append(root);
  document.body.style.overflow = 'hidden';

  const S = { draftId: draftIdFromRoute || '', exists: false, revision: 0, step: 0, values: {}, schoolId: '', dupes: [], saveState: '', saveAt: '', busy: false, reason: '', registered: null, files: {}, thumbs: {}, subHeld: '', domainInfo: null, domainStatus: '', plans: [], quote: null, quoteNote: '', quoteTimer: 0 };
  let timer = 0; let saving = false; let dirty = false;

  const call = async (name, data) => {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    return (await httpsCallable(getFunctions(app, 'asia-south1'), name)(data)).data;
  };
  const say = (state, text) => { S.saveState = state; S.saveAt = text; const chip = root.querySelector('.ob-chip'); if (chip) { chip.className = 'ob-chip ' + state; chip.textContent = text; } };

  // ----- saving: debounced, with a revision check so a second tab cannot silently overwrite the first (C04) -----
  // Fields hidden by an earlier answer are not saved, so an old value cannot fail the server's check (C08).
  const clean = () => { const hidden = new Set(FIELDS.filter((f) => !visible(f, S.values)).map((f) => f.key)); return Object.fromEntries(Object.entries(S.values).filter(([k, x]) => !hidden.has(k) && String(x ?? '').trim() !== '').map(([k, x]) => [k, String(x).trim()])); };
  async function persist() {
    if (!S.draftId) return true;
    while (saving) await new Promise((resolve) => setTimeout(resolve, 80));
    saving = true; say('', 'Saving.');
    try {
      const saved = await call('saveOnboardingDraft', { draftId: S.draftId, values: clean(), step: S.step, revision: S.exists ? S.revision : 0 });
      S.exists = true; S.revision = saved.revision;
      dirty = false;
      say('ok', 'Saved ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      return true;
    } catch (error) {
      const code = String(error?.code || '');
      say('bad', code.includes('aborted') ? 'Not saved. This draft was changed in another tab or window. Reload the page.' : 'Not saved. ' + (error?.message || friendly(error)));
      return false;
    } finally {
      saving = false;
    }
  }
  const later = () => { dirty = true; clearTimeout(timer); timer = setTimeout(persist, 1200); say('', 'Unsaved changes.'); };

  // Fields with a usual value start with it filled in (a school year from April to March, working days Monday to Saturday, and so on).
  function applyDefaults() {
    let changed = false;
    for (const f of FIELDS) if (f.def !== undefined && !(f.key in S.values)) { S.values[f.key] = f.def; changed = true; }
    return changed;
  }

  // ----- starting and resuming (C05) -----
  async function landing() {
    S.draftId = ''; S.exists = false;
    root.replaceChildren(shell(h('div', {}, h('h2', {}, 'Register a school'), h('div', { class: 'empty' }, h('span', { class: 'spin' }), 'Loading drafts.'))));
    let drafts = [];
    try { drafts = (await call('listOnboardingDrafts', {})).drafts || []; } catch { drafts = []; }
    const list = h('div', { class: 'ob-list' }, drafts.length ? drafts.map((d) => h('a', { href: '#/schools/register/' + d.id },
      h('b', {}, d.values?.name || 'Untitled registration'), h('div', { class: 'muted' }, 'Step ' + ((d.step ?? 0) + 1) + ' of ' + (ACTIVE.length + 1) + ' | ' + progressOf(d.values || {}) + ' sections complete | last saved ' + (d.updatedAt ? new Date(d.updatedAt).toLocaleString('en-IN') : 'just now')))) : h('p', { class: 'muted' }, 'No unfinished registrations.'));
    let enabled = true;
    try { enabled = (await call('getOnboardingFlag', {})).enabled; } catch { /* shown as on */ }
    const flagBtn = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
      if (enabled && !confirm('Switch off new registrations? Drafts stay saved and finished schools are not affected.')) return;
      try { enabled = (await call('setOnboardingFlag', { enabled: !enabled })).enabled; flagText.textContent = flagLine(); flagBtn.textContent = enabled ? 'Switch off' : 'Switch on'; } catch (e) { toast(e?.message || friendly(e)); }
    } }, enabled ? 'Switch off' : 'Switch on');
    const flagLine = () => 'New registrations are ' + (enabled ? 'ON' : 'OFF') + '.';
    const flagText = h('span', {}, flagLine());
    root.replaceChildren(shell(h('div', {},
      h('h2', {}, 'Register a school'),
      h('p', { class: 'ob-help' }, flagText, ' ', flagBtn),
      h('p', { class: 'muted' }, 'Fill the school\'s details in sections. Your work is saved as you go, so you can leave and come back.'),
      h('p', {}, h('a', { class: 'btn gold', href: '#/schools/register/new', style: 'text-decoration:none;display:inline-block' }, 'Start a new registration')),
      h('h3', { style: 'margin-top:22px' }, 'Unfinished registrations'), list), true));
  }
  async function open(id) {
    S.draftId = id; S.exists = false;
    root.replaceChildren(shell(h('div', { class: 'empty' }, h('span', { class: 'spin' }), 'Loading the draft.'), true));
    let found;
    try { found = await call('getOnboardingDraft', { draftId: id }); } catch (error) { toast(error?.message || friendly(error)); return landing(); }
    if (found.exists) {
      const d = found.draft;
      if (d.status !== 'draft') { toast('That registration is already finished.'); location.hash = '#/schools'; return undefined; }
      S.exists = true; S.revision = d.revision; S.step = Math.min(d.step ?? 0, ACTIVE.length); S.values = { ...d.values }; S.schoolId = d.schoolId || '';
      S.files = d.files || {}; S.subHeld = d.subdomain || ''; S.domainStatus = d.domainStatus || '';
      if (applyDefaults()) later();
    }
    return draw();
  }

  // ----- layout -----
  function shell(content, plain) {
    const top = h('div', { class: 'ob-top' }, h('div', { class: 'brand' }, h('b', {}, 'A')), h('h1', {}, 'Register a school'),
      h('span', { class: 'ob-chip' }, ''), h('a', { class: 'btn', href: '#/schools', onclick: () => { unmountOnboarding(); } }, 'Close'));
    return h('div', { style: 'display:contents' }, top, h('div', { class: 'ob-body' }, h('div', plain ? { style: 'max-width:760px;margin:0 auto;padding:26px 22px' } : { class: 'ob-wrap' }, content)));
  }
  const stepName = (i) => (i < ACTIVE.length ? CATEGORIES[i].title : 'Review and register');

  function nav() {
    const items = CATEGORIES.map((c, i) => {
      const active = ACTIVE.includes(c.id);
      const b = h('button', { type: 'button', disabled: !active, class: active && S.step === i ? 'on' : '', 'aria-current': active && S.step === i ? 'step' : undefined,
        onclick: () => go(i) }, h('b', { class: active && stepDone(c.id, S.values) ? 'done' : '' }, active && stepDone(c.id, S.values) ? '✓' : c.id),
      h('span', {}, c.title, c.later ? h('small', {}, 'Arrives in ' + c.later) : null));
      return b;
    });
    items.splice(ACTIVE.length, 0, h('button', { type: 'button', class: S.step === ACTIVE.length ? 'on' : '', onclick: () => go(ACTIVE.length) }, h('b', {}, '→'), h('span', {}, 'Review and register')));
    return h('nav', { class: 'ob-nav', 'aria-label': 'Registration steps' }, items);
  }
  function picker() {
    const sel = h('select', { 'aria-label': 'Jump to a step', onchange: () => go(Number(sel.value)) },
      [...ACTIVE.map((c, i) => h('option', { value: i }, c + ' - ' + CATEGORIES[i].title)), h('option', { value: ACTIVE.length }, 'Review and register')]);
    sel.value = String(S.step);
    return h('div', { class: 'ob-pick' }, h('label', { class: 'ob-pickl' }, 'Step', sel));
  }

  // Checkbox groups (multi), the sections editor and the subjects picker. The value is kept as text in S.values.
  function groupInput(field) {
    const id = 'ob-' + field.key;
    const err = h('p', { class: 'ob-err', id: id + '-err' });
    const type = typeOf(field, S.values);
    const finish = () => { const p = fieldProblem(field, S.values); err.textContent = p; };
    let body;
    if (type === 'multi') {
      const list = field.optionsFn ? field.optionsFn(S.values) : field.options;
      const chosen = new Set(splitList(S.values[field.key]));
      const boxes = list.map(([value, text]) => { const box = h('input', { type: 'checkbox', value }); box.checked = chosen.has(value); return box; });
      const refresh = () => { S.values[field.key] = boxes.filter((b) => b.checked).map((b) => b.value).join(','); finish(); later(); if (field.redraw) draw(); };
      boxes.forEach((box) => box.addEventListener('change', refresh));
      body = h('div', { class: 'ob-checks' }, list.map(([value, text], i) => h('label', {}, boxes[i], ' ' + text)));
    } else if (type === 'sections') {
      const map = parseSections(S.values[field.key]);
      const offered = splitList(S.values.classesOffered);
      const rows = rangeOf(S.values).filter((c) => !offered.length || offered.includes(c));
      const inputs = rows.map((name) => { const el = h('input', { placeholder: 'A, B', 'aria-label': 'Sections of ' + name, autocomplete: 'off' }); el.value = (map[name] || []).join(', '); return [name, el]; });
      const refresh = () => { S.values[field.key] = inputs.filter(([, el]) => el.value.trim()).map(([name, el]) => name + '=' + splitList(el.value).join(',')).join('|'); finish(); later(); };
      inputs.forEach(([, el]) => el.addEventListener('input', refresh));
      body = h('div', { class: 'ob-sections' }, inputs.map(([name, el]) => h('label', {}, h('span', {}, name), el)));
    } else {
      const have = splitList(S.values[field.key]);
      const boxes = COMMON_SUBJECTS.map((name) => { const box = h('input', { type: 'checkbox', value: name }); box.checked = have.includes(name); return box; });
      const other = h('input', { id, placeholder: 'Other subjects, separated by commas', autocomplete: 'off', 'aria-label': 'Other subjects' });
      other.value = have.filter((n) => !COMMON_SUBJECTS.includes(n)).join(', ');
      const refresh = () => { S.values[field.key] = [...boxes.filter((b) => b.checked).map((b) => b.value), ...splitList(other.value)].join(','); finish(); later(); };
      boxes.forEach((box) => box.addEventListener('change', refresh));
      other.addEventListener('input', refresh);
      body = h('div', {}, h('div', { class: 'ob-checks' }, COMMON_SUBJECTS.map((name, i) => h('label', {}, boxes[i], ' ' + name))), h('div', { style: 'margin-top:8px' }, other));
    }
    return h('fieldset', { class: field.wide ? 'wide ob-fs' : 'ob-fs', 'aria-describedby': id + '-err' },
      h('legend', {}, field.label, required(field, S.values) ? h('span', { class: 'ob-req' }, ' *') : null, h('span', { class: 'ob-id' }, field.id)),
      body, field.help ? h('p', { class: 'ob-help' }, field.help) : null, err);
  }

  // ----- Mark 3: files, theme preview, subdomain and domain status -----
  const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const readBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('The file could not be read.')); r.readAsDataURL(file); });
  const isDocSlot = (slot) => DOCUMENT_SLOTS.includes(slot);
  async function ensureDraft() {
    if (!S.draftId) { S.draftId = newDraftId(); history.replaceState(null, '', '#/schools/register/' + S.draftId); }
    clearTimeout(timer);
    return persist();
  }
  // One file box. The file is checked here for size and type, and again on the server, which also reads the file's contents.
  function slotBox(slot, label) {
    const info = S.files[slot];
    const status = h('span', { class: 'ob-help', id: 'ob-' + slot + '-err', role: 'status' }, info ? info.name + ' (' + sizeText(info.size) + ')' : 'No file chosen.');
    const input = h('input', { type: 'file', id: 'ob-' + slot, accept: isDocSlot(slot) ? 'image/png,image/jpeg,image/webp,application/pdf' : 'image/png,image/jpeg,image/webp', 'aria-label': label });
    const thumb = h('img', { class: 'ob-thumb', alt: '', hidden: !S.thumbs[slot] });
    if (S.thumbs[slot]) thumb.src = S.thumbs[slot];
    else if (info && !isDocSlot(slot) && !['ownerPhoto', 'principalPhoto'].includes(slot)) {
      call('previewOnboardingFile', { draftId: S.draftId, slot }).then((r) => { if (r.found) { S.thumbs[slot] = r.url; thumb.src = r.url; thumb.hidden = false; } }).catch(() => {});
    }
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > UPLOAD_LIMITS[slot]) { status.textContent = 'That file is larger than ' + sizeText(UPLOAD_LIMITS[slot]) + '.'; input.value = ''; return; }
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) && !(isDocSlot(slot) && file.type === 'application/pdf')) { status.textContent = isDocSlot(slot) ? 'Use a PDF, JPG, PNG or WEBP file.' : 'Use a PNG, JPG or WEBP image (SVG is not accepted).'; input.value = ''; return; }
      status.textContent = 'Uploading.';
      try {
        if (!(await ensureDraft())) { status.textContent = 'Save the draft first (see the message at the top).'; return; }
        const data = await readBase64(file);
        const r = await call('uploadOnboardingFile', { draftId: S.draftId, slot, name: file.name, data });
        S.files[slot] = { name: r.name, size: r.size, type: r.type };
        if (r.type.startsWith('image/') && !isDocSlot(slot)) S.thumbs[slot] = 'data:' + r.type + ';base64,' + data; else delete S.thumbs[slot];
        draw();
      } catch (error) { status.textContent = error?.message || friendly(error); input.value = ''; }
    });
    const remove = info ? h('button', { type: 'button', class: 'btn sm', onclick: async () => {
      try { await call('removeOnboardingFile', { draftId: S.draftId, slot }); delete S.files[slot]; delete S.thumbs[slot]; draw(); } catch (error) { status.textContent = error?.message || friendly(error); }
    } }, 'Remove') : null;
    return h('div', { class: 'ob-file' }, thumb, h('div', {}, h('div', {}, input), status, remove));
  }
  function uploadInput(field) {
    const body = field.type === 'gallery' ? h('div', { class: 'ob-gallery' }, [1, 2, 3, 4, 5, 6].map((n) => slotBox('gallery' + n, 'Gallery image ' + n))) : slotBox(field.key, field.label);
    return h('div', { class: field.wide ? 'wide' : '' }, h('label', {}, field.label, h('span', { class: 'ob-id' }, field.id)), body, field.help ? h('p', { class: 'ob-help' }, field.help) : null);
  }
  function toggleInput(field) {
    const box = h('input', { type: 'checkbox', id: 'ob-' + field.key });
    box.checked = S.values[field.key] === 'yes';
    box.addEventListener('change', () => { if (box.checked) S.values[field.key] = 'yes'; else delete S.values[field.key]; later(); });
    return h('div', {}, h('label', { class: 'ob-toggle', for: 'ob-' + field.key }, box, ' ' + field.label, h('span', { class: 'ob-id' }, field.id)));
  }
  function colourInput(field) {
    const id = 'ob-' + field.key;
    const text = h('input', { id, placeholder: '#14243D', maxlength: '7', autocomplete: 'off' }); text.value = S.values[field.key] || '';
    const pick = h('input', { type: 'color', 'aria-label': field.label + ' picker', value: HEX.test(text.value) ? text.value : '#14243d' });
    const err = h('p', { class: 'ob-err', id: id + '-err' });
    const sync = () => { S.values[field.key] = text.value.trim(); err.textContent = fieldProblem(field, S.values); if (HEX.test(text.value)) pick.value = text.value; later(); refreshPreview(); };
    text.addEventListener('input', sync);
    pick.addEventListener('input', () => { text.value = pick.value.toUpperCase(); sync(); });
    return h('div', {}, h('label', { for: id }, field.label, h('span', { class: 'ob-id' }, field.id)), h('div', { class: 'row' }, text, pick), field.help ? h('p', { class: 'ob-help' }, field.help) : null, err);
  }
  // Holds the subdomain for this draft. Two drafts can never hold the same name (the server does it in one transaction).
  async function holdSubdomain(value, status) {
    const x = String(value || '').trim().toLowerCase();
    if (!x) { if (S.subHeld) { try { await call('reserveSubdomain', { draftId: S.draftId, subdomain: '' }); } catch { /* released later */ } S.subHeld = ''; } if (status) status.textContent = ''; return true; }
    if (x === S.subHeld) return true;
    if (status) status.textContent = 'Checking.';
    try {
      if (!(await ensureDraft())) return false;
      const r = await call('reserveSubdomain', { draftId: S.draftId, subdomain: x });
      S.subHeld = r.subdomain; if (status) status.textContent = '';
      return true;
    } catch (error) { if (status) status.textContent = error?.message || friendly(error); S.subHeld = ''; return false; }
  }
  function subdomainInput(field) {
    const id = 'ob-' + field.key;
    const el = h('input', { id, placeholder: S.schoolId || 'your-school', autocomplete: 'off', maxlength: '30' }); el.value = S.values[field.key] || '';
    const err = h('p', { class: 'ob-err', id: id + '-err' });
    const held = h('p', { class: 'ob-help', role: 'status' });
    const showHeld = () => { held.textContent = S.values[field.key] && S.values[field.key] === S.subHeld ? 'Held for this registration. It is not live: the address is switched on only after setup is complete.' : S.values[field.key] ? 'Not held yet. Press Check, or it is checked when you continue.' : 'Optional. Leave empty to decide later.'; };
    showHeld();
    el.addEventListener('input', () => { S.values[field.key] = el.value.trim().toLowerCase(); err.textContent = ''; later(); showHeld(); });
    const check = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
      el.value = el.value.trim().toLowerCase(); S.values[field.key] = el.value;
      const p = el.value ? fieldProblem(field, S.values) : '';
      if (p) { err.textContent = p; return; }
      await holdSubdomain(el.value, err); showHeld();
    } }, 'Check and hold');
    return h('div', { class: 'wide' }, h('label', { for: id }, field.label, h('span', { class: 'ob-id' }, field.id)), h('div', { class: 'row' }, el, check), held, err);
  }
  // Preview of the chosen branding. It only changes this panel; nothing is written to any website (C13).
  let previewBox = null;
  function refreshPreview() {
    if (!previewBox) return;
    const v = S.values;
    const pal = THEME_PALETTES[v.websiteTheme] || ['#14243d', '#faf6ec', '#b8913a'];
    const main = HEX.test(v.brandPrimary || '') ? v.brandPrimary : pal[0];
    const accent = HEX.test(v.brandSecondary || '') ? v.brandSecondary : pal[2];
    const dark = DARK_THEMES.includes(v.websiteTheme);
    previewBox.style.setProperty('--pv-main', main); previewBox.style.setProperty('--pv-accent', accent);
    previewBox.style.setProperty('--pv-bg', dark ? pal[0] : pal[1]); previewBox.style.setProperty('--pv-ink', dark ? pal[1] : '#1b1b1b');
    previewBox.querySelector('.pv-name').textContent = v.name || 'Your school name';
    previewBox.querySelector('.pv-msg').textContent = (v.mission || v.principalMessage || 'Your mission or principal\'s message appears here.').slice(0, 160);
    const logo = previewBox.querySelector('.pv-logo'); logo.hidden = !S.thumbs.logo; if (S.thumbs.logo) logo.src = S.thumbs.logo;
    const hero = previewBox.querySelector('.pv-hero'); hero.style.backgroundImage = S.thumbs.heroImage ? 'url("' + S.thumbs.heroImage + '")' : '';
  }
  function themePreview() {
    previewBox = h('div', { class: 'ob-preview', 'aria-label': 'Branding preview' },
      h('div', { class: 'pv-bar' }, h('img', { class: 'pv-logo', alt: '', hidden: true }), h('b', { class: 'pv-name' }, '')),
      h('div', { class: 'pv-hero' }, h('p', { class: 'pv-msg' }, '')), h('span', { class: 'pv-btn' }, 'Admission open'),
      h('small', {}, 'Preview only. Nothing is published to a website.'));
    setTimeout(refreshPreview, 0);
    return previewBox;
  }
  // DNS ownership check for a custom domain: pending until the TXT record is really found. HTTPS and publishing are not claimed here.
  function domainPanel() {
    if (S.values.domainPreference === 'AZIZ subdomain only' || !S.values.customDomain || fieldProblem(FIELDS.find((f) => f.key === 'customDomain'), S.values)) return null;
    const out = h('div', { role: 'status' });
    const paint = (info) => {
      const state = info?.status || S.domainStatus || 'pending';
      out.replaceChildren(h('p', {}, h('b', {}, 'Status: '), state === 'verified' ? 'Ownership verified (not live yet)' : 'Pending: DNS record not found yet', ' | HTTPS: not checked'),
        info ? h('p', { class: 'ob-help' }, info.message) : h('p', { class: 'ob-help' }, 'Press Check to get the DNS record to add.'),
        info?.record ? h('p', { class: 'ob-help' }, 'Add a TXT record. Name: ', h('code', {}, info.record), ' Value: ', h('code', {}, info.value)) : null);
    };
    paint(S.domainInfo);
    const btn = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
      btn.disabled = true; out.textContent = 'Checking DNS.';
      try {
        if (!(await ensureDraft())) throw new Error('Save the draft first.');
        S.domainInfo = await call('checkCustomDomain', { draftId: S.draftId }); S.domainStatus = S.domainInfo.status; paint(S.domainInfo);
      } catch (error) { out.textContent = error?.message || friendly(error); } finally { btn.disabled = false; }
    } }, 'Check DNS record');
    return h('div', { class: 'card', style: 'margin:12px 0' }, h('h3', { style: 'margin-top:0' }, 'Custom domain status'), out, btn);
  }

  // ----- Mark 4: server-worked prices, calculated rows and consent state -----
  const rupees = (minor) => 'Rs ' + (Number(minor || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  function calcText(key) {
    const q = S.quote;
    if (key === 'ownerLoginEmail') return S.values.ownerEmail || '(enter the owner email in step D)';
    if (key === 'activationStatus') return 'Pending activation (needs the owner\'s consent and a Verified school)';
    if (key === 'termsAccepted' || key === 'privacyAccepted') return 'Pending: the owner accepts after signing in';
    if (!q) return S.quoteNote || 'Choose a plan to see this.';
    if (key === 'setupFee') return rupees(q.setupMinor);
    if (key === 'subscriptionPrice') return rupees(q.recurringMinor) + ' per ' + (q.cycle === 'Yearly' ? 'year' : 'month') + (q.discountMinor ? ' after ' + q.discountPercent + '% off (list ' + rupees(q.listMinor) + ')' : '') + (q.trial ? '. Nothing is due for the first ' + q.trialDays + ' days.' : '. Due now: ' + rupees(q.dueNowMinor) + ' including the setup fee.');
    if (key === 'maxStudents') return q.studentLimit + ' students, ' + q.staffLimit + ' staff' + (q.trial ? ' (a trial starts with 50 students and 10 staff)' : '');
    if (key === 'storageAllocated') return q.storageMb >= 1024 ? (q.storageMb / 1024).toFixed(1).replace(/\.0$/, '') + ' GB' : q.storageMb + ' MB';
    if (key === 'entitlements') return q.features.length ? q.features.join(', ') : 'No features are listed for this plan.';
    return '';
  }
  function paintQuote() {
    const select = root.querySelector('#ob-planId');
    if (select) { select.replaceChildren(h('option', { value: '' }, 'Select a plan'), ...S.plans.map((p) => h('option', { value: p.id }, p.name + ' (' + rupees(p.monthlyPrice * 100) + ' per month)'))); select.value = S.values.planId || ''; }
    for (const el of root.querySelectorAll('[data-calc]')) el.value = calcText(el.dataset.calc);
  }
  function refreshQuote() {
    clearTimeout(S.quoteTimer);
    S.quoteTimer = setTimeout(async () => {
      try {
        const r = await call('quoteSubscription', { planId: S.values.planId || '', billingCycle: S.values.billingCycle || 'Monthly', discountPercent: S.values.discountPercent || '0', trialEnabled: S.values.trialEnabled || 'Yes', trialDays: S.values.trialDays || '30' });
        const first = !S.quote; S.plans = r.plans; S.quote = r.quote; S.quoteNote = '';
        if (first && r.quote && S.step >= ACTIVE.length) { draw(); return; }
      } catch (error) { S.quote = null; S.quoteNote = error?.message || 'The price could not be worked out.'; }
      paintQuote();
    }, 200);
  }
  function calcInput(field) {
    const el = h('input', { id: 'ob-' + field.key, readonly: true, 'aria-readonly': 'true', 'data-calc': field.key }); el.value = calcText(field.key);
    return h('div', { class: field.wide ? 'wide' : '' }, h('label', { for: 'ob-' + field.key }, field.label, h('span', { class: 'ob-id' }, field.id)), el, field.help ? h('p', { class: 'ob-help' }, field.help) : null);
  }
  function planInput(field) {
    const id = 'ob-' + field.key;
    const select = h('select', { id, 'aria-describedby': id + '-err' }, h('option', { value: '' }, 'Loading plans.'));
    const err = h('p', { class: 'ob-err', id: id + '-err' });
    select.addEventListener('change', () => { S.values[field.key] = select.value; err.textContent = fieldProblem(field, S.values); later(); refreshQuote(); });
    setTimeout(refreshQuote, 0);
    return h('div', {}, h('label', { for: id }, field.label, h('span', { class: 'ob-req' }, ' *'), h('span', { class: 'ob-id' }, field.id)), select, field.help ? h('p', { class: 'ob-help' }, field.help) : null, err);
  }

  function input(field) {
    const type = typeOf(field, S.values);
    if (['multi', 'sections', 'subjects'].includes(type)) return groupInput(field);
    if (type === 'upload' || type === 'gallery') return uploadInput(field);
    if (type === 'toggle') return toggleInput(field);
    if (type === 'colour') return colourInput(field);
    if (type === 'subdomain') return subdomainInput(field);
    if (type === 'plan') return planInput(field);
    if (type === 'calc' || type === 'consent') return calcInput(field);
    const id = 'ob-' + field.key;
    const value = S.values[field.key] ?? '';
    let el;
    if (type === 'select') {
      el = h('select', { id }, [h('option', { value: '' }, 'Select'), ...field.options.map(([v, t]) => h('option', { value: v }, t))]);
      el.value = value;
    } else if (type === 'textarea') { el = h('textarea', { id, rows: 3 }); el.value = value; } else {
      el = h('input', { id, type: type === 'phone' ? 'tel' : type === 'time' ? 'time' : ['number', 'int', 'money'].includes(type) ? 'text' : type, ...(['number', 'int', 'money'].includes(type) ? { inputmode: type === 'money' ? 'decimal' : 'numeric' } : {}), autocomplete: 'off' });
      el.value = value;
    }
    const err = h('p', { class: 'ob-err', id: id + '-err' });
    el.setAttribute('aria-describedby', id + '-err');
    const sync = (final) => {
      let x = el.value;
      if (type === 'email') x = x.toLowerCase();
      S.values[field.key] = x;
      refreshPreview();
      if (field.cat === 'M') refreshQuote();
      if (field.redraw || ['country', 'board', 'schoolType'].includes(field.key)) { draw(); later(); return; }
      if (final) { el.value = x.trim(); S.values[field.key] = x.trim(); const p = fieldProblem(field, S.values); err.textContent = p; el.setAttribute('aria-invalid', p ? 'true' : 'false'); }
      later();
    };
    el.addEventListener('input', () => sync(false));
    el.addEventListener('change', () => sync(true));
    el.addEventListener('blur', () => sync(true));
    return h('div', { class: field.wide ? 'wide' : '' }, h('label', { for: id }, field.label, required(field, S.values) ? h('span', { class: 'ob-req' }, ' *') : null, h('span', { class: 'ob-id' }, field.id)),
      el, field.help ? h('p', { class: 'ob-help' }, field.help) : null, err);
  }

  function idBlock() {
    const have = S.schoolId;
    const wanted = h('input', { id: 'ob-wanted', placeholder: 'Optional: type the ID you want', autocomplete: 'off' });
    const status = h('p', { class: 'ob-help', id: 'ob-id-status' }, have ? 'Held for this registration. It cannot change once the school is registered.' : 'It is created from the school name and held when you leave this step.');
    const hold = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
      const w = wanted.value.trim().toLowerCase();
      if (!w) { status.textContent = 'Type the ID you want first.'; return; }
      if (!(await persist())) return;
      status.textContent = 'Checking.';
      try { const r = await call('reserveSchoolId', { draftId: S.draftId, name: S.values.name || '', wanted: w }); S.schoolId = r.schoolId; draw(); } catch (e) { status.textContent = e?.message || 'Could not hold that ID.'; }
    } }, 'Use this ID');
    return h('div', { class: 'wide' }, h('label', {}, 'School ID', h('span', { class: 'ob-id' }, 'F003')),
      h('input', { value: have || '(not held yet)', readonly: true, 'aria-readonly': 'true' }), status,
      have ? null : h('div', { class: 'row', style: 'margin-top:6px' }, wanted, hold));
  }

  // ----- steps -----
  function dupePanel() {
    if (!S.dupes.length) return null;
    return h('div', { class: 'ob-warn', role: 'status' }, h('b', {}, 'This may already be registered. '), 'You can still continue; this is only a warning.',
      h('ul', {}, S.dupes.map((d) => h('li', {}, h('a', { href: '#/school/' + d.id, target: '_blank', rel: 'noopener' }, d.name + ' (' + d.id + ')'), ' - ' + d.reason))));
  }
  function stepBody() {
    if (S.step >= ACTIVE.length) return review();
    const cat = ACTIVE[S.step];
    const fields = FIELDS.filter((f) => f.cat === cat && visible(f, S.values));
    return h('form', { id: 'ob-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } },
      h('h2', {}, CATEGORIES[S.step].id + '. ' + CATEGORIES[S.step].title),
      dupePanel(),
      h('div', { class: 'ob-grid' }, (cat === 'A' ? [...fields.slice(0, 1).map(input), idBlock(), ...fields.slice(1).map(input)] : fields.map(input))),
      cat === 'J' ? themePreview() : null,
      cat === 'K' ? domainPanel() : null,
      h('button', { type: 'submit', hidden: true }));
  }

  function shownValue(f) {
    if (f.type === 'upload') return S.files[f.key] ? S.files[f.key].name : '';
    if (f.type === 'gallery') { const n = [1, 2, 3, 4, 5, 6].filter((i) => S.files['gallery' + i]).length; return n ? n + ' image(s)' : ''; }
    if (f.type === 'toggle') return S.values[f.key] === 'yes' ? 'Yes' : '';
    if (f.type === 'plan') return S.quote && S.quote.planId === S.values.planId ? S.quote.planName : S.values.planId;
    if (['calc', 'consent'].includes(f.type)) return calcText(f.key);
    return S.values[f.key];
  }
  function review() {
    const missing = ACTIVE.flatMap((cat) => stepProblems(cat, S.values).map((p) => ({ cat, ...p })).concat(
      FIELDS.filter((f) => f.cat === cat && required(f, S.values) && !String(S.values[f.key] ?? '').trim() && !fieldProblem(f, S.values)).map((f) => ({ cat, field: f, message: f.label + ' is required.' }))));
    if (!S.quote && S.values.planId) refreshQuote();
    const reason = h('textarea', { id: 'ob-reason', rows: 3, placeholder: 'Why are you registering this school? At least 10 characters.', oninput: () => { S.reason = reason.value; } });
    reason.value = S.reason;
    const go1 = h('button', { type: 'button', class: 'btn gold', disabled: S.busy || missing.length > 0, onclick: () => submit(go1) }, S.busy ? 'Registering.' : 'Register school');
    return h('div', {},
      h('h2', {}, 'Review and register'),
      missing.length ? h('div', { class: 'ob-sum', role: 'alert' }, h('b', {}, missing.length + ' thing(s) to fix before registering'),
        h('ul', {}, missing.map((m) => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(ACTIVE.indexOf(m.cat)); } }, m.message))))) : h('p', { class: 'ob-help' }, 'Everything required is filled in.'),
      dupePanel(),
      ACTIVE.map((cat, i) => h('div', { class: 'card', style: 'margin:12px 0' }, h('div', { class: 'row' }, h('h3', { style: 'flex:1;margin:0' }, cat + '. ' + CATEGORIES[i].title), h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(i); } }, 'Edit')),
        h('table', { class: 'ob-rev' }, h('tbody', {}, FIELDS.filter((f) => f.cat === cat && visible(f, S.values)).map((f) => h('tr', {}, h('td', {}, f.label), h('td', {}, shownValue(f) || h('span', { class: 'muted' }, '-')))))))),
      h('div', { class: 'card', style: 'margin:12px 0' }, h('h3', {}, 'Plan and reason'),
        h('div', { class: 'ob-help' }, h('b', {}, 'Plan: '), S.quote ? S.quote.planName + ' | ' + calcText('subscriptionPrice') : (S.values.planId ? 'Working out the price.' : 'No plan chosen.')),
        h('div', { class: 'ob-help' }, h('b', {}, 'Owner consent: '), 'Pending. The owner accepts the terms and privacy agreement after signing in. ', h('b', {}, 'Activation: '), 'Pending activation. It needs the owner\'s consent and a Verified school.'),
        h('label', { for: 'ob-reason' }, 'Reason (kept in the audit log)'), reason),
      h('div', { class: 'card' }, h('p', {}, 'Registering creates the school, its billing record and a pending owner invitation for ', h('b', {}, S.values.ownerEmail || 'the owner email'), '. The owner signs in at /app with that email, verifies it and accepts the invitation.'), go1));
  }

  // ----- actions -----
  function showProblems(cat) {
    const problems = stepProblems(cat, S.values).concat(FIELDS.filter((f) => f.cat === cat && required(f, S.values) && !String(S.values[f.key] ?? '').trim() && !fieldProblem(f, S.values)).map((f) => ({ field: f, message: f.label + ' is required.' })));
    const form = root.querySelector('#ob-form');
    form?.querySelector('.ob-sum')?.remove();
    for (const p of problems) { const e = root.querySelector('#ob-' + p.field.key + '-err'); const i = root.querySelector('#ob-' + p.field.key); if (e) e.textContent = p.message; if (i) i.setAttribute('aria-invalid', 'true'); }
    if (problems.length && form) {
      const sum = h('div', { class: 'ob-sum', role: 'alert', tabindex: '-1' }, h('b', {}, 'Please fix ' + problems.length + ' field(s):'),
        h('ul', {}, problems.map((p) => h('li', {}, h('a', { href: '#ob-' + p.field.key, onclick: (e) => { e.preventDefault(); root.querySelector('#ob-' + p.field.key)?.focus(); } }, p.message)))));
      form.querySelector('h2').after(sum); sum.focus();
    }
    return problems.length === 0;
  }
  async function checkDupes() {
    if (!S.values.name) return;
    try { S.dupes = (await call('checkSchoolDuplicates', { name: S.values.name, town: S.values.town || '', udise: S.values.udise || '', affiliation: S.values.affiliationNo || '' })).matches || []; } catch { /* a warning only */ }
  }
  async function next() {
    if (S.step < ACTIVE.length && !showProblems(ACTIVE[S.step])) return;
    clearTimeout(timer);
    if (!S.draftId) { S.draftId = newDraftId(); history.replaceState(null, '', '#/schools/register/' + S.draftId); }
    if (!(await persist())) return;
    if (S.step === 0 && !S.schoolId && S.values.name) {
      try { S.schoolId = (await call('reserveSchoolId', { draftId: S.draftId, name: S.values.name })).schoolId; } catch (e) { toast(e?.message || 'Could not hold a school ID.'); return; }
    }
    if (ACTIVE[S.step] === 'K' && S.values.preferredSubdomain && !(await holdSubdomain(S.values.preferredSubdomain, root.querySelector('#ob-preferredSubdomain-err')))) return;
    if (S.step <= 2) await checkDupes();
    S.step = Math.min(S.step + 1, ACTIVE.length); await persist(); draw(); scrollTop();
  }
  async function go(i) {
    if (i === S.step) return;
    if (S.draftId) { clearTimeout(timer); if (dirty) await persist(); }
    S.step = i; if (S.draftId && S.exists) persist(); draw(); scrollTop();
  }
  function back() { if (S.step > 0) go(S.step - 1); }
  const scrollTop = () => root.querySelector('.ob-body')?.scrollTo(0, 0);

  async function submit(button) {
    if (S.reason.trim().length < 10) { toast('Give a reason of at least 10 characters.'); root.querySelector('#ob-reason')?.focus(); return; }
    S.busy = true; button.disabled = true; button.textContent = 'Registering.';
    clearTimeout(timer);
    try {
      if (dirty && !(await persist())) throw new Error('The draft could not be saved first.');
      const result = await call('registerSchool', { draftId: S.draftId, reason: S.reason.trim() });
      toast('School registered' + (result.job === 'needs-retry' ? ', but some setup needs a retry (open the school and press Retry setup)' : '') + '. ' + (result.welcomeEmail === 'sent' ? 'The welcome email was sent. ' : result.welcomeEmail === 'not-requested' ? '' : 'The welcome email was not sent (' + result.welcomeEmail + '). ') + 'The owner signs in at /app with ' + (result.ownerEmail || S.values.ownerEmail) + ' and accepts the invitation.');
      unmountOnboarding();
      ctx.goSchool(result.schoolId);
    } catch (error) {
      S.busy = false; toast(error?.message || friendly(error)); draw();
    }
  }
  async function discard() {
    if (!S.exists) { unmountOnboarding(); location.hash = '#/schools'; return; }
    if (!confirm('Delete this unfinished registration? This cannot be undone.')) return;
    try { await call('deleteOnboardingDraft', { draftId: S.draftId }); } catch (e) { toast(e?.message || friendly(e)); return; }
    unmountOnboarding(); location.hash = '#/schools';
  }

  function draw() {
    previewBox = null;
    const width = Math.round((progressOf(S.values) / ACTIVE.length) * 100);
    const main = h('div', {},
      h('p', { class: 'muted', style: 'margin:0' }, 'Step ' + (S.step + 1) + ' of ' + (ACTIVE.length + 1) + ': ' + stepName(S.step) + ' | ' + progressOf(S.values) + ' of ' + ACTIVE.length + ' sections complete'),
      h('div', { class: 'ob-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(ACTIVE.length), 'aria-valuenow': String(progressOf(S.values)) }, h('i', { style: 'width:' + width + '%' })),
      picker(), stepBody());
    const content = h('div', { style: 'display:contents' }, nav(), main);
    const chipClass = S.saveState, chipText = S.saveAt;
    root.replaceChildren(shell(content));
    const chip = root.querySelector('.ob-chip'); chip.className = 'ob-chip ' + chipClass; chip.textContent = chipText;
    root.append(h('div', { class: 'ob-foot' },
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', disabled: S.step === 0, onclick: back }, 'Back'), S.draftId ? h('button', { type: 'button', class: 'btn red', onclick: discard }, 'Discard draft') : null),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: async () => { if (!S.draftId) { S.draftId = newDraftId(); history.replaceState(null, '', '#/schools/register/' + S.draftId); } clearTimeout(timer); await persist(); } }, 'Save draft'),
        S.step < ACTIVE.length ? h('button', { type: 'button', class: 'btn gold', onclick: next }, S.step === ACTIVE.length - 1 ? 'Save and review' : 'Save and continue') : null)));
  }

  root._cleanup = () => { clearTimeout(timer); if (dirty) persist(); removeEventListener('beforeunload', warn); };
  const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  addEventListener('beforeunload', warn);

  if (draftIdFromRoute === 'new') { S.draftId = ''; applyDefaults(); draw(); } else if (draftIdFromRoute) await open(draftIdFromRoute); else await landing();
}

export function unmountOnboarding() {
  const root = document.getElementById('onb');
  if (root) { root._cleanup?.(); root.remove(); document.body.style.overflow = ''; }
}
