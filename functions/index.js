// AZIZ School Management System: server-side jobs (Batch 64).
// 1. nightlyBackup: every night, copies each school's records to a file in Cloud Storage, reads the file back to check it,
//    keeps the newest 14 files per school and records the result in schools/<id>/settings/autoBackup.
// 2. pushOnNotice: sends a phone notification to linked families when a school posts a notice for families, all or a class.
// 3. pushOnFeeReminder: sends a phone notification to the family of a student when the owner sends a fee reminder.
// 4. listBackups / previewRestore / restoreBackup (Batch 66): the owner looks at the nightly copies, sees what a restore would change
//    and restores chosen lists. A restore never deletes anything, and a safety copy of today's records is saved first.
// Deploy with: firebase deploy --only functions
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { getMessaging } = require('firebase-admin/messaging');

// This must be the region of your Firestore database (see the steps given with this batch). Scheduled jobs do not depend on it.
const REGION = 'asia-south1';
setGlobalOptions({ region: REGION, maxInstances: 5 });
initializeApp();
const db = getFirestore();

const BACKUP_COLLECTIONS = ["studentHistory", "storageRecords", "staffDocuments", "eBooks", "noticeAcks", "members", "students", "academicYears", "classes", "sections", "subjects", "classSubjects", "enrollments", "rollKeys", "exams", "marks", "attendance", "staffAttendance", "leaveRequests", "feeStructures", "payments", "notices", "timetable", "homework", "calendar", "books", "loans", "behaviour", "visitors", "substitutions", "routes", "transportRiders", "activities", "activityMembers", "inventory", "alumni", "expenses", "certificates", "tickets", "staffDirectory", "vendors", "minutes", "lostFound", "concessions", "achievements", "complaints", "assets", "sales", "syllabus", "trainings", "diary", "healthRecords", "lessonPlans", "ptmSlots", "payroll", "messages", "enquiries", "eventRegistrations", "familyAccess", "classTeachers", "teacherSlots", "teacherClasses", "departments", "auditLog", "scholarships", "scholarshipApps", "consentForms", "consentResponses", "staffProfiles", "hostelRooms", "hostelStays", "canteenMenu", "canteenPlans", "bookReservations", "workflowRules", "approvalRequests", "questionBank", "onlineTests", "onlineTestKeys", "onlineAttempts", "pickupPeople", "pickupLogs", "settings"];
const KEEP_BACKUPS = 14;
// Batch 83: the platform's backup policy (platformConfig/backupPolicy, set on the admin Backups page) decides how long copies are kept
// (keepDays, 7 to 3650) and how often they run (daily or weekly). With no policy: daily, kept 30 days (the same default the admin page shows).
async function readBackupPolicy() {
  try {
    const found = await db.doc('platformConfig/backupPolicy').get();
    const data = found.exists ? found.data() : {};
    const keepDays = Number.isInteger(data.keepDays) && data.keepDays >= 7 && data.keepDays <= 3650 ? data.keepDays : null;
    return { keepDays: keepDays ?? 30, weekly: data.frequency === 'weekly' };
  } catch (error) {
    logger.error('Could not read the backup policy; using the default', error);
    return { keepDays: 30, weekly: false };
  }
}

// Timestamps become { __ts: ISO text } so the file is plain JSON.
const plain = (value) => {
  if (value instanceof Timestamp) return { __ts: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  return value;
};
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

async function backUpSchool(bucket, schoolId, keepDays) {
  const data = {};
  let docs = 0;
  for (const name of BACKUP_COLLECTIONS) {
    const snap = await db.collection('schools/' + schoolId + '/' + name).get();
    data[name] = snap.docs.map((record) => ({ id: record.id, data: plain(record.data()) }));
    docs += snap.size;
  }
  const date = today();
  const path = 'backups/' + schoolId + '/' + date + '.json';
  const file = bucket.file(path);
  const body = JSON.stringify({ schoolId, date, docs, collections: data });
  await file.save(body, { contentType: 'application/json', resumable: false });
  // Check the saved copy: read it back and compare the number of records in every list.
  const [saved] = await file.download();
  const back = JSON.parse(saved.toString('utf8'));
  const sameCounts = BACKUP_COLLECTIONS.every((name) => (back.collections[name] ?? []).length === data[name].length);
  if (!sameCounts) throw new Error('The saved copy does not match the records.');
  // Keep only the newest files.
  const [files] = await bucket.getFiles({ prefix: 'backups/' + schoolId + '/' });
  const names = files.map((item) => item.name).sort().reverse();
  // With a policy: remove copies older than keepDays, but never the newest 3. (KEEP_BACKUPS is only a fallback.)
  const cutoff = keepDays ? new Date(Date.now() + 330 * 60000 - keepDays * 86400000).toISOString().slice(0, 10) : null;
  const old = cutoff ? names.slice(3).filter((name) => name.split('/').pop().replace('.json', '') < cutoff) : names.slice(KEEP_BACKUPS);
  await Promise.all(old.map((name) => bucket.file(name).delete().catch(() => {})));
  await db.doc('schools/' + schoolId + '/settings/autoBackup').set({ date, docs, bytes: Buffer.byteLength(body), ok: true, path, verified: true });
  return docs;
}

exports.nightlyBackup = onSchedule({ schedule: '30 2 * * *', timeZone: 'Asia/Kolkata', memory: '1GiB', timeoutSeconds: 540, retryCount: 2 }, async () => {
  const policy = await readBackupPolicy();
  // Weekly policy: run only on Sundays (India time).
  if (policy.weekly && new Date(Date.now() + 330 * 60000).getUTCDay() !== 0) { logger.info('Weekly backup policy: skipped today'); return; }
  const bucket = getStorage().bucket();
  const schools = await db.collection('schools').select().get();
  const failed = [];
  let done = 0;
  for (const school of schools.docs) {
    // One school failing never stops the others.
    try {
      await backUpSchool(bucket, school.id, policy.keepDays);
      done += 1;
    } catch (error) {
      failed.push(school.id);
      logger.error('Backup failed for ' + school.id, error);
      await db.doc('schools/' + school.id + '/settings/autoBackup').set({ date: today(), ok: false, error: String(error.message || error).slice(0, 200) }).catch(() => {});
    }
  }
  await db.doc('platformJobs/backup-' + today()).set({ at: Timestamp.now(), schools: schools.size, done, failed });
  logger.info('Nightly backup finished', { schools: schools.size, done, failed });
});

async function sendToTokens(schoolId, tokenDocs, data) {
  const tokens = [...new Set(tokenDocs.map((record) => record.data().token).filter(Boolean))];
  if (!tokens.length) return 0;
  let sent = 0;
  for (let start = 0; start < tokens.length; start += 500) {
    const chunk = tokens.slice(start, start + 500);
    const result = await getMessaging().sendEachForMulticast({ tokens: chunk, data, webpush: { headers: { Urgency: 'high' } } });
    sent += result.successCount;
    // A token that is no longer valid (the family turned notifications off or reinstalled) is removed.
    const dead = result.responses.map((item, index) => ({ item, token: chunk[index] }))
      .filter(({ item }) => !item.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(item.error?.code));
    for (const { token } of dead) {
      for (const record of tokenDocs.filter((found) => found.data().token === token)) await record.ref.delete().catch(() => {});
    }
  }
  return sent;
}

exports.pushOnNotice = onDocumentCreated('schools/{schoolId}/notices/{noticeId}', async (event) => {
  const notice = event.data?.data();
  if (!notice || !['all', 'families', 'class'].includes(notice.audience)) return;
  const tokens = db.collection('schools/' + event.params.schoolId + '/pushTokens');
  const snap = notice.audience === 'class' ? await tokens.where('classId', '==', notice.classId).get() : await tokens.get();
  const sent = await sendToTokens(event.params.schoolId, snap.docs, { title: String(notice.title).slice(0, 80), body: String(notice.body || '').slice(0, 140), url: './' });
  logger.info('Notice push', { school: event.params.schoolId, tokens: snap.size, sent });
});

exports.pushOnFeeReminder = onDocumentCreated('schools/{schoolId}/feeReminders/{reminderId}', async (event) => {
  const reminder = event.data?.data();
  if (!reminder) return;
  const snap = await db.collection('schools/' + event.params.schoolId + '/pushTokens').where('studentId', '==', reminder.studentId).get();
  const body = (reminder.message ? reminder.message + ' - ' : '') + 'Rs ' + reminder.amount + ' is overdue for ' + reminder.studentName + '.';
  const sent = await sendToTokens(event.params.schoolId, snap.docs, { title: 'Fee reminder', body: body.slice(0, 160), url: './' });
  logger.info('Fee reminder push', { school: event.params.schoolId, tokens: snap.size, sent });
});

// ---- Backup restore (Batch 66) ----
// Lists a restore never touches: who can sign in, the activity log and the settings records.
const NEVER_RESTORE = new Set(['members', 'familyAccess', 'auditLog', 'settings']);
const RESTORABLE = BACKUP_COLLECTIONS.filter((name) => !NEVER_RESTORE.has(name));
const SCHOOL_ID_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;
const DATE_PATTERN = /^(\d{4}-\d{2}-\d{2}|pre-restore-\d{4}-\d{2}-\d{2}-\d{6})$/;

async function requireOwner(request) {
  const schoolId = request.data?.schoolId;
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (typeof schoolId !== 'string' || !SCHOOL_ID_PATTERN.test(schoolId)) throw new HttpsError('invalid-argument', 'Unknown school.');
  const member = await db.doc('schools/' + schoolId + '/members/' + request.auth.uid).get();
  if (!member.exists || member.data().active !== true || member.data().role !== 'owner') throw new HttpsError('permission-denied', 'Only the school owner can do this.');
  const billing = await db.doc('schools/' + schoolId + '/billing/main').get();
  if (billing.exists && ['suspended', 'cancelled'].includes(billing.data().status)) throw new HttpsError('failed-precondition', 'This school is read-only.');
  return schoolId;
}
function checkedDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw new HttpsError('invalid-argument', 'Choose a backup.');
  return value;
}
// Turns { __ts: ISO text } back into a timestamp.
const revive = (value) => {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.__ts === 'string') return Timestamp.fromDate(new Date(value.__ts));
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, revive(inner)]));
  }
  return value;
};
async function readBackup(schoolId, date) {
  const file = getStorage().bucket().file('backups/' + schoolId + '/' + date + '.json');
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'That backup file was not found.');
  const [body] = await file.download();
  const parsed = JSON.parse(body.toString('utf8'));
  if (parsed.schoolId !== schoolId) throw new HttpsError('failed-precondition', 'That backup belongs to another school.');
  return parsed;
}
const sameData = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(b);

