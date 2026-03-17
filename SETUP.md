# Setup Guide

## 1. Fill in credentials in main.js

Open `main.js` and fill in the block near the top:

```js
const JWT_SECRET         = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';

const JSONBIN_BIN_ID  = 'YOUR_BIN_ID';
const JSONBIN_API_KEY = 'YOUR_JSONBIN_MASTER_KEY';

const GMAIL_USER     = 'YOUR_GMAIL@gmail.com';
const GMAIL_APP_PASS = 'YOUR_16_CHAR_APP_PASSWORD';
```

## 2. Get a JSONBin bin

1. Go to https://jsonbin.io and sign up (free)
2. Click "Create Bin", paste `{ "users": [] }` as the content, save
3. Copy the Bin ID from the URL (looks like: 65f3a2...)
4. Go to API Keys → copy your Master Key

## 3. Get a Gmail App Password

1. Enable 2FA on your Google account: https://myaccount.google.com/security
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Select "Mail" → "Other" → name it "AI Companion" → copy the 16 chars

## 4. Install and run

```bash
npm install
npm start
```

## How it works

- Users are stored in JSONBin as `{ "users": [...] }`
- Passwords are hashed with bcrypt — never stored in plain text
- On register, a verification email is sent via your Gmail
- The app runs a tiny local server on port 3322 to catch the verify link click
- Sessions are stored locally as a JWT in ~/.ai-companion/session.json
- All chat/settings data stays local as before
