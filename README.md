# ✦ AI Companion — Electron App with Discord RPC

An AI-powered desktop companion with persistent memory, mood system, relationship progression, and Discord Rich Presence integration.

---

## Features

- 🤖 **AI Chat** — Powered by OpenRouter and Groq
- 🧠 **Persistent Memory** — Companion remembers important things you share
- 💜 **Relationship System** — XP-based progression from Strangers → Soulmates
- 😊 **Mood System** — Set your companion's mood; affects personality
- 🎨 **Fully Customizable** — Name, avatar emoji, accent color, personality
- 🎮 **Discord RPC** — Shows your companion name, current topic & mood on Discord

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Get an OpenRouter API Key
- Visit [OpenRouter.ai.api](https://openrouter.ai/settings/keys)
- Create an API key and copy it

### 3. Set up Discord RPC (optional but fun!)
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g. "AI Companion")
3. Copy the **Application ID** (this is your Client ID)
4. In the app, go to **Rich Presence → Art Assets** and upload:
   - An image named `companion` (shown as the large icon)
   - An image named `heart` (shown as the small icon)
5. Paste the Client ID into the app settings

### 4. Run the app
```bash
npm start
```

### 5. Configure in-app
Click **⚙ Settings** and fill in:
- Your OpenRouter API key
- Your Discord Client ID (if using RPC)
- Companion name, avatar, color, personality

---

## How Discord RPC works

When you're chatting, your Discord status shows:
- **Details**: `Chatting with [CompanionName]`
- **State**: The current conversation topic (last message preview)
- **Large icon tooltip**: `[Name] is feeling [mood] [emoji]`

The RPC updates live as you chat.

---

## File structure
```
ai-companion/
├── main.js         — Electron main process + Discord RPC
├── preload.js      — Secure IPC bridge
├── index.html      — Full UI (chat, sidebar, settings)
├── package.json
└── README.md
```

---

## Notes

- Your API key is **stored locally** in Electron's userData directory
- Chat history and memories persist between sessions
- The `discord-rpc` package requires Discord to be running on the same machine
- If Discord isn't open, RPC simply stays disconnected (no crash)