exports.listBackups = onCall({ memory: '256MiB' }, async (request) => {
  const schoolId = await requireOwner(request);
  const [files] = await getStorage().bucket().getFiles({ prefix: 'backups/' + schoolId + '/' });
  return {
    backups: files.map((item) => ({ date: item.name.split('/').pop().replace('.json', ''), bytes: Number(item.metadata.size || 0) }))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30),
  };
});

// Compares one backup with the records now. Counts only: nothing is changed.
exports.previewRestore = onCall({ memory: '1GiB', timeoutSeconds: 300 }, async (request) => {
  const schoolId = await requireOwner(request);
  const backup = await readBackup(schoolId, checkedDate(request.data.date));
  const lists = [];
  for (const name of RESTORABLE) {
    const saved = backup.collections?.[name];
    if (!Array.isArray(saved)) continue;
    const snap = await db.collection('schools/' + schoolId + '/' + name).get();
    const now = new Map(snap.docs.map((record) => [record.id, record.data()]));
    let missing = 0;
    let changed = 0;
    for (const item of saved) {
      if (!now.has(item.id)) missing += 1;
      else if (!sameData(now.get(item.id), item.data)) changed += 1;
    }
    const savedIds = new Set(saved.map((item) => item.id));
    const extra = [...now.keys()].filter((id) => !savedIds.has(id)).length;
    if (missing || changed || extra) lists.push({ name, inBackup: saved.length, now: now.size, missing, changed, extra });
  }
  return { date: backup.date, docs: backup.docs, lists };
});

