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
  { id: 'J', title: 'Website and branding', later: 'Mark 3' }, { id: 'K', title: 'Domain configuration', later: 'Mark 3' },
  { id: 'L', title: 'Facilities', later: 'Mark 3' }, { id: 'M', title: 'Subscription and commercial', later: 'Mark 4' },
  { id: 'N', title: 'Login and security', later: 'Mark 4' }, { id: 'O', title: 'Verification and activation', later: 'Mark 4' },
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
];
const UPLOAD_NOTES = { B: 'Recognition and affiliation certificates (F017, F018)', D: 'Owner photograph and authorization document (F035, F036)', E: 'Principal photograph (F040)' };
const ACTIVE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

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

  const S = { draftId: draftIdFromRoute || '', exists: false, revision: 0, step: 0, values: {}, schoolId: '', dupes: [], saveState: '', saveAt: '', busy: false, plan: 'trial', reason: '', registered: null };
  let timer = 0; let saving = false; let dirty = false;

  const call = async (name, data) => {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    return (await httpsCallable(getFunctions(app, 'asia-south1'), name)(data)).data;
  };
  const say = (state, text) => { S.saveState = state; S.saveAt = text; const chip = root.querySelector('.ob-chip'); if (chip) { chip.className = 'ob-chip ' + state; chip.textContent = text; } };

  // ----- saving: debounced, with a revision check so a second tab cannot silently overwrite the first (C04) -----
  const clean = () => Object.fromEntries(Object.entries(S.values).filter(([, x]) => String(x ?? '').trim() !== '').map(([k, x]) => [k, String(x).trim()]));
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
    root.replaceChildren(shell(h('div', {},
      h('h2', {}, 'Register a school'),
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

  function input(field) {
    const type = typeOf(field, S.values);
    if (['multi', 'sections', 'subjects'].includes(type)) return groupInput(field);
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
      h('div', { class: 'ob-grid' }, cat === 'A' ? [fields.slice(0, 1).map(input), idBlock(), fields.slice(1).map(input)] : fields.map(input)),
      UPLOAD_NOTES[cat] ? h('p', { class: 'ob-help', style: 'margin-top:14px' }, UPLOAD_NOTES[cat] + ' arrive in Mark 3, together with secure file storage.') : null,
      h('button', { type: 'submit', hidden: true }));
  }

  function review() {
    const missing = ACTIVE.flatMap((cat) => stepProblems(cat, S.values).map((p) => ({ cat, ...p })).concat(
      FIELDS.filter((f) => f.cat === cat && required(f, S.values) && !String(S.values[f.key] ?? '').trim() && !fieldProblem(f, S.values)).map((f) => ({ cat, field: f, message: f.label + ' is required.' }))));
    const planBox = h('select', { id: 'ob-plan', onchange: () => { S.plan = planBox.value; } });
    ctx.plans().then((list) => { planBox.replaceChildren(...list.map(([v, t]) => h('option', { value: v }, t))); planBox.value = S.plan; });
    const reason = h('textarea', { id: 'ob-reason', rows: 3, placeholder: 'Why are you registering this school? At least 10 characters.', oninput: () => { S.reason = reason.value; } });
    reason.value = S.reason;
    const go1 = h('button', { type: 'button', class: 'btn gold', disabled: S.busy || missing.length > 0, onclick: () => submit(go1) }, S.busy ? 'Registering.' : 'Register school');
    return h('div', {},
      h('h2', {}, 'Review and register'),
      missing.length ? h('div', { class: 'ob-sum', role: 'alert' }, h('b', {}, missing.length + ' thing(s) to fix before registering'),
        h('ul', {}, missing.map((m) => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(ACTIVE.indexOf(m.cat)); } }, m.message))))) : h('p', { class: 'ob-help' }, 'Everything required is filled in.'),
      dupePanel(),
      ACTIVE.map((cat, i) => h('div', { class: 'card', style: 'margin:12px 0' }, h('div', { class: 'row' }, h('h3', { style: 'flex:1;margin:0' }, cat + '. ' + CATEGORIES[i].title), h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(i); } }, 'Edit')),
        h('table', { class: 'ob-rev' }, h('tbody', {}, FIELDS.filter((f) => f.cat === cat && visible(f, S.values)).map((f) => h('tr', {}, h('td', {}, f.label), h('td', {}, S.values[f.key] || h('span', { class: 'muted' }, '-')))))))),
      h('div', { class: 'card', style: 'margin:12px 0' }, h('h3', {}, 'Plan and reason'),
        h('p', { class: 'ob-help' }, 'Billing and activation settings arrive in Mark 4. For now choose the plan, as before. The price and limits are taken from the plan list on the server.'),
        h('label', { for: 'ob-plan' }, 'Plan'), planBox, h('label', { for: 'ob-reason' }, 'Reason (kept in the audit log)'), reason),
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
      const result = await call('registerSchool', { draftId: S.draftId, plan: S.plan, reason: S.reason.trim() });
      toast('School registered. Tell the owner to sign in at /app with ' + (result.ownerEmail || S.values.ownerEmail) + ' and accept the invitation.');
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
