# Task Review Tracking System (TRTS) - Implementation Plan

## Project Overview
A web-based platform for managing review tasks where participants claim slots, submit completions, and admins approve work for credit rewards.

## Current State
- Monorepo structure with npm workspaces already configured
- Empty `apps/api` and `apps/frontend` directories ready for scaffolding
- Root package.json with workspace scripts for dev, build, db migrations

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Knex.js |
| Auth | Passport.js + JWT |
| Email | Nodemailer + SMTP |
| File Upload | Local filesystem (`/uploads`) |
| Frontend | React + Vite + TypeScript |
| Styling | TailwindCSS |
| State | Zustand + React Query |
| API Docs | Swagger/OpenAPI |
| API Client | openapi-typescript (generated types) |

---

## Implementation Phases

### Phase 1: Backend Scaffolding (`apps/api`)

**Files to create:**
- `apps/api/package.json` - Dependencies and scripts
- `apps/api/tsconfig.json` - TypeScript config
- `apps/api/src/index.ts` - Entry point with Express setup
- `apps/api/src/config/database.ts` - Knex configuration
- `apps/api/src/config/passport.ts` - Passport JWT strategy
- `apps/api/src/config/swagger.ts` - OpenAPI spec setup

**Directory structure:**
```
apps/api/
├── src/
│   ├── config/          # Database, passport, swagger, env
│   ├── controllers/     # Route handlers
│   ├── middleware/      # Auth, validation, error handling, upload
│   ├── routes/          # Express routes with OpenAPI decorators
│   ├── services/        # Business logic, email service
│   ├── types/           # TypeScript interfaces
│   └── index.ts
├── migrations/          # Knex migrations
├── seeds/               # Seed data (admin user)
├── uploads/             # File upload storage
├── knexfile.ts
└── package.json
```

**Key dependencies:**
- express, cors, helmet
- knex, pg
- passport, passport-jwt, jsonwebtoken, bcryptjs
- nodemailer
- multer (file uploads)
- swagger-jsdoc, swagger-ui-express
- zod (validation)
- dotenv

---

### Phase 2: Database Migrations

**Migration files:**
1. `001_create_users.ts`
2. `002_create_tasks.ts`
3. `003_create_participations.ts`
4. `004_create_credit_transactions.ts`
5. `005_create_user_guide.ts`

**Schema Design:**

```sql
-- users
id, email (unique), password_hash, full_name, contact_number,
role (participant|admin), credit_balance, created_at, updated_at

-- tasks
id, name, target_url, max_participants, credit_reward,
start_date, end_date, customer_name, customer_contact, instructions,
status (draft|active|completed|expired),
payment_received, payment_completed,
created_by, created_at, updated_at

-- participations
id, user_id, task_id, status (claimed|submitted|approved|rejected),
submission_text, submission_file, submitted_at,
reviewed_by, reviewed_at, review_comment,
created_at, updated_at

-- credit_transactions
id, user_id, amount (+/-), type (reward|payment|adjustment),
description, task_id (nullable), created_by, created_at

-- user_guide
id, content (text/markdown), updated_by, updated_at
```

---

### Phase 3: API Endpoints

**Auth Routes (`/api/auth`)**
- `POST /register` - Create account
- `POST /login` - Get JWT token
- `POST /forgot-password` - Send reset email
- `POST /reset-password` - Update password

**User Routes (`/api/users`)**
- `GET /me` - Get profile
- `PUT /me` - Update profile
- `GET /me/credits` - Balance + transaction history
- `GET /me/tasks` - My participations

**Task Routes (`/api/tasks`)**
- `GET /` - List tasks (with filters: available, all)
- `GET /:id` - Task detail
- `POST /:id/claim` - Claim slot
- `POST /:id/submit` - Submit completion (with file upload)

**Admin Routes (`/api/admin`)**
- `GET /tasks` - All tasks
- `POST /tasks` - Create task (triggers email to all users)
- `PUT /tasks/:id` - Edit task (only before first claim)
- `DELETE /tasks/:id` - Delete task (only if no participants)
- `GET /reviews` - Pending submissions
- `POST /reviews/:id/approve` - Approve + award credits
- `POST /reviews/:id/reject` - Reject with reason
- `POST /reviews/:id/request-info` - Request clarification
- `POST /payments` - Mark participants as paid (bulk)
- `GET /guide` - Get user guide
- `PUT /guide` - Update user guide
- `GET /users` - List all users

---

### Phase 4: Email Service