// Restores chosen lists. mode 'missing' only adds records that are gone. mode 'overwrite' also puts back the saved version of records
// that were changed. Records created after the backup are never removed. A safety copy of the lists is saved first.
exports.restoreBackup = onCall({ memory: '1GiB', timeoutSeconds: 540 }, async (request) => {
  const schoolId = await requireOwner(request);
  const date = checkedDate(request.data.date);
  const mode = request.data.mode === 'overwrite' ? 'overwrite' : 'missing';
  const names = Array.isArray(request.data.lists) ? [...new Set(request.data.lists)].filter((name) => RESTORABLE.includes(name)) : [];
  if (!names.length) throw new HttpsError('invalid-argument', 'Choose at least one list.');
  const backup = await readBackup(schoolId, date);
  // Safety copy of the chosen lists as they are right now.
  const stamp = new Date(Date.now() + 330 * 60000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const safetyName = 'pre-restore-' + stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + '-' + stamp.slice(8, 14);
  const before = {};
  for (const name of names) {
    const snap = await db.collection('schools/' + schoolId + '/' + name).get();
    before[name] = snap.docs.map((record) => ({ id: record.id, data: plain(record.data()) }));
  }
  await getStorage().bucket().file('backups/' + schoolId + '/' + safetyName + '.json')
    .save(JSON.stringify({ schoolId, date: safetyName, docs: Object.values(before).reduce((sum, rows) => sum + rows.length, 0), collections: before }), { contentType: 'application/json', resumable: false });
  const done = {};
  let total = 0;
  for (const name of names) {
    const saved = backup.collections?.[name];
    if (!Array.isArray(saved)) continue;
    const now = new Map(before[name].map((item) => [item.id, item.data]));
    const todo = saved.filter((item) => !now.has(item.id) || (mode === 'overwrite' && !sameData(plain(revive(item.data)), now.get(item.id))));
    for (let start = 0; start < todo.length; start += 400) {
      const batch = db.batch();
      for (const item of todo.slice(start, start + 400)) batch.set(db.doc('schools/' + schoolId + '/' + name + '/' + item.id), revive(item.data));
      await batch.commit();
    }
    done[name] = todo.length;
    total += todo.length;
  }
  await db.doc('schools/' + schoolId + '/auditLog/L-RESTORE-' + Date.now().toString(36).toUpperCase()).set({
    actor: request.auth.uid, action: 'restore', target: 'backup', docId: date, at: new Date().toISOString(), detail: (mode + ': ' + names.join(', ') + ' (' + total + ' records)').slice(0, 300),
  }).catch(() => {});
  logger.info('Restore', { school: schoolId, date, mode, total });
  return { restored: total, lists: done, safetyCopy: safetyName };
});

// ---- Batch 68 ----
// 1. autoFeeReminders: every morning, sends a reminder to the family of each student whose fees are overdue, for schools whose owner
//    switched this on (settings/autoReminders). runFeeRemindersNow lets the owner run it at once. Each reminder is a feeReminders
//    record, so pushOnFeeReminder turns it into a phone notification and families see it on their dashboard.
// 2. securityAlerts: every sensitive entry in a school's activity log (voided payment, removed student, year change, restore...)
//    becomes a record in securityAlerts for the owner, and a burst of removals raises one extra alert.
// 3. healthCheck: every 6 hours (and on request from the platform administrator) checks the database and file storage, and the
//    latest backups, and writes the result to platformJobs/health.
const money = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

async function overdueFor(schoolId) {
  const base = 'schools/' + schoolId + '/';
  const settings = await db.doc(base + 'settings/academic').get();
  const yearId = settings.exists ? settings.data().activeYearId : null;
  if (!yearId) return { yearId: null, rows: [] };
  const [year, enrollments, students, structures, concessions, payments, riders, routes] = await Promise.all([
    db.doc(base + 'academicYears/' + yearId).get(),
    db.collection(base + 'enrollments').where('yearId', '==', yearId).get(),
    db.collection(base + 'students').where('status', '==', 'active').get(),
    db.collection(base + 'feeStructures').where('yearId', '==', yearId).get(),
    db.collection(base + 'concessions').get(),
    db.collection(base + 'payments').where('yearId', '==', yearId).get(),
    db.collection(base + 'transportRiders').get(),
    db.collection(base + 'routes').get(),
  ]);
  const today_ = today();
  const span = year.exists ? year.data() : null;
  const classOf = new Map(enrollments.docs.map((record) => [record.data().studentId, record.data().classId]));
  const heads = new Map();
  for (const record of structures.docs) {
    const item = record.data();
    if (!heads.has(item.classId)) heads.set(item.classId, []);
    heads.get(item.classId).push(item);
  }
  const concessionOf = new Map();
  for (const record of concessions.docs) {
    const item = record.data();
    if (span && !(item.givenOn >= span.startDate && item.givenOn <= span.endDate)) continue;
    concessionOf.set(item.studentId, (concessionOf.get(item.studentId) ?? 0) + money(item.amount));
  }
  const paidOf = new Map();
  for (const record of payments.docs) {
    const item = record.data();
    if (item.voided === true) continue;
    paidOf.set(item.studentId, (paidOf.get(item.studentId) ?? 0) + money(item.amount));
  }
  const monthly = new Map(routes.docs.map((record) => [record.id, money(record.data().monthlyFee)]));
  const transportOf = new Map(riders.docs.map((record) => [record.id, (monthly.get(record.data().routeId) ?? 0) * money(record.data().months)]));
  const rows = [];
  for (const student of students.docs) {
    const classId = classOf.get(student.id);
    if (!classId) continue;
    const list = heads.get(classId) ?? [];
    const transport = transportOf.get(student.id) ?? 0;
    const gross = list.reduce((sum, item) => sum + money(item.amount), 0) + transport;
    const concession = concessionOf.get(student.id) ?? 0;
    const dueByToday = list.filter((item) => !item.dueOn || item.dueOn <= today_).reduce((sum, item) => sum + money(item.amount), 0) + transport;
    const concessionOnPast = Math.max(0, concession - (gross - dueByToday));
    const overdue = Math.max(0, dueByToday - concessionOnPast - (paidOf.get(student.id) ?? 0));
    if (overdue > 0) rows.push({ studentId: student.id, studentName: String(student.data().name || '').slice(0, 80), amount: Math.round(overdue) });
  }
  return { yearId, rows };
}

async function sendAutoReminders(schoolId) {
  const base = 'schools/' + schoolId + '/';
  const setting = await db.doc(base + 'settings/autoReminders').get();
  const on = setting.exists && setting.data().on === true;
  if (!on) return { sent: 0, skipped: 0, ran: false };
  const minimum = Math.max(1, Math.round(money(setting.data().min)) || 1);
  const everyDays = Math.max(1, Math.round(money(setting.data().everyDays)) || 7);
  const message = typeof setting.data().message === 'string' ? setting.data().message.slice(0, 200) : '';
  const day = today();
  const since = new Date(Date.parse(day) - everyDays * 86400000).toISOString().slice(0, 10);
  const { rows } = await overdueFor(schoolId);
  const recent = await db.collection(base + 'feeReminders').where('createdOn', '>=', since).get();
  const reminded = new Set(recent.docs.map((record) => record.data().studentId));
  const todo = rows.filter((row) => row.amount >= minimum && !reminded.has(row.studentId)).sort((a, b) => b.amount - a.amount).slice(0, 500);
  for (let start = 0; start < todo.length; start += 400) {
    const batch = db.batch();
    for (const row of todo.slice(start, start + 400)) {
      batch.set(db.collection(base + 'feeReminders').doc('FR-' + db.collection('x').doc().id), {
        studentId: row.studentId, studentName: row.studentName, amount: row.amount, createdOn: day, ...(message ? { message } : {}), by: 'auto',
      });
    }
    await batch.commit();
  }
  const skipped = rows.length - todo.length;
  await db.doc(base + 'settings/autoRemindersLog').set({ date: day, sent: todo.length, skipped, at: Timestamp.now() });
  return { sent: todo.length, skipped, ran: true };
}

exports.autoFeeReminders = onSchedule({ schedule: '0 9 * * *', timeZone: 'Asia/Kolkata', memory: '512MiB', timeoutSeconds: 540 }, async () => {
  const schools = await db.collection('schools').select().get();
  let sent = 0;
  const failed = [];
  for (const school of schools.docs) {
    try {
      const billing = await db.doc('schools/' + school.id + '/billing/main').get();
      if (billing.exists && ['suspended', 'cancelled'].includes(billing.data().status)) continue;
      sent += (await sendAutoReminders(school.id)).sent;
    } catch (error) {
      failed.push(school.id);
      logger.error('Auto reminders failed for ' + school.id, error);
    }
  }
  await db.doc('platformJobs/reminders-' + today()).set({ at: Timestamp.now(), schools: schools.size, sent, failed });
});

exports.runFeeRemindersNow = onCall({ memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  const schoolId = await requireOwner(request);
  const setting = await db.doc('schools/' + schoolId + '/settings/autoReminders').get();
  if (!setting.exists || setting.data().on !== true) throw new HttpsError('failed-precondition', 'Switch automatic reminders on and save first.');
  return sendAutoReminders(schoolId);
});

// Which activity-log entries raise a security alert.
const ALERT_RULES = {
  void: ['high', 'A payment was voided'],
  'close-year': ['high', 'An academic year was closed'],
  'activate-year': ['medium', 'An academic year was activated'],
  bulk: ['medium', 'A bulk change was made'],
  restore: ['high', 'A backup was restored'],
};
const SENSITIVE_REMOVALS = new Set(['students', 'payments', 'feeStructures', 'members', 'staffDirectory', 'marks', 'enrollments']);

exports.securityAlerts = onDocumentCreated('schools/{schoolId}/auditLog/{logId}', async (event) => {
  const entry = event.data?.data();
  if (!entry || typeof entry.action !== 'string') return;
  const { schoolId, logId } = event.params;
  const col = db.collection('schools/' + schoolId + '/securityAlerts');
  const at = typeof entry.at === 'string' ? entry.at : new Date().toISOString();
  const made = [];
  const rule = ALERT_RULES[entry.action];
  if (rule) {
    made.push({ id: 'A-' + logId, level: rule[0], title: rule[1], detail: (entry.target + ' ' + entry.docId + (entry.detail ? ' (' + entry.detail + ')' : '')).slice(0, 200) });
  } else if (entry.action === 'remove' && SENSITIVE_REMOVALS.has(entry.target)) {
    made.push({ id: 'A-' + logId, level: 'medium', title: 'A ' + entry.target + ' record was removed', detail: (entry.target + ' ' + entry.docId).slice(0, 200) });
  }
  // A night-time change (11 pm to 5 am, Indian time) by anyone.
  const hour = new Date(Date.parse(at) + 330 * 60000).getUTCHours();
  if (!made.length && ['save', 'remove', 'bulk'].includes(entry.action) && (hour >= 23 || hour < 5) && !String(logId).startsWith('L-RESTORE')) {
    made.push({ id: 'N-' + logId, level: 'low', title: 'A change was made at night', detail: (entry.action + ' ' + entry.target + ' ' + entry.docId).slice(0, 200) });
  }
  // A burst: 8 or more removals by one person in the last hour raises one alert for that hour.
  if (entry.action === 'remove') {
    const from = new Date(Date.parse(at) - 3600000).toISOString();
    const recent = await db.collection('schools/' + schoolId + '/auditLog').where('at', '>=', from).get();
    const mine = recent.docs.filter((record) => record.data().actor === entry.actor && record.data().action === 'remove').length;
    if (mine >= 8) made.push({ id: 'B-' + String(entry.actor).slice(0, 8) + '-' + at.slice(0, 13).replace(/[^0-9]/g, ''), level: 'high', title: mine + ' records removed within an hour', detail: 'One account removed many records quickly. Check the activity log.' });
  }
  for (const item of made) {
    // create() fails if the alert already exists, so repeated runs never make a second copy or undo "seen".
    await col.doc(item.id).create({ at, level: item.level, title: item.title, detail: item.detail, actor: String(entry.actor || '').slice(0, 60), seen: false }).catch(() => {});
  }
});

async function runHealth() {
  const out = { at: Timestamp.now(), ok: true, problems: [] };
  let started = Date.now();
  try { await db.doc('platformJobs/ping').set({ at: Timestamp.now() }); await db.doc('platformJobs/ping').get(); out.firestoreMs = Date.now() - started; } catch (error) { out.ok = false; out.firestoreMs = -1; out.problems.push('Database check failed.'); }
  started = Date.now();
  try { await getStorage().bucket().getFiles({ prefix: 'backups/', maxResults: 1 }); out.storageMs = Date.now() - started; } catch (error) { out.ok = false; out.storageMs = -1; out.problems.push('File storage check failed.'); }
  try {
    const schools = await db.collection('schools').select().get();
    out.schools = schools.size;
    const day = today();
    const yesterday = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
    const stale = [];
    const failed = [];
    for (const school of schools.docs) {
      const log = await db.doc('schools/' + school.id + '/settings/autoBackup').get();
      if (!log.exists) stale.push(school.id);
      else if (log.data().ok !== true) failed.push(school.id);
      else if (log.data().date < yesterday) stale.push(school.id);
    }
    out.backupFailed = failed.slice(0, 20);
    out.backupStale = stale.slice(0, 20);
    if (failed.length) { out.ok = false; out.problems.push(failed.length + ' school(s) had a failed backup.'); }
    if (stale.length) out.problems.push(stale.length + ' school(s) have no backup from the last 2 days.');
  } catch (error) { out.ok = false; out.problems.push('Could not read the schools list.'); }
  if (out.firestoreMs > 3000 || out.storageMs > 3000) out.problems.push('Responses are slow (over 3 seconds).');
  const previous = await db.doc('platformJobs/health').get().catch(() => null);
  const history = ((previous && previous.exists && previous.data().history) || []).slice(-27);
  history.push({ at: out.at.toDate().toISOString(), ok: out.ok && !out.problems.length, firestoreMs: out.firestoreMs, storageMs: out.storageMs });
  out.history = history;
  await db.doc('platformJobs/health').set(out);
  return { ...out, at: out.at.toDate().toISOString() };
}

exports.healthCheck = onSchedule({ schedule: '15 */6 * * *', timeZone: 'Asia/Kolkata', memory: '512MiB', timeoutSeconds: 240 }, async () => { await runHealth(); });

exports.runHealthNow = onCall({ memory: '512MiB', timeoutSeconds: 240 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const admin = await db.doc('platformAdmins/' + request.auth.uid).get();
  if (!admin.exists) throw new HttpsError('permission-denied', 'Only the platform administrator can do this.');
  return runHealth();
});

// ---- Batch 71: automatic billing (feature 071) ----
// For schools whose plan has autoBilling switched on by the platform administrator:
// 1. makes the invoice for the next renewal 7 days ahead (INV-AUTO-<period>, never twice),
// 2. marks unpaid invoices overdue once their due date has passed,
// 3. moves the renewal date one month forward once that renewal's invoice is paid,
// 4. makes the school read-only (status suspended) when an invoice is overdue by more than its grace days.
// It never takes a payment. The result goes to platformJobs/billing-<date>.
const addMonth = (text) => {
  const [year, month, day] = text.split('-').map(Number);
  const target = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
};
const addDaysText = (text, days) => new Date(Date.parse(text) + days * 86400000).toISOString().slice(0, 10);

async function billSchool(schoolId, day) {
  const out = { invoices: 0, overdue: 0, renewed: 0, suspended: 0 };
  const billingRef = db.doc('schools/' + schoolId + '/billing/main');
  const billing = await billingRef.get();
  if (!billing.exists) return out;
  const plan = billing.data();
  if (plan.autoBilling !== true || plan.status !== 'active' || !plan.renewsOn) return out;
  const invoices = db.collection('schools/' + schoolId + '/invoices');
  let renewsOn = plan.renewsOn;
  const period = renewsOn.slice(0, 7);
  const id = 'INV-AUTO-' + period;
  // 3. Renewal paid: move the date on (one month per night at most).
  const current = await invoices.doc(id).get();
  if (current.exists && current.data().status === 'paid' && renewsOn <= day) {
    renewsOn = addMonth(renewsOn);
    await billingRef.update({ renewsOn });
    out.renewed += 1;
  }
  // 1. Invoice 7 days ahead for the (possibly new) renewal.
  const nextPeriod = renewsOn.slice(0, 7);
  const nextId = 'INV-AUTO-' + nextPeriod;
  if (renewsOn <= addDaysText(day, 7) && Number(plan.monthlyPrice) > 0) {
    await invoices.doc(nextId).create({ period: nextPeriod, amount: Math.round(Number(plan.monthlyPrice)), dueOn: renewsOn, status: 'due', note: 'Made automatically' })
      .then(() => { out.invoices += 1; }).catch(() => {});
  }
  // 2 and 4. Overdue invoices, and suspension after the grace days.
  const unpaid = await invoices.where('status', 'in', ['due', 'overdue']).get();
  let worst = null;
  for (const record of unpaid.docs) {
    const item = record.data();
    if (item.dueOn < day) {
      if (item.status === 'due') { await record.ref.update({ status: 'overdue' }); out.overdue += 1; }
      if (!worst || item.dueOn < worst) worst = item.dueOn;
    }
  }
  const grace = Math.max(0, Math.round(Number(plan.graceDays) || 0));
  if (worst && day > addDaysText(worst, grace)) {
    await billingRef.update({ status: 'suspended', note: ('Suspended automatically: invoice unpaid since ' + worst).slice(0, 200) });
    out.suspended += 1;
  }
  return out;
}

async function billingRun() {
  const day = today();
  const schools = await db.collection('schools').select().get();
  const total = { invoices: 0, overdue: 0, renewed: 0, suspended: 0 };
  const failed = [];
  for (const school of schools.docs) {
    try {
      const result = await billSchool(school.id, day);
      for (const key of Object.keys(total)) total[key] += result[key];
    } catch (error) {
      failed.push(school.id);
      logger.error('Billing failed for ' + school.id, error);
    }
  }
  await db.doc('platformJobs/billing-' + day).set({ at: Timestamp.now(), schools: schools.size, ...total, failed });
  return total;
}

exports.nightlyBilling = onSchedule({ schedule: '30 3 * * *', timeZone: 'Asia/Kolkata', memory: '512MiB', timeoutSeconds: 300 }, async () => { await billingRun(); });

exports.runBillingNow = onCall({ memory: '512MiB', timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const admin = await db.doc('platformAdmins/' + request.auth.uid).get();
  if (!admin.exists) throw new HttpsError('permission-denied', 'Only the platform administrator can do this.');
  return billingRun();
});

// ---- Batch 83: measured usage (features 089, 092) ----
// Once a day, and on demand for the platform administrator, this reads Google's own monitoring numbers for the project (Firestore reads,
// writes and deletes, and Cloud Storage downloads and size) and saves the last 30 days to platformJobs/usage. It needs the server account to have the
// "Monitoring Viewer" role (roles/monitoring.viewer). If that role is missing, the saved result says so and nothing else is affected.
const { applicationDefault } = require('firebase-admin/app');
async function monitoringSeries(metric, aligner) {
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const token = (await applicationDefault().getAccessToken()).access_token;
  const end = new Date();
  const params = new URLSearchParams({
    filter: 'metric.type="' + metric + '"',
    'interval.startTime': new Date(end.getTime() - 30 * 86400000).toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': aligner,
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  });
  const res = await fetch('https://monitoring.googleapis.com/v3/projects/' + project + '/timeSeries?' + params.toString(), { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const error = new Error('Monitoring answered ' + res.status + ': ' + (await res.text()).slice(0, 200));
    error.status = res.status;
    throw error;
  }
  const body = await res.json();
  const points = (body.timeSeries && body.timeSeries[0] && body.timeSeries[0].points) || [];
  return points.map((point) => ({ date: String(point.interval.endTime).slice(0, 10), value: Number(point.value.int64Value ?? point.value.doubleValue ?? 0) }));
}
async function takeUsage() {
  const result = { at: Timestamp.now(), ok: false, days: [] };
  try {
    const [reads, writes, deletes, sent, size] = await Promise.all([
      monitoringSeries('firestore.googleapis.com/document/read_count', 'ALIGN_SUM'),
      monitoringSeries('firestore.googleapis.com/document/write_count', 'ALIGN_SUM'),
      monitoringSeries('firestore.googleapis.com/document/delete_count', 'ALIGN_SUM'),
      monitoringSeries('storage.googleapis.com/network/sent_bytes_count', 'ALIGN_SUM'),
      monitoringSeries('storage.googleapis.com/storage/total_bytes', 'ALIGN_MEAN'),
    ]);
    const byDate = new Map();
    const put = (list, key) => { for (const point of list) { const row = byDate.get(point.date) || { date: point.date, reads: 0, writes: 0, deletes: 0, sentBytes: 0, storageBytes: 0 }; row[key] = Math.round(point.value); byDate.set(point.date, row); } };
    put(reads, 'reads'); put(writes, 'writes'); put(deletes, 'deletes'); put(sent, 'sentBytes'); put(size, 'storageBytes');
    result.days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 31);
    result.ok = true;
  } catch (error) {
    result.error = String(error.message || error).slice(0, 300);
    if (error.status === 403) result.hint = 'Give the server account the Monitoring Viewer role (roles/monitoring.viewer).';
    logger.error('Usage snapshot failed', error);
  }
  await db.doc('platformJobs/usage').set(result);
  return { ok: result.ok, days: result.days.length, error: result.error || null, hint: result.hint || null };
}
exports.usageSnapshot = onSchedule({ schedule: '10 4 * * *', timeZone: 'Asia/Kolkata', memory: '256MiB', timeoutSeconds: 120 }, async () => { await takeUsage(); });
exports.runUsageNow = onCall({ memory: '256MiB', timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const admin = await db.doc('platformAdmins/' + request.auth.uid).get();
  if (!admin.exists) throw new HttpsError('permission-denied', 'Only the platform administrator can do this.');
  const usage = await takeUsage();
  usage.cost = await takeCost();
  return usage;
});

// ---- Batch 85: measured cost (feature 093) ----
// Reads the Cloud Billing export that the platform owner switches on in the Google Cloud console (Billing > Billing export > BigQuery export,
// dataset "billing_export" in this project). Nothing else can read cost. Until the export has data, the saved result says what is missing.
// Needs the server account to have BigQuery Job User on the project and BigQuery Data Viewer on the dataset.
async function takeCost() {
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const result = { at: Timestamp.now(), ok: false, months: [], services: [] };
  try {
    const token = (await applicationDefault().getAccessToken()).access_token;
    const run = async (sql) => {
      const res = await fetch('https://bigquery.googleapis.com/bigquery/v2/projects/' + project + '/queries', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 60000, maximumBytesBilled: '1000000000' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { const error = new Error('BigQuery answered ' + res.status + ': ' + String((body.error && body.error.message) || '').slice(0, 220)); error.status = res.status; throw error; }
      if (body.jobComplete === false) throw new Error('The cost query did not finish in time. Try again.');
      return (body.rows || []).map((row) => row.f.map((cell) => cell.v));
    };
    const table = '`' + project + '.billing_export.gcp_billing_export_v1_*`';
    const net = 'SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0))';
    const months = await run('SELECT FORMAT_DATE("%Y-%m", DATE(usage_start_time)) AS month, ' + net + ' AS cost, ANY_VALUE(currency) AS currency FROM ' + table +
      ' WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 200 DAY) GROUP BY month ORDER BY month DESC LIMIT 7');
    const services = await run('SELECT service.description AS service, ' + net + ' AS cost FROM ' + table +
      ' WHERE FORMAT_DATE("%Y-%m", DATE(usage_start_time)) = FORMAT_DATE("%Y-%m", CURRENT_DATE()) GROUP BY service ORDER BY cost DESC LIMIT 8');
    result.months = months.map(([month, cost, currency]) => ({ month, cost: Math.round(Number(cost) * 100) / 100, currency }));
    result.services = services.map(([name, cost]) => ({ name: String(name).slice(0, 60), cost: Math.round(Number(cost) * 100) / 100 }));
    result.ok = true;
    if (!result.months.length) result.note = 'The export is on but has no rows yet. Google adds the first rows within a day.';
  } catch (error) {
    result.error = String(error.message || error).slice(0, 300);
    if (error.status === 404 || /Not found/i.test(result.error)) result.hint = 'The billing export is not set up yet. In the Google Cloud console open Billing > Billing export, and turn on the standard BigQuery export into a dataset named billing_export.';
    else if (error.status === 403) result.hint = 'Give the server account BigQuery Job User on the project and BigQuery Data Viewer on the billing_export dataset.';
    logger.error('Cost snapshot failed', error);
  }
  await db.doc('platformJobs/cost').set(result);
  return { ok: result.ok, error: result.error || null, hint: result.hint || null, note: result.note || null };
}
exports.costSnapshot = onSchedule({ schedule: '40 4 * * *', timeZone: 'Asia/Kolkata', memory: '256MiB', timeoutSeconds: 120 }, async () => { await takeCost(); });

// ---- Batch 86: failed sign-in detection (feature 097) ----
// Needs Firebase Authentication upgraded to Identity Platform with "User activity logging" switched on (Google Cloud console > Identity Platform >
// Settings). Google then writes one log entry per sign-in request to Cloud Logging, failures included. Once an hour (and on demand for the platform
// administrator) this reads the last 24 hours, counts failed password sign-ins, groups them by a masked email and flags any address with 5 or more.
// Only masked emails are saved. The server account needs the Logging Viewer role (roles/logging.viewer).
const maskEmail = (value) => {
  const text = String(value || '').toLowerCase();
  const at = text.indexOf('@');
  if (at < 1) return 'unknown';
  return text.slice(0, Math.min(2, at)) + '***' + text.slice(at);
};
async function scanFailedLogins() {
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const result = { at: Timestamp.now(), ok: false, attempts: 0, failed: 0, byEmail: [], suspicious: [], hours: [] };
  try {
    const token = (await applicationDefault().getAccessToken()).access_token;
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const entries = [];
    let pageToken;
    for (let page = 0; page < 5; page += 1) {
      const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceNames: ['projects/' + project], orderBy: 'timestamp desc', pageSize: 1000, ...(pageToken ? { pageToken } : {}),
          filter: 'logName="projects/' + project + '/logs/identitytoolkit.googleapis.com%2Frequests" AND timestamp>="' + since + '"' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { const error = new Error('Logging answered ' + res.status + ': ' + String((body.error && body.error.message) || '').slice(0, 200)); error.status = res.status; throw error; }
      entries.push(...(body.entries || []));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    const byEmail = new Map();
    const hours = new Map();
    for (const entry of entries) {
      const payload = entry.protoPayload || {};
      const method = String(payload.methodName || '');
      if (!/VerifyPassword|SignInWithPassword|SignInWithEmail/i.test(method)) continue;
      result.attempts += 1;
      const code = payload.status && payload.status.code ? Number(payload.status.code) : 0;
      const message = String((payload.status && payload.status.message) || '');
      if (!code && !/INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|TOO_MANY_ATTEMPTS|USER_DISABLED/i.test(message)) continue;
      result.failed += 1;
      const request = payload.request || {};
      const who = maskEmail(request.email || request.identifier || (payload.authenticationInfo && payload.authenticationInfo.principalEmail));
      byEmail.set(who, (byEmail.get(who) || 0) + 1);
      const hour = String(entry.timestamp || '').slice(0, 13);
      hours.set(hour, (hours.get(hour) || 0) + 1);
      if (!result.shape) result.shape = Object.keys(payload).slice(0, 12).join(',');
    }
    result.byEmail = [...byEmail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([email, count]) => ({ email, count }));
    result.suspicious = result.byEmail.filter((row) => row.count >= 5);
    result.hours = [...hours.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 24).map(([hour, count]) => ({ hour, count }));
    result.ok = true;
    if (!entries.length) result.note = 'No sign-in activity is in the log yet. Check that User activity logging is switched on in Identity Platform settings.';
  } catch (error) {
    result.error = String(error.message || error).slice(0, 300);
    if (error.status === 403) result.hint = 'Give the server account the Logging Viewer role (roles/logging.viewer).';
    logger.error('Failed-login scan failed', error);
  }
  await db.doc('platformJobs/failedLogins').set(result);
  return { ok: result.ok, failed: result.failed, error: result.error || null, hint: result.hint || null, note: result.note || null };
}
exports.failedLoginScan = onSchedule({ schedule: '5 * * * *', timeZone: 'Asia/Kolkata', memory: '256MiB', timeoutSeconds: 120 }, async () => { await scanFailedLogins(); });
exports.runLoginScanNow = onCall({ memory: '256MiB', timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const admin = await db.doc('platformAdmins/' + request.auth.uid).get();
  if (!admin.exists) throw new HttpsError('permission-denied', 'Only the platform administrator can do this.');
  return scanFailedLogins();
});

// ---- Batch 87: email (135), ticket classification (147) and failed-payment follow-up (146) ----
// Keys are never kept in the database or in the code. They live in Google Secret Manager under the names below; the server account needs
// the "Secret Manager Secret Accessor" role. With no key, email is skipped and ticket classification uses fixed keyword rules.
async function getSecret(name) {
  try {
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    const token = (await applicationDefault().getAccessToken()).access_token;
    const res = await fetch('https://secretmanager.googleapis.com/v1/projects/' + project + '/secrets/' + name + '/versions/latest:access', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const body = await res.json();
    return Buffer.from(body.payload.data, 'base64').toString('utf8').trim() || null;
  } catch (error) {
    logger.error('Could not read secret ' + name, error);
    return null;
  }
}
async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const admin = await db.doc('platformAdmins/' + request.auth.uid).get();
  if (!admin.exists) throw new HttpsError('permission-denied', 'Only the platform administrator can do this.');
}

// Email through Resend. Settings come from platformConfig/email (provider must be "resend", plus a from address on a domain verified in Resend).
async function sendEmail({ to, subject, text }) {
  const cfg = ((await db.doc('platformConfig/email').get()).data()) || {};
  if (cfg.provider !== 'resend') return { ok: false, hint: 'Choose Resend as the mail service in Platform settings > Email.' };
  if (!cfg.fromAddress) return { ok: false, hint: 'Set the From address in Platform settings > Email.' };
  const key = await getSecret('RESEND_API_KEY');
  if (!key) return { ok: false, hint: 'Save the Resend key in Google Secret Manager as RESEND_API_KEY and give the server account the Secret Manager Secret Accessor role.' };
  const body = { from: cfg.senderName ? cfg.senderName + ' <' + cfg.fromAddress + '>' : cfg.fromAddress, to: [to], subject: String(subject).slice(0, 200),
    text: String(text).slice(0, 5000) + (cfg.footerNote ? '\n\n' + cfg.footerNote : ''), ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) };
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, error: 'Resend answered ' + res.status + ': ' + (await res.text()).slice(0, 200) };
  return { ok: true };
}
exports.sendTestEmail = onCall({ memory: '256MiB', timeoutSeconds: 60 }, async (request) => {
  await requireAdmin(request);
  const to = request.auth.token.email;
  if (!to) return { ok: false, error: 'Your account has no email address.' };
  const result = await sendEmail({ to, subject: 'AZIZ test email', text: 'This is a test email from the AZIZ Super Admin panel. If you can read it, platform email works.' });
  return { ...result, to };
});

// Ticket classification. With an Anthropic key in Secret Manager (ANTHROPIC_API_KEY) a model reads the ticket; otherwise fixed keyword rules decide.
// Only the subject and message of the ticket are sent, and only when the key exists. Results go to platformJobs/triage (the ticket itself is never changed).
const TICKET_CATEGORIES = ['billing', 'technical', 'account', 'data', 'feature', 'other'];
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
function triageByRules(subject, body) {
  const text = (subject + ' ' + body).toLowerCase();
  const category = /invoice|payment|paid|refund|billing|subscription|charge|plan price/.test(text) ? 'billing'
    : /password|sign in|sign-in|login|log in|access|staff|invite|owner|account/.test(text) ? 'account'
    : /error|bug|crash|not working|doesn't work|does not work|slow|blank|stuck|broken/.test(text) ? 'technical'
    : /correct|wrong|delete|restore|duplicate|import|missing record|data/.test(text) ? 'data'
    : /feature|suggest|request|would like|please add|improve/.test(text) ? 'feature' : 'other';
  const priority = /urgent|asap|immediately|today|data loss|all students|cannot sign in|can't sign in|down\b/.test(text) ? 'urgent'
    : /not working|error|blocked|failed|cannot|can't|wrong amount/.test(text) ? 'high' : category === 'feature' ? 'low' : 'normal';
  return { category, priority, summary: String(subject).slice(0, 100), by: 'rules' };
}
async function triageTicket(ticket) {
  const key = await getSecret('ANTHROPIC_API_KEY');
  if (key) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 200, messages: [{ role: 'user', content:
          'Classify this support ticket from a school using a school management system. Answer with JSON only: {"category": one of ' + TICKET_CATEGORIES.join('|') +
          ', "priority": one of ' + TICKET_PRIORITIES.join('|') + ', "summary": a summary of at most 100 characters}.\n\nSubject: ' + String(ticket.subject).slice(0, 200) + '\nMessage: ' + String(ticket.body).slice(0, 1500) }] }),
      });
      if (res.ok) {
        const out = await res.json();
        const text = (out.content && out.content[0] && out.content[0].text) || '';
        const found = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (TICKET_CATEGORIES.includes(found.category) && TICKET_PRIORITIES.includes(found.priority)) return { category: found.category, priority: found.priority, summary: String(found.summary || '').slice(0, 100), by: 'ai' };
      } else logger.error('Ticket AI answered ' + res.status);
    } catch (error) { logger.error('Ticket AI failed; using rules', error); }
  }
  return triageByRules(ticket.subject, ticket.body);
}
async function saveTriage(ticketId, result) {
  const ref = db.doc('platformJobs/triage');
  await db.runTransaction(async (tx) => {
    const items = ((await tx.get(ref)).data() || {}).items || {};
    items[ticketId] = { ...result, at: Date.now() };
    const keys = Object.keys(items);
    if (keys.length > 300) for (const old of keys.sort((a, b) => items[a].at - items[b].at).slice(0, keys.length - 300)) delete items[old];
    tx.set(ref, { items, at: Timestamp.now() });
  });
}
exports.classifyTicket = onDocumentCreated('supportTickets/{ticketId}', async (event) => {
  const ticket = event.data && event.data.data();
  if (!ticket) return;
  await saveTriage(event.params.ticketId, await triageTicket(ticket));
});
exports.triageOpenTickets = onCall({ memory: '256MiB', timeoutSeconds: 180 }, async (request) => {
  await requireAdmin(request);
  const known = (((await db.doc('platformJobs/triage').get()).data()) || {}).items || {};
  const open = await db.collection('supportTickets').where('status', '==', 'open').limit(60).get();
  let done = 0; let by = '';
  for (const found of open.docs) {
    if (known[found.id] || done >= 20) continue;
    const result = await triageTicket(found.data());
    await saveTriage(found.id, result);
    by = result.by; done += 1;
  }
  return { done, by };
});

