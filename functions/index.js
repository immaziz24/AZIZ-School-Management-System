// AZIZ School Management System: server-side jobs (Batch 64).
// 1. nightlyBackup: every night, copies each school's records to a file in Cloud Storage, reads the file back to check it,
//    keeps the newest 14 files per school and records the result in schools/<id>/settings/autoBackup.
// 2. pushOnNotice: sends a phone notification to linked families when a school posts a notice for families, all or a class.
// 3. pushOnFeeReminder: sends a phone notification to the family of a student when the owner sends a fee reminder.
// Deploy with: firebase deploy --only functions
const { onSchedule } = require('firebase-functions/v2/scheduler');
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

const BACKUP_COLLECTIONS = ["studentHistory", "storageRecords", "members", "students", "academicYears", "classes", "sections", "subjects", "classSubjects", "enrollments", "rollKeys", "exams", "marks", "attendance", "staffAttendance", "leaveRequests", "feeStructures", "payments", "notices", "timetable", "homework", "calendar", "books", "loans", "behaviour", "visitors", "substitutions", "routes", "transportRiders", "activities", "activityMembers", "inventory", "alumni", "expenses", "certificates", "tickets", "staffDirectory", "vendors", "minutes", "lostFound", "concessions", "achievements", "complaints", "assets", "sales", "syllabus", "trainings", "diary", "healthRecords", "lessonPlans", "ptmSlots", "payroll", "messages", "enquiries", "eventRegistrations", "familyAccess", "classTeachers", "auditLog", "scholarships", "scholarshipApps", "consentForms", "consentResponses", "staffProfiles", "hostelRooms", "hostelStays", "canteenMenu", "canteenPlans", "bookReservations", "workflowRules", "questionBank", "onlineTests", "onlineTestKeys", "onlineAttempts", "pickupPeople", "pickupLogs", "settings"];
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