**Service file:** `apps/api/src/services/emailService.ts`

**Email templates:**
1. `newTaskNotification` - New task available
2. `slotConfirmation` - Slot claimed successfully
3. `submissionReceived` - Sent to admins
4. `approvalNotification` - Task approved, credits added
5. `rejectionNotification` - Submission rejected
6. `infoRequestNotification` - More info needed
7. `paymentNotification` - Payment processed
8. `expiryReminder` - Task expiring soon (scheduled)
9. `passwordReset` - Reset password link

---

### Phase 5: Frontend Scaffolding (`apps/frontend`)

**Files to create:**
- `apps/frontend/package.json`
- `apps/frontend/vite.config.ts`
- `apps/frontend/tailwind.config.js`
- `apps/frontend/tsconfig.json`

**Directory structure:**
```
apps/frontend/
├── src/
│   ├── api/             # Generated OpenAPI types + fetch wrapper
│   ├── components/
│   │   ├── ui/          # Button, Input, Card, Modal, etc.
│   │   ├── forms/       # Form components
│   │   └── layout/      # Header, Sidebar, Footer
│   ├── hooks/           # useAuth, useTasks, etc.
│   ├── pages/
│   │   ├── auth/        # Login, Register, ForgotPassword
│   │   ├── dashboard/   # Main dashboard
│   │   ├── tasks/       # TaskList, TaskDetail
│   │   ├── admin/       # AdminDashboard, Reviews, TaskEditor
│   │   └── guide/       # UserGuide page
│   ├── stores/          # Zustand stores (auth, ui)
│   ├── lib/             # Utils, constants
│   └── main.tsx
├── public/
└── index.html
```

**Key dependencies:**
- react, react-dom, react-router-dom
- @tanstack/react-query
- zustand
- tailwindcss, @headlessui/react
- openapi-typescript, openapi-fetch
- react-hook-form, zod
- lucide-react (icons)

---

### Phase 6: Frontend Pages

**Public Pages:**
- Login page with form
- Register page with form
- Forgot password page
- Reset password page

**Participant Pages:**
- Dashboard (task overview, credit balance)
- Available Tasks (card/table view)
- Task Detail (view, claim, submit)
- My Tasks (participations list)
- Credit History (transactions table)
- User Guide (rendered markdown)

**Admin Pages:**
- Admin Dashboard (stats overview)
- Task Management (CRUD table)
- Task Editor (create/edit form)
- Pending Reviews (submission queue)
- Review Detail (approve/reject/request-info)
- Payment Processing (bulk mark paid)
- User Guide Editor (markdown editor)
- User Management (list users)

---

## File Execution Order

### Step 1: Backend Setup
1. Create `apps/api/package.json` with dependencies
2. Create TypeScript and Knex configs
3. Create folder structure and entry point
4. Set up Passport JWT authentication
5. Configure Swagger/OpenAPI

### Step 2: Database
1. Create all migration files
2. Create seed file for admin user
3. Run migrations

### Step 3: API Implementation
1. Auth controller + routes
2. User controller + routes
3. Task controller + routes
4. Admin controller + routes
5. Email service integration

### Step 4: Frontend Setup
1. Create `apps/frontend/package.json`
2. Configure Vite + TailwindCSS
3. Generate OpenAPI types
4. Set up React Query + Zustand

### Step 5: Frontend Implementation
1. Layout components (Header, Sidebar)
2. Auth pages + flow
3. Task pages
4. Admin pages
5. User guide page

---

## Verification Plan

1. **Backend verification:**
   - `npm run dev:api` - Server starts on port 3000
   - Visit `http://localhost:3000/api-docs` - Swagger UI loads
   - Test auth endpoints with curl/Postman

2. **Database verification:**
   - `npm run db:migrate` - Migrations run successfully
   - `npm run db:seed` - Admin user created
   - Connect to PostgreSQL and verify tables

3. **Frontend verification:**
   - `npm run dev:frontend` - Vite dev server starts
   - Login as admin
   - Create a task → verify email sent
   - Register as participant → claim task → submit
   - Admin approves → credits added

4. **Email verification:**
   - Configure SMTP (e.g., Mailtrap for testing)
   - Trigger each email event
   - Verify email content and delivery

---

## Environment Variables Required

```env
# apps/api/.env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/trts
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASS=your-password
SMTP_FROM=noreply@example.com

# Frontend URL (for email links)
FRONTEND_URL=http://localhost:5173
```