// Failed-payment follow-up. When the platform records a failed payment attempt on an invoice that is still unpaid, the school gets a payment notice
// in its dashboard (and an email to its owner when email is set up): the day after the next run, then every 3 days, at most 3 times, and never once
// the invoice is paid or the failed attempt is more than 14 days old. It never takes a payment. The result is saved to platformJobs/followups.
async function followUpRun() {
  const ref = db.doc('platformJobs/followups');
  const items = ((await ref.get()).data() || {}).items || {};
  const schools = await db.collection('schools').select().get();
  let sent = 0; let emailed = 0;
  for (const school of schools.docs) {
    try {
      const unpaid = await db.collection('schools/' + school.id + '/invoices').where('status', 'in', ['due', 'overdue']).get();
      for (const invoice of unpaid.docs) {
        const data = invoice.data();
        const failed = await invoice.ref.collection('payments').where('status', '==', 'failed').get();
        if (failed.empty) continue;
        const latest = Math.max(...failed.docs.map((entry) => (entry.data().at && entry.data().at.toMillis ? entry.data().at.toMillis() : 0)));
        if (!latest || Date.now() - latest > 14 * 86400000) continue;
        const balance = Math.max(0, (Number(data.amount) || 0) - (Number(data.amountPaid) || 0));
        const key = school.id + '_' + invoice.id;
        const seen = items[key] || { n: 0, last: 0 };
        if (balance <= 0 || seen.n >= 3 || (seen.n > 0 && Date.now() - seen.last < 3 * 86400000)) continue;
        const title = seen.n >= 2 ? 'Final reminder: payment for invoice ' + invoice.id : 'A payment for invoice ' + invoice.id + ' did not go through';
        const text = 'A payment attempt for invoice ' + invoice.id + ' did not go through. The balance still due is Rs ' + balance + (data.dueOn ? ' (due ' + data.dueOn + ')' : '') +
          '. Please pay using the instructions on the invoice, or contact AZIZ support if you already paid.';
        const id = 'M-AUTO-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
        await db.doc('platformMessages/' + id).set({ kind: 'payment', title, body: text, audience: 'Automatic follow-up', recipients: [school.id], by: 'system', at: Timestamp.now() });
        await db.doc('schools/' + school.id + '/platformInbox/' + id).set({ kind: 'payment', title, body: text, at: Timestamp.now() });
        items[key] = { n: seen.n + 1, last: Date.now() };
        sent += 1;
        const owners = await db.collection('invites').where('schoolId', '==', school.id).where('role', '==', 'owner').get();
        const to = owners.docs.map((entry) => entry.data().email).find(Boolean);
        if (to && (await sendEmail({ to, subject: title, text })).ok) emailed += 1;
      }
    } catch (error) { logger.error('Payment follow-up failed for ' + school.id, error); }
  }
  await ref.set({ items, at: Timestamp.now(), sent, emailed });
  return { sent, emailed };
}
exports.paymentFollowUp = onSchedule({ schedule: '0 10 * * *', timeZone: 'Asia/Kolkata', memory: '256MiB', timeoutSeconds: 300 }, async () => { await followUpRun(); });
exports.runFollowUpNow = onCall({ memory: '256MiB', timeoutSeconds: 300 }, async (request) => { await requireAdmin(request); return followUpRun(); });

