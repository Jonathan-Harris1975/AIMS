# 📘 Project README

------------------------------------------------------------------------

# 🚀 Project Overview

This project is a modular content‑generation platform capable of
producing podcast episodes, scripts, artwork, text‑to‑speech audio, and
RSS feeds.\
Its service‑oriented architecture keeps features isolated, scalable, and
easy to extend.

------------------------------------------------------------------------

# 📂 Repository Structure

    /services
      ├── api
      ├── artwork
      ├── podcast
      ├── rss-feed-creator
      ├── rss-feed-podcast
      ├── script
      ├── shared
      └── tts

Each folder represents a self‑contained service with its own logic,
routing, and utilities.

------------------------------------------------------------------------

# 🧩 Service Descriptions

### **🟦 api/**

Acts as the main entry point for external requests.\
Provides API endpoints that trigger internal services such as podcast
generation, RSS feed creation, artwork creation, and more.

------------------------------------------------------------------------

### **🎨 artwork/**

Generates and manages podcast artwork.\
Includes utilities and routes that render artwork programmatically to
match episode or brand styling.

------------------------------------------------------------------------

### **🎙️ podcast/**

Runs the core podcast‑generation pipeline.\
Responsible for assembling episode components such as scripts, audio,
and artwork.

------------------------------------------------------------------------

### **📰 rss-feed-creator/**

Creates RSS feeds for text‑based content such as articles or rewritten
material.\
Contains pipelines that build feed metadata, rewrite logic, startup
routines, and feed routes.

------------------------------------------------------------------------

### **🎧 rss-feed-podcast/**

Generates podcast‑specific RSS feeds.\
Responsible for constructing XML RSS structures compatible with podcast
platforms (Apple Podcasts, Spotify, etc.).

------------------------------------------------------------------------

### **✍️ script/**

Generates and processes scripts used for TTS or podcast narrative.\
Includes route handlers and utilities that prepare written content
before it enters audio pipelines.

------------------------------------------------------------------------

### **🔧 shared/**

Contains internal utilities shared across services.\
Examples:\
- HTTP client\
- Shared helper functions\
- Common formatting utilities\
This ensures consistency and prevents duplication.

------------------------------------------------------------------------

### **🗣️ tts/**

Text‑to‑Speech engine responsible for generating high‑quality audio from
scripts.\
Provides routes and utilities for voice synthesis and audio file
creation.

------------------------------------------------------------------------

### **📣 oneup/**

Schedules Jonathan Harris social posts into OneUp via the public API.
Includes seven day-specific daily lanes plus a weekly quiz series, shared prompt generation, queue guarding, dry-run previews, and weekend RSS-assisted freshness with fallback when the feed is not suitable.

------------------------------------------------------------------------

# ⚙️ Installation

``` bash
git clone <your-repo-url>
cd <project-directory>
npm install
```

------------------------------------------------------------------------

# ▶️ Usage

Start the development server:

``` bash
npm run dev
```

Or run in production:

``` bash
npm start
```

------------------------------------------------------------------------

# 🏗️ Architecture Overview

This project follows a **service‑oriented architecture**, providing:

-   Clear separation of concerns\
-   Independent development of each service\
-   Modular pipeline execution\
-   Easy maintenance and testing

```{=html}
<!-- -->
```
    Client → API → Services (script, tts, artwork, podcast, rss) → Output

------------------------------------------------------------------------

# 🧪 Testing

``` bash
npm test
```

------------------------------------------------------------------------

# 📜 License

MIT License (or replace with your chosen license)

------------------------------------------------------------------------

If you'd like, I can generate a version with: - Shields/badges\
- A visual architecture diagram\
- API endpoint documentation\
- Workflow examples
