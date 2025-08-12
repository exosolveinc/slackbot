# Slack Check-in Bot

A comprehensive Slack bot for team time tracking, work status management, and break monitoring.

## Prerequisites

- Node.js 16+ and npm/yarn
- Slack workspace with admin permissions
- Firebase project with Firestore enabled
- Slack app with appropriate permissions

## Installation

### 1. Clone the Repository
```bash
git clone <repository-url>
cd slack-checkin-bot
npm install
```

### 2. Slack App Setup

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name your app (e.g., "Check-in Bot") and select your workspace

#### Bot Token Scopes
Add these OAuth scopes in **OAuth & Permissions**:
```
app_mentions:read
channels:read
chat:write
commands
users:read
users:read.email
```

#### Slash Commands
Create these commands in **Slash Commands**:
- `/checkin` - Check in to work
- `/checkout` - Check out from work  
- `/break-start` - Start a break
- `/break-end` - End current break
- `/status-update` - Update work status
- `/status-history` - View status history
- `/checkin-report` - View team report
- `/my-history` - View personal history
- `/set-timezone` - Set timezone preference

#### Socket Mode
1. Enable **Socket Mode** in your app settings
2. Generate an **App Token** with `connections:write` scope

### 3. Firebase Setup

1. Create a new [Firebase project](https://console.firebase.google.com)
2. Enable **Firestore Database**
3. Generate a service account key:
   - Go to Project Settings → Service Accounts
   - Click "Generate new private key"
   - Save the JSON file securely

### 4. Environment Configuration

Create a `.env` file in the project root:

```env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# Firebase Configuration
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-project",...}
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
```

## Usage

### Starting the Bot
```bash
npm run dev
# or
npm start
```

### Available Commands

#### Basic Work Tracking
```bash
# Check in to work
/checkin Working on new features today

# Check out from work  
/checkout Completed user authentication module

# Update work status
/status-update Debugging payment integration issue
```

#### Break Management
```bash
# Start different types of breaks
/break-start short Taking a quick coffee break
/break-start lunch Heading out for lunch
/break-start personal Quick personal errand
/break-start meeting Team standup meeting

# End any active break
/break-end Back from lunch, ready to work
```

#### Reports & History
```bash
# View current team status
/checkin-report

# View specific date report
/checkin-report 2024-01-15

# View personal work history (last 7 days)
/my-history

# View last 30 days
/my-history 30

# View status update history
/status-history

# Ask the bot
/ask
```

#### Settings
```bash
# Set your timezone
/set-timezone America/New_York
/set-timezone Europe/London
/set-timezone Asia/Tokyo
```

## Database Schema

### Collections

#### `user_status`
Tracks current user state and active sessions.

#### `checkin_sessions` 
Individual work sessions with timing and metadata.

#### `user_preferences`
User-specific settings like timezone preferences.

#### `breaks` (subcollection)
Break records within each session.

#### `status_updates` (subcollection)
Work status updates within each session.

## Development

### Building and Running
```bash
# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Production start
npm start
```

## Deployment

### Environment Variables for Production
Ensure these are set in your production environment:
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET` 
- `SLACK_APP_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT_KEY`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_API_KEY`
- `AUTH_DOMAIN`
- `PROJECT_ID`
- `STORAGE_BUCKET`
- `MESSAGING_SENDER_ID`
- `APP_ID`
- `MEASUREMENT_ID`