// ---------------------------------------------------------------------------------------------------------------------------------
// Batch 91: admissions desk, student and parent logins, yearly promotion. Everything that creates a login runs here (Admin SDK),
// never in the browser. The caller must be the owner, an admission/office staff member, or a principal the owner switched on.
// ---------------------------------------------------------------------------------------------------------------------------------
const { getAuth } = require('firebase-admin/auth');
const nodeCrypto = require('crypto');

const LOGIN_DOMAIN = 'login.aziz.school';
const loginEmail = (schoolId, loginId) => String(loginId).toLowerCase() + '@' + schoolId.toLowerCase() + '.' + LOGIN_DOMAIN;
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function newPassword() {
  let out = '';
  for (let i = 0; i < 10; i += 1) out += PW_CHARS[nodeCrypto.randomInt(PW_CHARS.length)];
  return out;
}
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

async function requireDesk(request, { ownerOnly = false } = {}) {
  const schoolId = request.data?.schoolId;
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (typeof schoolId !== 'string' || !SCHOOL_ID_PATTERN.test(schoolId)) throw new HttpsError('invalid-argument', 'Unknown school.');
  const member = await db.doc('schools/' + schoolId + '/members/' + request.auth.uid).get();
  const role = member.exists && member.data().active === true ? member.data().role : '';
  const allowed = ownerOnly ? ['owner'] : ['owner', 'office', 'principal'];
  if (!allowed.includes(role)) throw new HttpsError('permission-denied', ownerOnly ? 'Only the school owner can do this.' : 'Only the owner, the admission staff or a principal who was given admissions access can do this.');
  if (role === 'principal') {
    const access = await db.doc('schools/' + schoolId + '/settings/principalAccess').get();
    if (access.exists && access.data().admissions === false) throw new HttpsError('permission-denied', 'The owner has not given the principal admissions access.');
  }
  const billing = await db.doc('schools/' + schoolId + '/billing/main').get();
  if (billing.exists && ['suspended', 'cancelled'].includes(billing.data().status)) throw new HttpsError('failed-precondition', 'This school is read-only.');
  return { schoolId, role, uid: request.auth.uid };
}

