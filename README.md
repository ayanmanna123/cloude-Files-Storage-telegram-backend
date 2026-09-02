<div align="center">

<img src="https://img.shields.io/badge/🚀_Cloud_Backend-API_Server-1e293b?style=for-the-badge&labelColor=0f172a" alt="Cloud Backend Logo" />

# Cloud-Based Media Files Storage API

### Robust, Secure, and High-Performance Backend Infrastructure

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18.x-43853D?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express.js-5.x-000000?style=flat-square&logo=express&logoColor=white" alt="Express.js" />
  <img src="https://img.shields.io/badge/Supabase-Database-3ECF8E?style=flat-square&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome" />
</p>

<p align="center">
  <a href="#-overview"><b>Overview</b></a> ·
  <a href="#-features"><b>Features</b></a> ·
  <a href="#️-tech-stack"><b>Tech Stack</b></a> ·
  <a href="#️-architecture"><b>Architecture</b></a> ·
  <a href="#️-installation--setup"><b>Quick Start</b></a>
</p>

<br/>

</div>

## 📋 Table of Contents

| | | |
|---|---|---|
| [✨ Overview](#-overview) | [🚀 Features](#-features) | [🛠️ Tech Stack](#️-tech-stack) |
| [🏗️ Architecture](#️-architecture) | [📂 Project Structure](#-project-structure) | [⚙️ Installation](#️-installation--setup) |
| [🤝 Contributing](#-contributing) | [📜 License](#-license) | [📞 Contact](#-contact) |

<br/>

## ✨ Overview

> **Cloud-Based Media Files Storage API** is the powerhouse backend infrastructure driving the media management platform.

Built with **Node.js** and **Express.js**, this backend ensures reliable data handling, secure file processing, and robust user authentication. It interfaces directly with **Supabase (PostgreSQL)** for data persistence, **ImageKit** for on-the-fly media optimization, and integrates **Google OAuth** for frictionless user authentication.

<br/>

## 🚀 Features

<table>
<tr>
<td width="33%" valign="top">

### 🔐 Security & Auth
- **Google OAuth** & JWT verification
- **Bcrypt** password hashing
- **Helmet & CORS** security headers
- **Rate limiting** for API abuse protection

</td>
<td width="33%" valign="top">

### 📁 Media & Storage
- File upload handling via **Multer**
- Image processing & delivery via **ImageKit**
- Scalable cloud storage integration

</td>
<td width="33%" valign="top">

### ⚙️ Core Infrastructure
- Persistent data layer with **Supabase**
- Email services via **Nodemailer**
- Scheduled background jobs via **Node-Cron**

</td>
</tr>
</table>

<br/>

## 🛠️ Tech Stack

### Core Technologies

| Technology | Purpose | Version |
|---|---|---|
| ![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white) | Runtime Environment | 18.x+ |
| ![Express.js](https://img.shields.io/badge/Express.js-000000?style=flat-square&logo=express&logoColor=white) | Web Framework | 5.2.x |
| ![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white) | Database & Realtime API | 2.x |

### Libraries & Utilities

| Technology | Purpose |
|---|---|
| ![JWT](https://img.shields.io/badge/JWT-000000?style=flat-square&logo=json-web-tokens&logoColor=white) | **jsonwebtoken**: Authentication & sessions |
| ![Google OAuth](https://img.shields.io/badge/Google_OAuth-4285F4?style=flat-square&logo=google&logoColor=white) | **google-auth-library**: Third-party auth |
| ![ImageKit](https://img.shields.io/badge/ImageKit-000000?style=flat-square) | **imagekit** & **multer**: Media processing |
| ![Nodemailer](https://img.shields.io/badge/Nodemailer-18B145?style=flat-square) | **nodemailer**: Transactional emails |
| ![Cron](https://img.shields.io/badge/Cron_Jobs-FF4F8B?style=flat-square) | **node-cron**: Background task scheduling |

<br/>

## 🏗️ Architecture

```mermaid
graph TB
    subgraph BackendApp [Backend Application - Node.js / Express]
        direction TB
        
        subgraph APILayer [API Layer]
            Routes["🛣️ Express Routes <br/> (Controllers)"]
            Middlewares["🛡️ Security & Parsing <br/> Helmet / CORS / Cookie Parser"]
            AuthMid["🔐 Auth Middleware <br/> JWT & Google Verify"]
        end
        
        subgraph ServicesLayer [Services & Utilities]
            DBClient["🗄️ Database Client <br/> Supabase JS"]
            MediaHandler["🖼️ Media Handler <br/> ImageKit / Multer"]
            Mailer["✉️ Email Service <br/> Nodemailer"]
            Jobs["⏱️ Cron Jobs <br/> Node-Cron"]
        end

        APILayer --> ServicesLayer
    end

    Frontend["🌐 Frontend Application"]
    SupabaseDB["🐘 Supabase (PostgreSQL)"]
    GoogleAuth["🌍 Google OAuth Service"]
    CDN["☁️ ImageKit CDN"]

    Frontend -->|HTTP Requests| APILayer
    AuthMid -->|Verify Tokens| GoogleAuth
    DBClient -->|Data Queries| SupabaseDB
    MediaHandler -->|Upload / Fetch| CDN

    style BackendApp fill:#f8fafc,stroke:#94a3b8,color:#000
    style APILayer fill:#e1f5fe,stroke:#03a9f4,color:#000
    style ServicesLayer fill:#f3e5f5,stroke:#9c27b0,color:#000
```

<details>
<summary><b>📖 System components explained</b></summary>
<br/>

- **API Layer** — Handles incoming HTTP requests, enforces security headers with `helmet`, manages cross-origin sharing with `cors`, and protects routes with JWT-based authentication.
- **Services Layer** — Abstracts business logic, managing direct communication with **Supabase** for database queries, handling multipart file uploads via `multer`, and interfacing with **ImageKit** for external media storage.
- **Background Jobs & Mail** — Utilizes `node-cron` for scheduled system maintenance or cleanups, and `nodemailer` for dispatching transactional emails (e.g. password resets).
</details>

<br/>

## 📂 Project Structure

```
Backend/
├── 📁 src/
│   ├── 📁 config/       # Environment variables & service configurations
│   ├── 📁 controllers/  # Route handlers and core business logic
│   ├── 📁 db/           # Supabase connection & database helpers
│   ├── 📁 middlewares/  # Custom Express middlewares (Auth, Multer, etc.)
│   ├── 📁 routes/       # Express route definitions
│   ├── 📁 utils/        # Helper functions and utilities
│   └── 📄 server.js     # Express app initialization & server entry point
├── 📄 .env              # Environment variables
├── 📄 .env.example      # Example environment variables template
└── 📄 package.json      # Dependencies and scripts
```

<br/>

## ⚙️ Installation & Setup

Make sure you have the following installed before you begin:
- **Node.js** `v18+` — [Download](https://nodejs.org/)

### 🚀 Quick Start

**1. Clone the repository**
```bash
git clone https://github.com/ayanmanna123/Cloud-based-Media-Files-Storage-Backend.git
cd Cloud-based-Media-Files-Storage-Backend
```

**2. Set up environment variables**
```bash
cp .env.example .env
```
> Configure your variables (e.g., Supabase keys, JWT Secrets, ImageKit credentials).

**3. Install dependencies**
```bash
npm install
```

**4. Start the development server**
```bash
npm run dev
```
The API server will be running (usually at **http://localhost:5000** or based on your `.env` port).

### 🗄️ Database Setup (Supabase)

If you are setting up the database tables from scratch, ensure you have linked your Supabase project and applied the migrations:

**1. Login to Supabase CLI (if not already logged in)**
```bash
npx supabase login
```

**2. Initialize Supabase in the project (if not done)**
```bash
npx supabase init
```

**3. Link your Supabase Project**
```bash
npx supabase link --project-ref <your-project-ref>
```
*(You will need your database password for this step)*

**4. Create the Database Tables**
All the necessary SQL queries to create your tables, functions, and triggers are located in the `src/db/migrations/` folder. 

To apply these migrations, open your Supabase project in the browser, navigate to the **SQL Editor**, and copy-paste the contents of each `.sql` file (in numerical order) from `src/db/migrations/` to run them.

<br/>

## 🤝 Contributing

Contributions are welcome from developers of all skill levels! 🚀

1. **Fork** the repository
2. **Clone** your fork
3. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
4. **Commit** your changes (`git commit -m "Add amazing feature"`)
5. **Push** to your branch (`git push origin feature/amazing-feature`)
6. **Open** a Pull Request 🎉

<br/>

## 📜 License

This project is licensed under the **MIT License**.

<br/>

## 📞 Contact

<div align="center">

### Ayan Manna 👨‍💻

<p>
<a href="https://linkedin.com/in/ayanmanna"><img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"/></a>
<a href="https://twitter.com/ayanmanna"><img src="https://img.shields.io/badge/Twitter-1DA1F2?style=for-the-badge&logo=twitter&logoColor=white" alt="Twitter"/></a>
<a href="https://github.com/ayanmanna123"><img src="https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/></a>
</p>

<br/>

**Made with ❤️ by [Ayan Manna](https://github.com/ayanmanna123) and the amazing open-source community**

</div>
