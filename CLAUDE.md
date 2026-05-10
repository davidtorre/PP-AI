# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

## Commands

### Local Development
```bash
cd backend && npm run dev        # Backend (tsx watch, port 3001)
cd frontend && npm run dev       # Frontend (Vite, port 5173)
cd backend && npm run seed       # Populate DB with test data
```

### Build
```bash
cd frontend && npm run build     # Vite → dist/
cd backend && npm run build      # tsc → dist/
cd backend && npm start          # Run built backend
```

### Docker
```bash
docker compose up -d --build              # Full stack
docker compose -f docker-compose.dev.yml up  # Dev override
make up-seed                              # Compose up + seed DB
make logs                                 # Tail all logs
```

### Type Checking / Lint
```bash
cd frontend && npx tsc --noEmit   # Type-check frontend
cd backend && npx tsc --noEmit    # Type-check backend
```

## Architecture

### Stack
- **Frontend**: React 18 + TypeScript, Vite, Zustand, Tailwind CSS, React Router 7
- **Backend**: Node.js 22, Express 4, TypeScript (tsx for dev, tsc for prod)
- **Database**: PostgreSQL 16 via `pg` (no ORM — raw SQL helpers)
- **Auth**: JWT (`jsonwebtoken`) + bcrypt; optional Google OAuth

### Project Layout
```
frontend/src/
  App.tsx              # All routes (public + protected)
  store/               # Zustand stores: authStore, uiStore, langStore
  services/api.ts      # Centralized fetch wrapper; adds Bearer token; auto-logout on 401
  pages/               # Top-level route components
  components/          # Feature-grouped UI (gantt/, kanban/, tasks/, etc.)
  i18n/translations.ts # All UI strings (ES/EN)

backend/src/
  server.ts            # Express setup, route registration, DB init, cron start
  db/
    database.ts        # getOne(), getAll(), run() helpers over pg Pool
    schema.sql         # Idempotent DDL (ALTER TABLE IF NOT EXISTS blocks)
  routes/              # One file per resource (tareas, proyectos, ai, etc.)
  middleware/          # verifyToken, requireRole
  utils/
    actividad.ts       # Activity log writer
    progreso.ts        # Weighted progress calculation
  services/mail.ts     # Nodemailer SMTP (optional)
  jobs/reminders.ts    # node-cron reminder emails
```

### Key Data Model
- **programas → proyectos → tareas** (3-level hierarchy; tareas are self-referential via `tarea_padre_id`)
- **hitos** — milestones tied to proyectos; `gantt_orden FLOAT` for interleaving with tasks in Gantt
- **sprints** — group tareas; independent of hitos
- **dependencias** — task-to-task (fin_a_inicio, inicio_a_inicio, fin_a_fin)
- **ai_config** — single-row table for Azure OpenAI or Groq credentials
- Progress: each tarea has `porcentaje_avance` (0–100) and `peso`; `utils/progreso.ts` aggregates upward

### Frontend Data Flow
1. `authStore.login()` → `POST /api/auth/login` → stores JWT + user in localStorage
2. `services/api.ts` reads token from localStorage, injects `Authorization: Bearer` on every request
3. 401 response → auto-logout + redirect to `/login`
4. Views (Gantt, Kanban, Calendar, Table) share the same task data; swapped via view-mode toggle in `ProyectoDetailPage`

### Multi-View Architecture
All four project views (Gantt, Kanban, Calendar, MondayTable) live under `frontend/src/components/` and receive the same props from `ProyectoDetailPage`. The Gantt uses `gantt-task-react` extended with drag-and-drop for milestones, resizable columns, and dark mode.

### Backend Route Pattern
Every route file exports an Express `Router`. Auth middleware (`verifyToken`) is applied globally in `server.ts`; role checks (`requireRole`) are per-route. Database access goes through the three helpers in `db/database.ts` — never raw `pg.Pool` directly in route files.

### Environment Variables
Copy `backend/.env.example`. Minimum required: `JWT_SECRET`, `DB_*`. Email and Google OAuth are opt-in via `ENABLE_EMAIL=true` and `GOOGLE_CLIENT_ID/SECRET`.

### Default Test Accounts (after seed)
- admin@app.com / admin123
- editor@app.com / editor123
- viewer@app.com / viewer123
