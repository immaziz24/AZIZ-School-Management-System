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

const BACKUP_COLLECTIONS = ["studentHistory", "storageRecords", "staffDocuments", "members", "students", "academicYears", "classes", "sections", "subjects", "classSubjects", "enrollments", "rollKeys", "exams", "marks", "attendance", "staffAttendance", "leaveRequests", "feeStructures", "payments", "notices", "timetable", "homework", "calendar", "books", "loans", "behaviour", "visitors", "substitutions", "routes", "transportRiders", "activities", "activityMembers", "inventory", "alumni", "expenses", "certificates", "tickets", "staffDirectory", "vendors", "minutes", "lostFound", "concessions", "achievements", "complaints", "assets", "sales", "syllabus", "trainings", "diary", "healthRecords", "lessonPlans", "ptmSlots", "payroll", "messages", "enquiries", "eventRegistrations", "familyAccess", "classTeachers", "auditLog", "scholarships", "scholarshipApps", "consentForms", "consentResponses", "staffProfiles", "hostelRooms", "hostelStays", "canteenMenu", "canteenPlans", "bookReservations", "workflowRules", "questionBank", "onlineTests", "onlineTestKeys", "onlineAttempts", "pickupPeople", "pickupLogs", "settings"];
const KEEP_BACKUPS = 14;

// Timestamps become { __ts: ISO text } so the file is plain JSON.
const plain = (value) => {
  if (value instanceof Timestamp) return { __ts: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  return value;
};
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

async function backUpSchool(bucket, schoolId) {
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
  const old = files.map((item) => item.name).sort().reverse().slice(KEEP_BACKUPS);
  await Promise.all(old.map((name) => bucket.file(name).delete().catch(() => {})));
  await db.doc('schools/' + schoolId + '/settings/autoBackup').set({ date, docs, bytes: Buffer.byteLength(body), ok: true, path, verified: true });
  return docs;
}

exports.nightlyBackup = onSchedule({ schedule: '30 2 * * *', timeZone: 'Asia/Kolkata', memory: '1GiB', timeoutSeconds: 540, retryCount: 2 }, async () => {
  const bucket = getStorage().bucket();
  const schools = await db.collection('schools').select().get();
  const failed = [];
  let done = 0;
  for (const school of schools.docs) {
    // One school failing never stops the others.
    try {
      await backUpSchool(bucket, school.id);
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
