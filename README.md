# 🧰 Toolbox — System Design Interview Study App

A self-hosted web application for preparing for software engineering system design interviews. Built with React and Node.js, designed to run on your own infrastructure.

## Features

- **📖 Guide** — Structured study material organized by 5 pillars covering compute, storage, protocols, observability, and architectural paradigms. Each topic follows a consistent blueprint with AI-powered Q&A.
- **🎨 Interactive Builder** — Whiteboard canvas with a toolbox of system components. Drag, drop, and connect components to practice architecture design. AI verification to check your work.
- **📚 Flashcards** — Create, edit, and study flashcard decks. AI-powered card generation from topic descriptions. Flip-card UI with shuffle and progress tracking.
- **⚙️ Settings** — Configure your Gemini API key, export/import data, and manage preferences.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, React Router, Zustand |
| Backend | Node.js, Express |
| Database | SQLite (better-sqlite3) |
| AI | Google Gemini API |
| Deployment | Docker |

## Quick Start (Development)

```bash
# Install dependencies
npm install

# Start development server (frontend + backend)
npm run dev
```

Frontend runs at `http://localhost:5173`, backend API at `http://localhost:3100`.

## Deployment (Docker)

### Option 1: Docker Compose (Recommended)

```bash
# Clone and configure
cp .env.example .env
# Edit .env to add your GEMINI_API_KEY

# Build and run
docker compose up -d

# Access at http://your-server:3100
```

### Option 2: Docker Build

```bash
docker build -t toolbox .
docker run -d \
  --name toolbox \
  -p 3100:3100 \
  -v toolbox-data:/app/data \
  -e GEMINI_API_KEY=your-key-here \
  toolbox
```

### Proxmox LXC Deployment

1. Create a new LXC container (Debian/Ubuntu) with Docker installed
2. Clone this repository into the container
3. Copy `.env.example` to `.env` and set your `GEMINI_API_KEY`
4. Run `docker compose up -d`
5. Access via `http://<lxc-ip>:3100`

> **Tip:** You can also set the API key through the Settings page in the UI after deployment.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `DB_PATH` | `./data/toolbox.db` | SQLite database file path |
| `GEMINI_API_KEY` | — | Google Gemini API key (can also be set via UI) |

## Project Structure

```
toolbox/
├── server/           # Express backend
│   ├── index.js      # Server entry point
│   ├── db.js         # SQLite setup & migrations
│   └── routes/       # API route handlers
├── src/              # React frontend
│   ├── components/   # Reusable UI components
│   ├── pages/        # Page-level components
│   ├── stores/       # Zustand state management
│   └── utils/        # Constants and API client
├── Dockerfile        # Multi-stage Docker build
└── docker-compose.yml
```

## License

MIT
