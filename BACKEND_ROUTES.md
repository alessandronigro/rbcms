# RBCMS Backend Routes Documentation

This document provides a comprehensive overview of the backend API routes available in the RBCMS application. The API is built using Node.js and Express.

## Base URL
All routes are prefixed with `/api`.

## 1. Authentication (`/api/auth`)
Handles generic authentication and convention-specific sessions.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **POST** | `/login` | Authenticate using a convention code. | `code` (string) | `{ success, role, cookie: conv_session }` |
| **GET** | `/me` | Get current session info. | - | `{ authenticated, user: { ... } }` |
| **POST** | `/logout` | Logout the current session. | - | `{ success: true }` |
| **GET** | `/autologin` | Generate auto-login page for external platforms. | `token` (query, encrypted) | HTML Form (Auto-submitting) |

## 2. Admin Dashboard (`/api/admin`)
Provides statistics and data for the dashboard.

| Method | Endpoint | Description | Input (Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/stats` | Statistics for charts and deadline counters. | `db` (opt), `mese` (opt) | `{ chart, corsi, scadenze, deadlines, dailyLogins, activeLast10 }` |

## 3. Users (`/api/utenti`)
Manages user searching and synchronization across databases.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/multi` | Search users across multiple databases (`newformazionein`, `forma4`, `formazionecondorb`). | `q` (query) - Name, Email, or Tax ID | List of users with source DB info. |
| **POST** | `/client-sync-password` | Sync user password across system. | `iduser`, `newPassword` | `{ success: true/false }` |
| **GET** | `/:id` | Get single user details by ID. | `db` (query) | User object |

## 4. Enrollments (`/api/iscrizioni`)
Handles new enrollments, Excel imports, and web orders.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **POST** | `/weborders` | Process Web Orders (e.g. from WooCommerce). | `orders` (array) | Result status for each order. |
| **POST** | `/excel` | Import enrollments from normalized Excel JSON. | `rows` (array), `db`, `convenzione` | Import results. |
| **POST** | `/sync-fatturazione` | Sync billing fields for an order. | `order_id` | `{ success: true }` |
| **DELETE** | `/order/:id` | Delete an order (and associated users if needed). | - | `{ success: true }` |
| **GET** | `/order/:id/corsisti` | Get attendees/students for a specific order. | - | List of corsisti. |
| **PATCH** | `/corsisti/:id` | Update single attendee data. | `firstname`, `lastname`, `email`, etc. | `{ success: true }` |

## 5. Courses Management (`/api/corsi`)
Manage active courses, user status, and technical fixes.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **POST** | `/sospendi` | Suspend/Activate a user in a course. | `db`, `iduser`, `idcourse`, `status` | `{ success: true }` |
| **DELETE** | `/utenti/:db/:iduser` | Delete user completely (GDPR/Cleanup). | - | `{ success: true }` |
| **DELETE** | `/:db/:iduser/:idcourse` | Cancel specific course enrollment. | - | `{ success: true }` |
| **POST** | `/sblocca` | Unblock course (set status 'completed'). | `db`, `iduser` | `{ success: true }` |
| **POST** | `/reinvia-mail` | Resend enrollment email. | `db`, `iduser`, `idcourse`, `email` | `{ success: true }` |
| **GET** | `/info` | Get course status info for user. | `db`, `iduser`, `idcourse` | Course details (dates, certificate status). |
| **GET** | `/gettime` | Generate Time/Activity Report PDF. | `db`, `iduser`, `idcourse` | PDF File Download. |
| **GET** | `/getlasttest` | Generate Test Report PDF. | `db`, `iduser`, `idcourse` | PDF File Download. |
| **POST** | `/normalize-time` | Fix/Normalize tracking time for a user. | `db`, `iduser`, `idcourse`, `extraHours`| `{ updated, beforeHours, afterHours }` |
| **POST** | `/cambiaslide` | Force slide location (Scorm). | `db`, `iduser`, `selectedOrg`, `newLessonLocation` | `{ success: true }` |
| **POST** | `/ricrea-test` | Reconstruct test attempts. | `db`, `iduser`, `idcourse` | `{ success: true }` |
| **GET** | `/deleteautocert` | Delete self-declaration/certificate assignment. | `db`, `iduser`, `idcourse` | Status message. |

## 6. Certificates (`/api/attestati`)
Generation and sending of certificates.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **POST** | `/generate` | Generate DOCX/PDF certificate. | `iduser`, `idcourse`, `db`, `template` | `{ file, filename }` |
| **POST** | `/sendcertificate` | Email certificate to user. | `iduser`, `idcourse`, `db` | `{ success: true }` |

## 7. Invoices (`/api/fatture`)
Manage Electronic Invoices (Aruba/SDI).

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/:which` | List invoices (`ricevute` or `ricevutenew`). | `month`, `year` | List of invoices + Summary. |
| **PATCH** | `/:which/:id/read` | Mark invoice as read. | - | `{ success: true }` |
| **POST** | `/:which/zip` | Download ZIP of month's invoices. | `month`, `year` | `{ zip_url }` |
| **GET** | `/:which/file/:type/:name` | Serve XML/HTML/Attachment file. | - | File Content. |

## 8. Reports (`/api/report`)
Data reporting for Analysis.

| Method | Endpoint | Description | Input (Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/questionari` | Report on polls/questionnaires. | `from`, `to`, `idcourse`, `convenzione` | JSON Rows. |
| **PATCH** | `/questionari/attiva` | Toggle answer visibility/state. | `id_track`, `attiva` | `{ success: true }` |
| **GET** | `/convenzione` | Report of users for a convention. | `from`, `to`, `idcourse` | JSON Rows. |
| **GET** | `/convenzione/corsi` | List of courses available to convention. | - | List of grouped courses. |
| **GET** | `/data` | Sales & Revenue Report. | `datequest`, `datequest2`, `idcourse` | JSON Sales data. |

## 9. 60h Course Calendar (`/api/finecorso60h`)
Specific logic for "60 Ore" course exams and sessions.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/sessione` | List exam sessions. | `db` | List of sessions. |
| **POST** | `/sessione` | Create new session. | `db`, `date`, `time` | `{ success: true }` |
| **POST** | `/sessione/:id/conferma` | Confirm session. | - | `{ success: true }` |
| **POST** | `/sessione/:id/zoom` | Create Zoom meeting for session. | - | `{ join_url, start_url }` |

## 10. Admin Course Calendar (`/api/finecorsoamm`)
Specific logic for Admin course exams. Similar structure to `finecorso60h` but targetting Admin courses.

## 11. Public Slots (`/api/public-slots`)
Public booking system configuration.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/settings` | Get slot settings (holidays, max slots). | `calendar` | Settings object. |
| **POST** | `/settings` | Save slot settings. | `settings` | `{ success: true }` |
| **GET** | `/available` | Get computed available slots. | `date` | List of slots. |
| **POST** | `/book` | Book a specific slot. | `date`, `time`, `user` | Confirmation. |

## 12. Reminders (`/api/reminder`)
Email reminder campaigns.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/users` | Get users matching filters. | `period`, `course`, `status`, `conditions` | `{ users, total }` |
| **GET** | `/presets/:key` | Get users by preset (ivass/oam). | - | `{ users, total }` |
| **POST** | `/send` | Send bulk emails. | `recipients`, `subject`, `body` | `{ success: true }` |

## 13. Mail Format (`/api/mailformat`)
Manage HTML templates for emails.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/list` | List available templates. | - | Grouped templates keys. |
| **GET** | `/:key` | Get HTML content. | - | HTML string. |
| **POST** | `/:key` | Update HTML content. | Body text | `{ success: true }` |
| **GET** | `/:key/subject` | Get subject line. | - | `{ subject }` |
| **POST** | `/:key/subject` | Update subject line. | `subject` | `{ success: true }` |

## 14. Mail Check (`/api/mailcheck`)
Debug and verification tools for Brevo emails.

| Method | Endpoint | Description | Input (Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/welcome` | Check 'Welcome' email status. | `email` | Brevo Logs. |
| **GET** | `/december` | Check year-end enrollment emails. | `year`, `month` | User list with mail status. |

## 15. Completed Courses (`/api/finecorso`)
Manage users who have finished courses.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/list` | List completed users. | `year`, `cat` | List of rows. |
| **POST** | `/evaso` | Mark as Processed/Sent. | `evaso` (1/0), `note` | `{ success: true }` |

## 16. Simulation (`/api/simulazione`)
User progress cloning and simulation for testing.

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **POST** | `/check` | Verify target users for cloning. | `userIds`, `courseId` | List of targets & candidates. |
| **POST** | `/run` | execute cloning of progress. | `userIds`, `courseId`, `donor*` | Results log. |

## 17. Monitor (`/api/monitor`)

| Method | Endpoint | Description | Output |
| :--- | :--- | :--- | :--- |
| **GET** | `/mysql/connections` | Get MySQL Pool statistics. | Pool stats object. |

## 18. Conventions (`/api/convenzioni`)

| Method | Endpoint | Description | Input (Body/Query) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/` | List all conventions. | - | List of objects. |
| **GET** | `/cities` | Lookup cities. | - | List. |
| **GET** | `/provinces` | Lookup provinces. | - | List. |
