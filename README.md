# Agentic Workflow

An AI-powered multi-platform agentic system that combines **Instagram analytics** and **GitHub automation** through natural language. Powered by **Google Gemini AI** for intent parsing and report generation, with **OAuth-based GitHub integration** and **Apify-powered Instagram scraping**.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [File Descriptions](#file-descriptions)
- [How It Works](#how-it-works)
- [API Endpoints](#api-endpoints)
- [Setup & Installation](#setup--installation)
- [Usage](#usage)
- [Environment Variables](#environment-variables)

---

## Overview

This project implements an **agentic workflow** — a system where specialized AI agents collaborate to accomplish complex tasks. The user provides a natural language request, and the system:

1. **Parses intent** using Gemini AI (determines platform, action, URLs)
2. **Routes to the correct agent** (Instagram or GitHub)
3. **Executes the action** (scrape data, call APIs, generate reports)
4. **Returns structured results** with AI-generated insights

### Key Features

- **Instagram Analysis**: Scrape any Instagram post/reel and get AI-generated engagement reports
- **GitHub Automation**: Create repos, star projects, manage issues, push code — all via natural language
- **GitHub OAuth**: No API keys needed for users — just "Connect GitHub" and go
- **Gemini AI**: Powers intent parsing, report generation, and GitHub action understanding
- **Model Fallback**: Automatically retries with alternative Gemini models on rate limits
- **Dual Interface**: REST API server + Interactive CLI

---

## Architecture

```
User Input (natural language)
        │
        ▼
┌─────────────────┐
│  Intent Parser   │  ← Gemini AI determines platform & action
│  (intentParser)  │
└────────┬────────┘
         │
    ┌────┴─────┐
    ▼          ▼
┌────────┐  ┌──────────┐
│Instagram│  │  GitHub   │
│ Scraper │  │  Agent    │  ← Gemini AI parses GitHub actions
└────┬───┘  └─────┬────┘
     │            │
     ▼            ▼
┌────────┐  ┌──────────────┐
│ Gemini  │  │ GitHub OAuth  │
│Reporter │  │    Agent      │  ← Handles OAuth flow & API calls
└────────┘  └──────────────┘
```

---

## Project Structure

```
agenticWorkFlow/
├── .env                          # Environment variables (API keys, secrets)
├── package.json                  # Project metadata & scripts
├── tsconfig.json                 # TypeScript configuration
├── server.ts                     # Express REST API server (main entry point)
├── agent.ts                      # Interactive CLI agent
├── test-cli.ts                   # Quick CLI test utility
├── workflow.ts                   # Workflow orchestrator (scraping → analysis pipeline)
└── agents/                       # Specialized agent modules
    ├── intentParser.ts           # Gemini-powered natural language intent parser
    ├── instagramScraper.ts       # Instagram data scraper (Apify + Cheerio fallback)
    ├── geminiReporter.ts         # Gemini AI report & summary generator
    ├── githubAgent.ts            # GitHub action executor (NL → GitHub API)
    └── githubOAuthAgent.ts       # GitHub OAuth handler & API wrapper
```

---

## File Descriptions

### Root Files

#### `server.ts` — Express REST API Server
The main HTTP server providing REST endpoints for all functionality:
- **GitHub OAuth flow**: `/auth/github` → callback → token storage
- **GitHub actions**: `POST /github` with natural language prompts
- **Instagram analysis**: `POST /analyze` and `POST /analyze/quick`
- Uses `express-session` for user session management
- Entry point when running `npm run dev`

#### `agent.ts` — Interactive CLI Agent
A terminal-based interactive assistant where users type natural language requests:
- Presents a REPL loop (`🧑 You: ` prompt)
- Parses each input through the Intent Parser agent
- Routes to Instagram or GitHub handlers based on detected intent
- Handles GitHub OAuth flow inline (spins up a temp server on port 9876 for the callback)
- Entry point when running `npm run agent`

#### `test-cli.ts` — Quick CLI Test Utility
A one-shot command-line tool for quickly testing Instagram analysis:
- Takes a URL and optional flags (`--quick`, `--query "..."`)
- Runs the full analysis workflow and prints the report
- Useful for quick testing without the interactive loop

#### `workflow.ts` — Workflow Orchestrator
Coordinates the Instagram analysis pipeline (scraping → AI analysis):
- **Step 1**: Calls Instagram Scraper to fetch post data
- **Step 2**: Sends scraped data to Gemini Reporter for AI analysis
- Returns a structured result with metrics, media URLs, and the generated report

### Agent Modules (`agents/`)

#### `agents/intentParser.ts` — Intent Parser Agent
Uses Gemini AI to understand what the user wants:
- Detects platform: `"instagram"` or `"github"` or `"unknown"`
- Extracts Instagram URLs from the prompt
- Determines action type (analyze, quick summary, GitHub action)
- Has a **regex fallback** if Gemini fails (detects URLs and GitHub keywords)
- Exports: `parseUserIntent()`

#### `agents/instagramScraper.ts` — Instagram Scraper Agent
Scrapes Instagram post/reel data with a dual-strategy approach:
- **Primary**: Uses [Apify](https://apify.com/) actor for reliable, detailed scraping (likes, comments, views, captions, media URLs)
- **Fallback**: Uses Cheerio (HTML parsing) to extract OpenGraph metadata when Apify fails
- Normalizes data from both sources into a consistent `InstagramData` interface
- Exports: `getInstagramData()`, `getInstagramDataApify()`, `getInstagramDataCheerio()`

#### `agents/geminiReporter.ts` — Gemini AI Reporter Agent
Generates AI-powered analytical reports from scraped data:
- **Full Report**: Comprehensive analysis covering engagement metrics, content analysis, performance insights, and recommendations
- **Quick Summary**: Concise 3-4 bullet point summary
- **Retry Logic**: Automatic retry with exponential backoff on 429 (rate limit) errors
- **Model Fallback Chain**: Tries `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-3-flash`
- Exports: `generateReport()`, `generateQuickSummary()`, `callGeminiWithRetry()`

#### `agents/githubAgent.ts` — GitHub Action Agent
Translates natural language GitHub requests into API calls:
- Uses Gemini AI to parse user intent into structured JSON (action + params)
- Supports 11 actions: `star_repo`, `create_repo`, `create_issue`, `list_repos`, `list_user_repos`, `get_user_profile`, `get_repo`, `list_issues`, `create_pr`, `push_project`, `get_profile`
- Distinguishes **public actions** (no auth needed) from **authenticated actions**
- Returns formatted summaries with emojis for terminal/API display
- Exports: `runGitHubAgent()`

#### `agents/githubOAuthAgent.ts` — GitHub OAuth Agent
Handles the complete GitHub OAuth flow and all GitHub API interactions:
- **OAuth**: Authorization URL generation, code-for-token exchange, token storage (in-memory Map)
- **Authenticated API**: Generic `githubAPI()` wrapper that auto-attaches bearer tokens
- **High-level actions**: `getUser()`, `listRepos()`, `createRepo()`, `starRepo()`, `createIssue()`, `listIssues()`, `createPullRequest()`, `getRepo()`, `createOrUpdateFile()`, `pushProject()`
- **Public API**: `getPublicUser()`, `listPublicRepos()` — No OAuth required
- Auto-disconnects users on 401 (expired token)
- Exports: All OAuth functions + all GitHub API action functions

---

## How It Works

### Instagram Analysis Flow
```
User: "Analyze this reel https://instagram.com/reel/ABC123"
  │
  ├─ Intent Parser → platform: "instagram", action: "analyze", url extracted
  ├─ Instagram Scraper → Apify fetches likes/comments/views/caption
  ├─ Gemini Reporter → AI generates comprehensive engagement report
  └─ Result: Structured JSON with metrics + AI report
```

### GitHub Action Flow
```
User: "Create a repo called my-project"
  │
  ├─ Intent Parser → platform: "github", action: "github_action"
  ├─ GitHub Agent → Gemini parses into { action: "create_repo", params: { name: "my-project" } }
  ├─ Auth Check → Is user connected? If not → OAuth redirect
  ├─ GitHub OAuth Agent → createRepo() → GitHub API
  └─ Result: "✅ Repository created! 📦 my-project 🔗 github.com/user/my-project"
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API info & status |
| `GET` | `/auth/github` | Start GitHub OAuth flow |
| `GET` | `/auth/github/callback` | OAuth callback (automatic) |
| `GET` | `/auth/github/status` | Check GitHub connection status |
| `POST` | `/auth/github/disconnect` | Disconnect GitHub account |
| `POST` | `/github` | Execute GitHub action `{ prompt: "..." }` |
| `POST` | `/analyze` | Full Instagram analysis `{ url, query? }` |
| `POST` | `/analyze/quick` | Quick Instagram summary `{ url }` |

---

## Setup & Installation

### Prerequisites
- **Node.js** 18+ 
- **npm** or **yarn**

### Install

```bash
# Clone the repository
git clone <repo-url>
cd agenticWorkFlow

# Install dependencies
npm install
```

### Configure Environment

Create a `.env` file (see [Environment Variables](#environment-variables) below).

### Run

```bash
# Start the REST API server (with auto-reload)
npm run dev

# Start the interactive CLI agent
npm run agent

# Quick test with a URL
npm run test-cli -- https://instagram.com/p/ABC123/

# Build TypeScript to JavaScript
npm run build

# Run production build
npm start
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `3000`) |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_REDIRECT_URI` | OAuth callback URL (e.g., `http://localhost:3000/auth/github/callback`) |
| `SESSION_SECRET` | Express session secret key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (reserved for future use) |

### Getting GitHub OAuth Credentials

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Set **Authorization callback URL** to `http://localhost:3000/auth/github/callback`
4. Copy the **Client ID** and **Client Secret** to your `.env`

---

## Tech Stack

- **Runtime**: Node.js with TypeScript (ESM)
- **Server**: Express 5
- **AI**: Google Gemini AI (`@google/generative-ai`)
- **Scraping**: Apify Client + Cheerio
- **HTTP**: Axios
- **Auth**: GitHub OAuth 2.0
- **Dev Tools**: tsx, nodemon, TypeScript
