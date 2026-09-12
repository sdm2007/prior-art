# Prior Art

Prior Art is a full-stack student resource marketplace. Students can upload, discover, search, vote on, comment on, report, and download academic resources. The application also uses AI to classify uploaded material and improve resource search.

> **Beginner note:** This repository contains the source code. Secrets such as API keys and real passwords belong in a local `.env` file and must never be committed to GitHub.

## Features

- Student registration and login
- Course and semester-based resource browsing
- Full-text resource search with MySQL
- AI-assisted resource classification
- AI-assisted resource search
- Upload processing in the background
- PDF, DOCX, TXT and image text extraction
- OCR for images and scanned PDFs
- Duplicate detection using SHA-256
- Voting and comments
- Resource reports and moderation
- Karma and download history
- Admin moderation tools
- MySQL-backed job queue with retries
- Local file storage for development
- S3-compatible object storage support for deployment

## Technology

- React + Vite
- Node.js + Express
- MySQL
- Anthropic API
- S3-compatible object storage
- Tesseract OCR
- PDF/DOCX text extraction

## Project structure

```text
prior-art/
├── src/                 # React frontend
├── server/              # Express backend and background worker
├── index.html           # Frontend entry HTML
├── package.json         # Project dependencies and commands
├── vite.config.js       # Vite configuration
├── schema.mysql.sql     # MySQL setup helper
├── .env.example         # Safe configuration template
├── .gitignore           # Files that should not be uploaded to GitHub
└── README.md            # This file
```

## Running locally

These instructions are intentionally written for beginners.

### 1. Install Node.js

Install a current LTS version of Node.js from the official Node.js website.

After installing, open a terminal in this project folder and check:

```bash
node --version
npm --version
```

### 2. Install MySQL

Install MySQL 8.x and make sure the MySQL server is running.

Create a database/user using the SQL in `schema.mysql.sql`, or use a MySQL account you already created for this project.

### 3. Create your local environment file

Make a copy of `.env.example` and name the copy `.env`.

Put your real MySQL password and Anthropic API key in `.env`.

**Do not commit `.env`.** It is intentionally ignored by Git.

### 4. Install project packages

```bash
npm install
```

### 5. Start the app

```bash
npm run dev
```

The development frontend runs on port 5173 and the backend runs on port 3000. Vite forwards `/api` requests to the backend.

### 6. Production build

```bash
npm run build
npm start
```

## Important notes

### Anthropic API key

The API key is used only by the backend. Never put it directly inside React/frontend code.

### Uploaded files

Local uploaded files are stored in the `uploads/` directory when local storage is enabled. This directory is ignored by Git.

### OCR dependency

Scanned-PDF OCR uses Poppler's `pdftoppm` command and Tesseract. If you use scanned PDFs locally, those system programs must also be installed on your computer.

### Production deployment

For a real deployment, use a strong `JWT_SECRET`, a managed MySQL database, S3-compatible object storage, HTTPS, and a properly configured Anthropic API key. Do not use development passwords or secrets.

## Learning goals

This project is also a learning project. It demonstrates concepts including:

- React components and state
- HTTP APIs
- Authentication
- SQL databases
- File uploads
- Background jobs
- AI API integration
- OCR
- Search
- Authorization and basic application security

## License

MIT License. See `LICENSE`.
