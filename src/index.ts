import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { handleAskAI, handleBreakEnd, handleBreakStart, handleCheckin, handleCheckinReport, handleCheckout, handleMyHistory, handleSetTimezone, handleStatusHistory, handleStatusUpdate } from './commands';
import { startStatusReminderService } from './database';
import { BREAK_TYPES } from './constants';
import './firebase'; 

dotenv.config();

function validateEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

export const app = new App({
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

app.command('/ask', handleAskAI);

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
    console.log('  /checkin [notes] - Check in to work (starts status reminders)');
    console.log('  /checkout [notes] - Check out from work (stops status reminders)');
    console.log('  /break-start <type> [notes] - Start a break');
    console.log('  /break-end [notes] - End current break');
    console.log('  /status-update [text] - Update work status (resets reminder timer)');
    console.log('  /status-history - View status history');
    console.log('  /checkin-report [date] - View team report');
    console.log('  /my-history [days] - View personal history');
    console.log('  /set-timezone <timezone> - Set your timezone');
    console.log('\n🔔 Status reminders will be sent every 45 minutes to checked-in users');
    console.log('\nBreak types available:');
    Object.entries(BREAK_TYPES).forEach(([key, config]) => {
      console.log(`  ${key} - ${config.emoji} ${config.name}${config.duration ? ` (${config.duration} min)` : ''}`);
    });

    // Start the status reminder service
    startStatusReminderService(app);
  } catch (error) {
    console.error('Failed to start the app:', error);
    process.exit(1);
  }
})();