async function deskAudit(schoolId, uid, detail, docId) {
  await db.collection('schools/' + schoolId + '/auditLog').add({
    actor: uid, action: 'save', target: 'students', docId: String(docId).slice(0, 100), at: new Date().toISOString(), detail: String(detail).slice(0, 200),
  });
}

// Classes, sections, years and the active year, for the admit form and the promotion screen.
exports.admissionOptions = onCall({ memory: '256MiB', timeoutSeconds: 60 }, async (request) => {
  const { schoolId } = await requireDesk(request);
  const base = 'schools/' + schoolId;
  const [classes, sections, years, settings] = await Promise.all([
    db.collection(base + '/classes').get(), db.collection(base + '/sections').get(),
    db.collection(base + '/academicYears').get(), db.doc(base + '/settings/academic').get(),
  ]);
  return {
    activeYearId: settings.exists ? settings.data().activeYearId ?? '' : '',
    classes: classes.docs.map((d) => ({ id: d.id, name: d.data().name, order: d.data().order })).sort((a, b) => a.order - b.order),
    sections: sections.docs.map((d) => ({ id: d.id, classId: d.data().classId, name: d.data().name })),
    years: years.docs.map((d) => ({ id: d.id, label: d.data().label, status: d.data().status })),
  };
});

// Admit a student: record, class placement, and (if asked) the student and parent logins.
exports.admitStudent = onCall({ memory: '256MiB', timeoutSeconds: 120 }, async (request) => {
  const { schoolId, uid, role } = await requireDesk(request);
  const d = request.data || {};
  const admissionNo = text(d.admissionNo, 20);
  if (!/^[A-Za-z0-9-]{1,20}$/.test(admissionNo)) throw new HttpsError('invalid-argument', 'Admission number may use letters, numbers and hyphens only (up to 20).');
  const name = text(d.name, 120);
  const guardianName = text(d.guardianName, 120);
  const guardianPhone = text(d.guardianPhone, 20);
  if (!name || !guardianName) throw new HttpsError('invalid-argument', 'Enter the student name and the guardian name.');
  if (!/^[0-9+() -]{0,20}$/.test(guardianPhone)) throw new HttpsError('invalid-argument', 'The phone number may use digits, +, spaces, hyphens and brackets only.');
  const student = { admissionNo, name, guardianName, guardianPhone, status: 'active' };
  const dob = text(d.dob, 10);
  if (dob) { if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new HttpsError('invalid-argument', 'Enter the date of birth as a date.'); student.dob = dob; }
  const gender = text(d.gender, 10);
  if (gender) { if (!['male', 'female', 'other'].includes(gender)) throw new HttpsError('invalid-argument', 'Choose a gender from the list.'); student.gender = gender; }
  for (const [key, max] of [['address', 200], ['motherName', 120], ['previousSchool', 120], ['guardianEmail', 100], ['tcNo', 40]]) {
    const value = text(d[key], max); if (value) student[key] = value;
  }
  const emergency = text(d.emergencyPhone, 20);
  if (emergency) { if (!/^[0-9+() -]{1,20}$/.test(emergency)) throw new HttpsError('invalid-argument', 'The emergency phone may use digits, +, spaces, hyphens and brackets only.'); student.emergencyPhone = emergency; }
  const DOCS = ['birth', 'tc', 'marksheet', 'aadhaar', 'photos', 'address', 'medical', 'other'];
  if (Array.isArray(d.docs)) { const docs = DOCS.filter((k) => d.docs.includes(k)); if (docs.length) student.docsReceived = docs; }

  const base = 'schools/' + schoolId;
  const studentId = admissionNo.toLowerCase();
  if ((await db.doc(base + '/students/' + studentId).get()).exists) throw new HttpsError('already-exists', 'Admission number ' + admissionNo + ' is already used.');
  const billing = await db.doc(base + '/billing/main').get();
  if (billing.exists && typeof billing.data().studentLimit === 'number') {
    const count = (await db.collection(base + '/students').count().get()).data().count;
    if (count >= billing.data().studentLimit) throw new HttpsError('resource-exhausted', 'Your plan allows ' + billing.data().studentLimit + ' students. Ask support to raise the limit.');
  }
  const settings = await db.doc(base + '/settings/academic').get();
  const yearId = settings.exists ? settings.data().activeYearId : '';
  const year = yearId ? await db.doc(base + '/academicYears/' + yearId).get() : null;
  if (!year || !year.exists || year.data().status !== 'active') throw new HttpsError('failed-precondition', 'There is no active academic year. Activate one first.');
  const sectionId = text(d.sectionId, 31);
  const section = await db.doc(base + '/sections/' + sectionId).get();
  if (!section.exists) throw new HttpsError('invalid-argument', 'Choose a class and section.');
  const classId = section.data().classId;
  const rolls = await db.collection(base + '/enrollments').where('yearId', '==', yearId).where('sectionId', '==', sectionId).get();
  const rollNo = Math.min(999, Math.max(0, ...rolls.docs.map((r) => r.data().rollNo)) + 1);
  if (rolls.size >= 999) throw new HttpsError('failed-precondition', 'That section is full.');
  const enquiryId = text(d.enquiryId, 40);
  if (enquiryId && !/^EQ-[A-Za-z0-9-]{1,30}$/.test(enquiryId)) throw new HttpsError('invalid-argument', 'Unknown enquiry.');

  // Logins. The student login ID is the admission number; one parent login (parent-<phone>) covers every child of the family.
  const auth = getAuth();
  const slips = [];
  const created = [];
  const writes = [];
  const wantStudent = d.studentLogin !== false;
  const wantParent = d.parentLogin !== false;
  try {
    if (wantStudent) {
      const password = newPassword();
      const user = await auth.createUser({ email: loginEmail(schoolId, admissionNo), password, displayName: name, emailVerified: true });
      created.push(user.uid);
      slips.push({ who: 'Student', loginId: admissionNo.toLowerCase(), password });
      writes.push([base + '/members/' + user.uid, { role: 'student', active: true, mustChange: true }]);
      writes.push([base + '/familyAccess/' + user.uid, { studentId, relation: 'student', active: true }]);
    }
    if (wantParent) {
      const digits = guardianPhone.replace(/\D/g, '');
      const parentId = 'parent-' + (digits.length >= 6 ? digits : admissionNo.toLowerCase());
      let existing = null;
      try { existing = await auth.getUserByEmail(loginEmail(schoolId, parentId)); } catch { /* no such login yet */ }
      if (existing) {
        const link = await db.doc(base + '/familyAccess/' + existing.uid).get();
        if (!link.exists || link.data().relation !== 'parent') throw new HttpsError('already-exists', 'The login ' + parentId + ' is already used by someone else.');
        const extra = [...(link.data().extraStudentIds ?? [])];
        if (extra.length >= 4) throw new HttpsError('failed-precondition', 'One parent login can show up to 5 children.');
        extra.push(studentId);
        writes.push([base + '/familyAccess/' + existing.uid, { ...link.data(), extraStudentIds: extra }]);
        slips.push({ who: 'Parent', loginId: parentId, password: null, note: 'This family already has a parent login. The new child now shows under it. The password is unchanged.' });
      } else {
        const password = newPassword();
        const user = await auth.createUser({ email: loginEmail(schoolId, parentId), password, displayName: guardianName, emailVerified: true });
        created.push(user.uid);
        slips.push({ who: 'Parent', loginId: parentId, password });
        writes.push([base + '/members/' + user.uid, { role: 'parent', active: true, mustChange: true }]);
        writes.push([base + '/familyAccess/' + user.uid, { studentId, relation: 'parent', active: true }]);
      }
    }
    const batch = db.batch();
    batch.set(db.doc(base + '/students/' + studentId), student);
    batch.set(db.doc(base + '/enrollments/' + yearId + '_' + studentId), { yearId, studentId, classId, sectionId, rollNo });
    batch.set(db.doc(base + '/rollKeys/' + yearId + '_' + sectionId + '_' + rollNo), { yearId, sectionId, rollNo, studentId });
    for (const [path, data] of writes) batch.set(db.doc(path), data);
    if (enquiryId) {
      const enquiry = await db.doc(base + '/enquiries/' + enquiryId).get();
      if (enquiry.exists) batch.set(enquiry.ref, { ...enquiry.data(), status: 'admitted', note: ('Admission no ' + admissionNo).slice(0, 300) });
    }
    await batch.commit();
  } catch (error) {
    await Promise.all(created.map((id) => auth.deleteUser(id).catch(() => {})));
    if (error instanceof HttpsError) throw error;
    if (error?.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'A login for this admission number or parent phone already exists.');
    logger.error('admitStudent failed', error);
    throw new HttpsError('internal', 'Could not admit the student. Nothing was saved.');
  }
  await deskAudit(schoolId, uid, 'Admitted ' + name + ' (' + admissionNo + ') by ' + role + (slips.length ? '; logins created' : ''), studentId);
  return { studentId, rollNo, classId, sectionId, slips };
});

