import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import * as admin from 'firebase-admin';
import { handleBreakEnd, handleBreakStart, handleCheckin, handleCheckinReport, handleCheckout, handleMyHistory, handleSetTimezone, handleStatusHistory, handleStatusUpdate } from './commands';

dotenv.config();

let firebaseApp: admin.app.App;

if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
} else {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is required');
}

const app = new App({
  token: validateEnvVar('SLACK_BOT_TOKEN'),
  signingSecret: validateEnvVar('SLACK_SIGNING_SECRET'),
  socketMode: true,
  appToken: validateEnvVar('SLACK_APP_TOKEN'),
});

// Check-in command
app.command('/checkin', handleCheckin);

// Check-out command
app.command('/checkout', handleCheckout);

// Break start command
app.command('/break-start', handleBreakStart);

// Break end command
app.command('/break-end', handleBreakEnd);

// Status update command
app.command('/status-update', handleStatusUpdate);

// Status history command
app.command('/status-history', handleStatusHistory);

// Check-in report command
app.command('/checkin-report', handleCheckinReport);

// My history command
app.command('/my-history', handleMyHistory);

// Set timezone command
app.command('/set-timezone', handleSetTimezone);

// Error handler
app.error(async (error) => {
  console.error('Slack bot error:', error);
});

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack bot is running!');
    console.log('\nAvailable commands:');
    console.log('  /checkin [notes] - Check in to work');
    console.log('  /checkout [notes] - Check out from work');
    console.log('  /break-start <type> [notes] - Start a break');
    console.log('  /break-end [notes] - End current break');
    console.log('  /status-update [text] - Update work status');
    console.log('  /status-history - View status history');
    console.log('  /checkin-report [date] - View team report');
    console.log('  /my-history [days] - View personal history');
    console.log('  /set-timezone <timezone> - Set your timezone');
    console.log('\nBreak types available:');
    Object.entries(BREAK_TYPES).forEach(([key, config]) => {
      console.log(`  ${key} - ${config.emoji} ${config.name}${config.duration ? ` (${config.duration} min)` : ''}`);
    });
  } catch (error) {
    console.error('Failed to start the app:', error);
    process.exit(1);
  }
})();

export { app };