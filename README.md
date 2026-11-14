# AZIZ School Management System

AZIZ is a multi-school platform with a shared application and school-specific websites and dashboards. The roadmap covers 111 planned feature groups across 13 categories and 10 phases (0–9).

## Phase 0 — Platform foundation design

The working stack is PHP and MySQL. The first implementation milestone is to provision two fictional schools and verify that each school's users can access only their own records.

| Record | Purpose |
| --- | --- |
| Schools | Stable school ID, unique slug, and provisioning status |
| School domains | Globally unique hostnames mapped to schools, with verification and activation status |
| School themes | School-scoped branding and website presentation settings |
| Users | Login identity shared across the platform |
| Memberships | School-scoped user roles and access status |
| Subscriptions and plan features | Commercial status and feature entitlements checked on the server |
| Audit logs | School context, actor, action, and timestamp for privileged operations |
| Provisioning jobs | Retryable setup operations with a unique request identifier |

Resolve public website requests using a known active hostname. For dashboard requests, verify an active membership against the resolved school before reading or writing school data. Include the school ID in school-owned records and use school-scoped references between them. Platform administrator actions require a separate authorization check and an audit entry.

Create the school, initial owner membership, and default settings in one transaction. A repeated provisioning request must return the original result without creating another school. Activate custom domains only after ownership verification.

## Phase 1 acceptance checks

- Provision two fictional schools with distinct settings and owners.
- Repeat the same provisioning request and verify that it creates no duplicates.
- Verify that a School A user cannot access School B records through a direct URL, a modified request, or a guessed record ID.
- Verify that an unknown hostname cannot resolve to a school and that an inactive membership cannot open protected routes.

## Feature 111 — Biometric Fingerprint Attendance

Category E, Attendance & Daily Operations. Planned for Phase 8, using the basic staff attendance records from Phase 4.

The integration covers teachers and non-teaching staff, compatible device setup per school, secure event synchronization, automatic check-in and check-out, late arrivals and early departures, teacher working hours, leave and absence, daily and monthly reports, and School Owner and Principal monitoring. Payroll integration is optional. The design calls for consent management and keeping fingerprint templates on compatible devices while synchronizing attendance events to AZIZ.
