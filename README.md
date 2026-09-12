# 📚 Prior Art

> A smart academic resource marketplace built for the **SLAB WebCMD Hackathon**.

Prior Art is a student-focused platform for uploading, discovering, and sharing academic resources such as notes, previous-year papers, assignments, lab manuals, and other study material.

The goal is simple: instead of searching through scattered WhatsApp groups, Telegram chats, Google Drive links, and old messages, students can find useful academic resources in one organized platform.

---

## 🚀 Why Prior Art?

Students regularly face the same problem:

- Important notes are buried in chat groups.
- Previous-year papers are difficult to find.
- Useful resources are scattered across different drives and folders.
- Students often don't know what a file contains before downloading it.
- Searching by filenames alone isn't always enough.

**Prior Art brings these resources together into a structured, searchable platform.**

The project also explores how AI can help automatically understand uploaded academic material and make resource discovery easier.

---

## ✨ Features

### 📤 Upload Academic Resources

Students can upload academic resources such as:

- Notes
- Previous-year papers
- Assignments
- Lab manuals
- Question papers
- Study material
- Images and documents

Uploaded files are stored and processed by the backend.

### 🤖 AI-Powered Resource Understanding

When a resource is uploaded, the backend extracts text from supported documents and sends the content for AI analysis.

The AI can help determine information such as:

- Subject
- Course
- Resource type
- Title
- Description
- Academic relevance
- Tags

This makes uploaded resources easier to organize and discover.

### 📄 Document Text Extraction

Prior Art supports text extraction from multiple formats.

Supported formats include:

- `.pdf`
- `.docx`
- `.txt`
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

For image-based resources, OCR is used to extract readable text.

For scanned PDFs, the system can render pages and process them using OCR.

### 🔎 Resource Discovery

Students can browse available resources and search for academic material through the platform.

The architecture is designed to evolve toward semantic search, allowing resources to be discovered based on their meaning rather than only exact keywords.

### ⭐ Karma System

Students can contribute useful resources and earn karma.

This encourages students to contribute valuable material and helps create a community-driven academic resource ecosystem.

### 🔐 Authentication

The application includes user authentication using JWT-based sessions.

Authenticated users can interact with the platform according to their account permissions.

### ☁️ Flexible File Storage

The backend supports:

- Local file storage for development
- S3-compatible object storage for production

This allows the application to move from a local development environment to cloud deployment without redesigning the entire storage layer.

---

# 🧠 AI Architecture

Prior Art is designed around multiple AI components with different responsibilities.

```text
                    ┌──────────────────┐
                    │   Student Upload │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Text Extraction  │
                    │   + OCR          │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   AI Analysis    │
                    │ Classification   │
                    │   + Metadata     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │      MySQL       │
                    │ Resource Metadata│
                    └──────────────────┘
