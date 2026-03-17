# Building AI Companion → .exe Installer

## Prerequisites (one-time setup)

1. **Install Node.js** (v18 or later)
   → https://nodejs.org — download the LTS version and run the installer

2. That's it! Node includes `npm` automatically.

---

## Steps to build your .exe

Open a terminal (Command Prompt or PowerShell) in the project folder, then run:

```bash
# 1. Install dependencies (only needed once)
npm install

# 2. Build the Windows installer
npm run build
```

This will create a `dist/` folder containing:
```
dist/
  AI Companion Setup 1.0.0.exe   ← installer (run this to install)
  AI Companion 1.0.0.exe         ← portable version (no install needed)
```

The installer lets you choose where to install, creates a desktop shortcut,
and adds AI Companion to your Start Menu — just like any normal Windows app.

---

## Other build commands

| Command | What it does |
|---|---|
| `npm start` | Run the app directly without building |
| `npm run build` | Windows installer (.exe) |
| `npm run build:portable` | Portable .exe (single file, no install) |
| `npm run build:all` | Windows + Mac + Linux |

---

## Adding your API keys

When you first open the app, click **⚙ Settings** (top right) and enter:

- **Groq API key** → free at https://console.groq.com
  - Sign up → API Keys → Create Key → copy the `gsk_...` key

- **OpenRouter API key** → free at https://openrouter.ai/keys
  - Sign up → Keys → Create Key → copy the `sk-or-...` key

- **Discord Client ID** (optional, for Rich Presence)
  - Go to https://discord.com/developers/applications
  - New Application → copy the Application ID
  - Go to Rich Presence → Art Assets → upload two images named `companion` and `heart`

Keys are stored **locally on your device only** in:
  `C:\Users\[you]\AppData\Roaming\ai-companion\companion-data.json`

---

## Troubleshooting

**"electron-builder is not recognized"**
→ Run `npm install` first

**Build fails on Windows with permission error**
→ Run the terminal as Administrator

**App opens but shows blank screen**
→ Make sure you're in the project folder when running commands

**Discord RPC not connecting**
→ Discord must be open and running on the same PC
→ Double-check your Client ID in Settings matches your Discord app
