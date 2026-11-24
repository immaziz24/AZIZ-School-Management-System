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

const BACKUP_COLLECTIONS = ["studentHistory", "storageRecords", "staffDocuments", "eBooks", "noticeAcks", "members", "students", "academicYears", "classes", "sections", "subjects", "classSubjects", "enrollments", "rollKeys", "exams", "marks", "attendance", "staffAttendance", "leaveRequests", "feeStructures", "payments", "notices", "timetable", "homework", "calendar", "books", "loans", "behaviour", "visitors", "substitutions", "routes", "transportRiders", "activities", "activityMembers", "inventory", "alumni", "expenses", "certificates", "tickets", "staffDirectory", "vendors", "minutes", "lostFound", "concessions", "achievements", "complaints", "assets", "sales", "syllabus", "trainings", "diary", "healthRecords", "lessonPlans", "ptmSlots", "payroll", "messages", "enquiries", "eventRegistrations", "familyAccess", "classTeachers", "auditLog", "scholarships", "scholarshipApps", "consentForms", "consentResponses", "staffProfiles", "hostelRooms", "hostelStays", "canteenMenu", "canteenPlans", "bookReservations", "workflowRules", "approvalRequests", "questionBank", "onlineTests", "onlineTestKeys", "onlineAttempts", "pickupPeople", "pickupLogs", "settings"];
const KEEP_BACKUPS = 14;
// Batch 83: the platform's backup policy (platformConfig/backupPolicy, set on the admin Backups page) decides how long copies are kept
// (keepDays, 7 to 3650) and how often they run (daily or weekly). With no policy the old behaviour stays: daily, newest 14 files.
async function readBackupPolicy() {
  try {
    const found = await db.doc('platformConfig/backupPolicy').get();
    const data = found.exists ? found.data() : {};
    const keepDays = Number.isInteger(data.keepDays) && data.keepDays >= 7 && data.keepDays <= 3650 ? data.keepDays : null;
    return { keepDays, weekly: data.frequency === 'weekly' };
  } catch (error) {
    logger.error('Could not read the backup policy; using the default', error);
    return { keepDays: null, weekly: false };
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
  // With a policy: remove copies older than keepDays, but never the newest 3. Without one: keep the newest 14 files.
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