// Give a student or parent login a new password (shown once, changed at first sign-in).
exports.resetFamilyPassword = onCall({ memory: '256MiB', timeoutSeconds: 60 }, async (request) => {
  const { schoolId, uid, role } = await requireDesk(request);
  if (role === 'principal') throw new HttpsError('permission-denied', 'Only the owner or the admission staff can reset a password.');
  const studentId = text(request.data?.studentId, 20).toLowerCase();
  const relation = request.data?.relation === 'student' ? 'student' : 'parent';
  if (!studentId) throw new HttpsError('invalid-argument', 'Enter the admission number.');
  const base = 'schools/' + schoolId;
  const links = await db.collection(base + '/familyAccess').where('relation', '==', relation).get();
  const hit = links.docs.find((l) => l.data().studentId === studentId || (l.data().extraStudentIds ?? []).includes(studentId));
  if (!hit) throw new HttpsError('not-found', 'No ' + relation + ' login is linked to that admission number.');
  const password = newPassword();
  await getAuth().updateUser(hit.id, { password });
  await db.doc(base + '/members/' + hit.id).set({ mustChange: true }, { merge: true });
  const user = await getAuth().getUser(hit.id);
  await deskAudit(schoolId, uid, 'Password reset for the ' + relation + ' login of ' + studentId + ' by ' + role, studentId);
  return { loginId: String(user.email).split('@')[0], password, relation };
});

// Yearly promotion. Preview first (apply false), then apply. Owner only. Students in the last class are left alone.
exports.promoteStudents = onCall({ memory: '512MiB', timeoutSeconds: 300 }, async (request) => {
  const { schoolId, uid } = await requireDesk(request, { ownerOnly: true });
  const d = request.data || {};
  const fromYearId = text(d.fromYearId, 20);
  const toYearId = text(d.toYearId, 20);
  if (!fromYearId || !toYearId || fromYearId === toYearId) throw new HttpsError('invalid-argument', 'Choose the old year and a different new year.');
  const base = 'schools/' + schoolId;
  const [fromYear, toYear] = await Promise.all([db.doc(base + '/academicYears/' + fromYearId).get(), db.doc(base + '/academicYears/' + toYearId).get()]);
  if (!fromYear.exists || !toYear.exists) throw new HttpsError('not-found', 'That academic year does not exist.');
  if (!['draft', 'active'].includes(toYear.data().status)) throw new HttpsError('failed-precondition', 'The new year must be open (draft or active).');
  const hold = new Set(Array.isArray(d.holdBack) ? d.holdBack.map(String) : []);
  const [classSnap, sectionSnap, enrollSnap, studentSnap, doneSnap] = await Promise.all([
    db.collection(base + '/classes').get(), db.collection(base + '/sections').get(),
    db.collection(base + '/enrollments').where('yearId', '==', fromYearId).get(),
    db.collection(base + '/students').get(), db.collection(base + '/enrollments').where('yearId', '==', toYearId).get(),
  ]);
  const classes = classSnap.docs.map((c) => ({ id: c.id, name: c.data().name, order: c.data().order })).sort((a, b) => a.order - b.order);
  const sections = sectionSnap.docs.map((s) => ({ id: s.id, classId: s.data().classId, name: s.data().name }));
  const students = new Map(studentSnap.docs.map((s) => [s.id, s.data()]));
  const already = new Set(doneSnap.docs.map((e) => e.data().studentId));
  const nextRoll = new Map();
  for (const e of doneSnap.docs) nextRoll.set(e.data().sectionId, Math.max(nextRoll.get(e.data().sectionId) ?? 0, e.data().rollNo));
  const className = (id) => classes.find((c) => c.id === id)?.name ?? id;
  const sectionName = (id) => sections.find((s) => s.id === id)?.name ?? id;
  const rows = [];
  const enrollments = enrollSnap.docs.map((e) => e.data()).sort((a, b) => (a.classId + a.sectionId).localeCompare(b.classId + b.sectionId) || a.rollNo - b.rollNo);
  for (const e of enrollments) {
    const s = students.get(e.studentId);
    const row = { studentId: e.studentId, name: s?.name ?? e.studentId, from: className(e.classId) + ' ' + sectionName(e.sectionId) };
    if (!s || s.status !== 'active') { rows.push({ ...row, action: 'skip', reason: 'Not an active student' }); continue; }
    if (already.has(e.studentId)) { rows.push({ ...row, action: 'skip', reason: 'Already placed in the new year' }); continue; }
    let toClassId; let reason = '';
    if (hold.has(e.studentId)) { toClassId = e.classId; reason = 'Kept in the same class'; }
    else {
      const index = classes.findIndex((c) => c.id === e.classId);
      const next = index >= 0 ? classes[index + 1] : undefined;
      if (!next) { rows.push({ ...row, action: 'final', reason: 'Last class: not moved' }); continue; }
      toClassId = next.id;
    }
    const wantedName = sectionName(e.sectionId);
    const options = sections.filter((x) => x.classId === toClassId);
    const target = options.find((x) => x.name === wantedName) ?? options[0];
    if (!target) { rows.push({ ...row, action: 'skip', reason: 'No section in ' + className(toClassId) }); continue; }
    const roll = (nextRoll.get(target.id) ?? 0) + 1;
    if (roll > 999) { rows.push({ ...row, action: 'skip', reason: 'Section full' }); continue; }
    nextRoll.set(target.id, roll);
    rows.push({ ...row, action: hold.has(e.studentId) ? 'hold' : 'promote', reason, to: className(toClassId) + ' ' + target.name, plan: { classId: toClassId, sectionId: target.id, rollNo: roll } });
  }
  const moving = rows.filter((r) => r.plan);
  if (d.apply === true) {
    for (let i = 0; i < moving.length; i += 200) {
      const batch = db.batch();
      for (const r of moving.slice(i, i + 200)) {
        batch.set(db.doc(base + '/enrollments/' + toYearId + '_' + r.studentId), { yearId: toYearId, studentId: r.studentId, ...r.plan });
        batch.set(db.doc(base + '/rollKeys/' + toYearId + '_' + r.plan.sectionId + '_' + r.plan.rollNo), { yearId: toYearId, sectionId: r.plan.sectionId, rollNo: r.plan.rollNo, studentId: r.studentId });
      }
      await batch.commit();
    }
    await db.collection(base + '/auditLog').add({ actor: uid, action: 'bulk', target: 'enrollments', docId: (fromYear.data().label + ' to ' + toYear.data().label).slice(0, 100), at: new Date().toISOString(), detail: ('Promotion: ' + moving.length + ' students moved, ' + (rows.length - moving.length) + ' not moved').slice(0, 200) });
  }
  return { applied: d.apply === true, moved: moving.length, rows: rows.slice(0, 1500).map(({ plan, ...rest }) => rest) };
});

// ---------------------------------------------------------------------------------------------------------------------
// Batch 98 (Registration Mark 1): trusted school registration for the Super Admin onboarding wizard.
// reserveSchoolId: picks a collision-safe school ID inside a transaction and holds it for one draft.
// checkSchoolDuplicates: warns about schools that look like the one being registered (a warning, never a block).
// registerSchool: validates the draft on the server, then creates the school, its billing record, the owner invitation and the audit
// entry in one transaction. Repeating the call for the same draft returns the same school (idempotent).
// ---------------------------------------------------------------------------------------------------------------------
const RESERVED_SCHOOL_IDS = ['www', 'admin', 'api', 'app', 'platform', 'school', 'aziz', 'public', 'support', 'demo', 'mail', 'ftp'];
const NEW_SCHOOL_ID = /^[a-z][a-z0-9-]{2,29}$/;
const DRAFT_ID = /^OB-[A-Za-z0-9]{6,30}$/;
const TRIAL_DAYS = { trial: 30, trial60: 60, trial90: 90 };

async function requirePlatformAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const admin = await db.doc('platformAdmins/' + request.auth.uid).get();
  if (!admin.exists) throw new HttpsError('permission-denied', 'Only a platform administrator can register schools.');
  return { uid: request.auth.uid, email: String(request.auth.token?.email || '') };
}

// "St. Mary's Public School" -> "st-marys-public-school": lowercase, accents removed, letters and digits only, 3 to 30 characters.
function slugifySchoolName(name) {
  let slug = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(slug)) slug = 'school-' + slug;
  slug = slug.slice(0, 30).replace(/-+$/g, '');
  if (slug.length < 3) slug = (slug + '-school').slice(0, 30);
  return slug;
}
const normalName = (name) => String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(school|public|the|high|sr|secondary|jr|senior|junior)\b/g, ' ').replace(/\s+/g, ' ').trim();

