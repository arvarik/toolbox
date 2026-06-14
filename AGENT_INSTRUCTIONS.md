# Agent Instructions & Codebase Context

Welcome, future AI Agent! This file contains important context and rules for working on the **Toolbox** repository to ensure consistency and prevent regressions.

## Project Overview
Toolbox is a self-hosted web application for preparing for software engineering system design interviews.
It has features like Study Guides, an Interactive Architecture Builder, Flashcards (with Spaced Repetition), and a globally persistent Pomodoro Timer.

## Tech Stack
- **Frontend**: React 19, Vite, React Router DOM v6
- **State Management**: Zustand (persisted stores)
- **Styling**: Vanilla CSS (CSS Variables defined in `index.css`)
- **Backend**: Node.js, Express
- **Database**: SQLite (`better-sqlite3`)
- **Icons**: `lucide-react`
- **AI Integration**: Google Gemini API

## Critical Rules for Agents
1. **NO TAILWIND CSS**: Do not use Tailwind CSS utility classes (e.g., `flex`, `items-center`, `text-blue-500`). This project uses vanilla CSS with predefined CSS variables (like `var(--color-primary)`, `var(--space-2)`). Use standard inline styles or add classes to `index.css` if necessary.
2. **Icons**: Always import icons from `lucide-react` instead of writing custom SVGs or using other libraries.
3. **Global State**: For features that require cross-page persistence (like the Pomodoro Timer or API Keys), use Zustand stores located in `src/stores/`.
4. **Backend/Database Changes**: If you modify the database schema or add new endpoints, ensure you update `server/db.js` and `server/index.js` or `server/routes/`.
5. **UI Consistency**: Follow the existing UI patterns. Use `btn`, `btn-primary`, `btn-ghost`, `input`, and `card` classes which are already defined in `index.css`.
6. **Responsiveness**: Use the CSS variables for spacing and typography. The app is designed to be mobile-responsive (check `MobileDrawer.jsx`, `BottomNav.jsx`, and media queries in `index.css`).

## Key Directories
- `src/components/layout/`: Global layout components (Sidebar, BottomNav, Modals)
- `src/components/shared/`: Reusable components (MarkdownRenderer, Loading spinners)
- `src/pages/`: Main route components
- `src/stores/`: Zustand global state managers
- `server/`: Backend API and database logic

## How to Test
- `npm run dev` starts both the frontend and backend servers.
- `npm run build` verifies the frontend builds successfully for production.

Happy coding!