exports.reserveSchoolId = onCall({ memory: '256MiB', timeoutSeconds: 60 }, async (request) => {
  const { uid } = await requirePlatformAdmin(request);
  const d = request.data || {};
  const draftId = text(d.draftId, 40);
  if (!DRAFT_ID.test(draftId)) throw new HttpsError('invalid-argument', 'Unknown draft.');
  const name = text(d.name, 120);
  const wanted = text(d.wanted, 30).toLowerCase();
  if (!name && !wanted) throw new HttpsError('invalid-argument', 'Enter the school name first.');
  if (wanted && !NEW_SCHOOL_ID.test(wanted)) throw new HttpsError('invalid-argument', 'Use 3 to 30 lowercase letters, numbers or dashes, starting with a letter.');
  const draftRef = db.doc('onboardingDrafts/' + draftId);
  const base = wanted || slugifySchoolName(name);
  const candidates = wanted ? [wanted] : [base, ...Array.from({ length: 98 }, (_, i) => (base.slice(0, 30 - String(i + 2).length - 1) + '-' + (i + 2)))];
  return db.runTransaction(async (tx) => {
    const draft = await tx.get(draftRef);
    if (!draft.exists || draft.data().status !== 'draft') throw new HttpsError('failed-precondition', 'This draft is not open.');
    const mine = draft.data().schoolId;
    // The ID is stable once held. It changes only when the admin asks for a different one (wanted).
    if (mine && !wanted) return { schoolId: mine, reused: true };
    for (const id of candidates) {
      if (RESERVED_SCHOOL_IDS.includes(id)) { if (wanted) throw new HttpsError('already-exists', 'That school ID is reserved.'); continue; }
      const [school, hold] = await Promise.all([tx.get(db.doc('schools/' + id)), tx.get(db.doc('schoolReservations/' + id))]);
      const heldByOther = hold.exists && hold.data().draftId !== draftId && hold.data().status !== 'released';
      if (school.exists || heldByOther) { if (wanted) throw new HttpsError('already-exists', 'That school ID is already used.'); continue; }
      if (mine && mine !== id) tx.set(db.doc('schoolReservations/' + mine), { status: 'released', releasedAt: Timestamp.now() }, { merge: true });
      tx.set(db.doc('schoolReservations/' + id), { draftId, by: uid, name, status: 'reserved', at: Timestamp.now() });
      tx.update(draftRef, { schoolId: id });
      return { schoolId: id, reused: false };
    }
    throw new HttpsError('already-exists', 'Could not find a free school ID. Type one yourself.');
  });
});

exports.checkSchoolDuplicates = onCall({ memory: '256MiB', timeoutSeconds: 60 }, async (request) => {
  await requirePlatformAdmin(request);
  const d = request.data || {};
  const name = normalName(text(d.name, 120));
  const town = text(d.town, 80).toLowerCase();
  const udise = text(d.udise, 20).replace(/\s/g, '');
  const affiliation = text(d.affiliation, 40).toLowerCase();
  const found = [];
  const schools = await db.collection('schools').limit(1000).get();
  for (const s of schools.docs) {
    const x = s.data();
    const reg = (await db.doc('schools/' + s.id + '/registration/main').get()).data() || {};
    const otherName = normalName(x.name);
    const why = [];
    if (udise && reg.udise && String(reg.udise).replace(/\s/g, '') === udise) why.push('same UDISE+ code');
    if (affiliation && reg.affiliationNo && String(reg.affiliationNo).toLowerCase() === affiliation) why.push('same affiliation number');
    if (name && otherName && name === otherName) why.push('same name');
    else if (name && otherName && town && (name.includes(otherName) || otherName.includes(name)) && (String(x.address || '').toLowerCase().includes(town) || String(reg.town || '').toLowerCase() === town)) why.push('similar name in the same place');
    if (why.length) found.push({ id: s.id, name: x.name, reason: why.join(', ') });
  }
  return { matches: found.slice(0, 10) };
});

const REQUIRED_REGISTRATION = ['name', 'schoolType', 'schoolLevel', 'genderComposition', 'medium', 'board', 'country', 'state', 'district', 'town', 'street', 'pin',
  'schoolPhone', 'schoolEmail', 'ownerName', 'ownerDesignation', 'ownerEmail', 'ownerMobile'];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 -]{6,17}$/;
// Every value is stored as text. Returns the list of problems (empty when the draft is good).
function checkRegistration(v) {
  const problems = [];
  for (const key of REQUIRED_REGISTRATION) if (!String(v[key] ?? '').trim()) problems.push(key + ' is required');
  if (v.name && String(v.name).length > 120) problems.push('name is too long');
  if (v.schoolEmail && !EMAIL_PATTERN.test(v.schoolEmail)) problems.push('schoolEmail is not valid');
  if (v.ownerEmail && (!EMAIL_PATTERN.test(v.ownerEmail) || v.ownerEmail !== v.ownerEmail.toLowerCase())) problems.push('ownerEmail must be a lowercase email address');
  for (const key of ['schoolPhone', 'ownerMobile', 'ownerWhatsapp', 'principalMobile', 'adminPhone']) if (v[key] && !PHONE_PATTERN.test(v[key])) problems.push(key + ' is not a valid phone number');
  for (const key of ['principalEmail', 'adminEmail']) if (v[key] && !EMAIL_PATTERN.test(v[key])) problems.push(key + ' is not valid');
  if (v.country === 'India' && v.pin && !/^[1-9][0-9]{5}$/.test(v.pin)) problems.push('pin must be 6 digits for India');
  if (v.country !== 'India' && v.pin && !/^[A-Za-z0-9 -]{3,10}$/.test(v.pin)) problems.push('pin is not valid');
  if (v.estYear) { const year = Number(v.estYear); if (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear()) problems.push('estYear is not a valid year'); }
  if (v.udise && !/^[0-9]{11}$/.test(String(v.udise).replace(/\s/g, ''))) problems.push('udise must be 11 digits');
  if (v.board && !['none', 'state'].includes(v.board) && !String(v.affiliationNo || '').trim()) problems.push('affiliationNo is required for this board');
  return problems;
}
const DRAFT_KEYS = ['name', 'shortName', 'estYear', 'schoolType', 'schoolLevel', 'genderComposition', 'medium', 'motto', 'description', 'board', 'affiliationNo', 'udise',
  'recognitionNo', 'trustName', 'trustRegNo', 'country', 'state', 'district', 'block', 'town', 'street', 'pin', 'schoolPhone', 'schoolEmail', 'mapLocation',
  'ownerName', 'ownerDesignation', 'ownerEmail', 'ownerMobile', 'ownerWhatsapp', 'ownerAddress', 'principalName', 'principalEmail', 'principalMobile',
  'adminName', 'adminEmail', 'adminPhone'];

exports.registerSchool = onCall({ memory: '256MiB', timeoutSeconds: 120 }, async (request) => {
  const { uid, email } = await requirePlatformAdmin(request);
  const d = request.data || {};
  const draftId = text(d.draftId, 40);
  if (!DRAFT_ID.test(draftId)) throw new HttpsError('invalid-argument', 'Unknown draft.');
  const planId = text(d.plan, 40);
  const reason = text(d.reason, 300);
  if (reason.length < 10) throw new HttpsError('invalid-argument', 'Give a reason of at least 10 characters. It is kept in the audit log.');
  const draftRef = db.doc('onboardingDrafts/' + draftId);
  const first = await draftRef.get();
  if (!first.exists) throw new HttpsError('not-found', 'That draft was not found.');
  if (first.data().status === 'registered') return { schoolId: first.data().schoolId, alreadyRegistered: true };
  const plan = TRIAL_DAYS[planId] ? null : await db.doc('plans/' + planId).get();
  if (!TRIAL_DAYS[planId] && !(plan && plan.exists && plan.data().active === true)) throw new HttpsError('invalid-argument', 'Choose a plan that is switched on.');
  const auditId = 'A-' + Date.now().toString(36).toUpperCase() + require('crypto').randomBytes(3).toString('hex').toUpperCase();
  const inviteId = 'OW-' + Date.now().toString(36).toUpperCase() + require('crypto').randomBytes(3).toString('hex').toUpperCase();
  return db.runTransaction(async (tx) => {
    const draft = await tx.get(draftRef);
    if (!draft.exists) throw new HttpsError('not-found', 'That draft was not found.');
    if (draft.data().status === 'registered') return { schoolId: draft.data().schoolId, alreadyRegistered: true };
    const schoolId = draft.data().schoolId;
    if (!schoolId || !NEW_SCHOOL_ID.test(schoolId)) throw new HttpsError('failed-precondition', 'Reserve the school ID first (it is done when you leave the first step).');
    const v = {};
    for (const key of DRAFT_KEYS) v[key] = String((draft.data().values || {})[key] ?? '').trim();
    const problems = checkRegistration(v);
    if (problems.length) throw new HttpsError('invalid-argument', 'Fix these first: ' + problems.slice(0, 6).join('; ') + (problems.length > 6 ? '; and ' + (problems.length - 6) + ' more' : '') + '.');
    const [school, hold] = await Promise.all([tx.get(db.doc('schools/' + schoolId)), tx.get(db.doc('schoolReservations/' + schoolId))]);
    if (school.exists) throw new HttpsError('already-exists', 'A school with this ID already exists.');
    if (!hold.exists || hold.data().draftId !== draftId || hold.data().status !== 'reserved') throw new HttpsError('failed-precondition', 'The school ID is no longer held for this draft. Reserve it again.');
    const now = Timestamp.now();
    const address = [v.street, v.block, v.town, v.district, v.state, v.pin, v.country].filter(Boolean).join(', ').slice(0, 500);
    tx.set(db.doc('schools/' + schoolId), { name: v.name, contactEmail: v.schoolEmail, phone: v.schoolPhone, address, createdBy: uid, schemaVersion: 2, registeredVia: 'onboarding' });
    tx.set(db.doc('schools/' + schoolId + '/registration/main'), { ...v, schemaVersion: 1, draftId, registeredBy: uid, registeredAt: now });
    const billing = TRIAL_DAYS[planId]
      ? { plan: 'trial', status: 'trial', trialEnds: Timestamp.fromMillis(Date.now() + TRIAL_DAYS[planId] * 86400000), studentLimit: 50, staffLimit: 10 }
      : { plan: planId, status: 'active', startedOn: now.toDate().toISOString().slice(0, 10), studentLimit: plan.data().studentLimit, staffLimit: plan.data().staffLimit, storageMb: plan.data().storageMb, monthlyPrice: plan.data().monthlyPrice };
    tx.set(db.doc('schools/' + schoolId + '/billing/main'), billing);
    tx.set(db.doc('invites/' + inviteId), { schoolId, email: v.ownerEmail, role: 'owner', status: 'pending', createdBy: uid });
    tx.set(db.doc('platformAudit/' + auditId), { actor: uid, actorEmail: email, action: 'register-school', schoolId, reason,
      detail: JSON.stringify({ name: v.name, owner: v.ownerEmail, plan: billing.plan, draftId, via: 'onboarding' }).slice(0, 1500), at: now });
    tx.update(db.doc('schoolReservations/' + schoolId), { status: 'used', usedAt: now });
    tx.update(draftRef, { status: 'registered', registeredAt: now, registeredBy: uid });
    return { schoolId, alreadyRegistered: false, ownerEmail: v.ownerEmail };
  });
});
