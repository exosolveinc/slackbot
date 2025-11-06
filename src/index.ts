import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { createInterviewEvent } from './calendar';
import { handleAskAI, handleBreakEnd, handleBreakStart, handleCheckin, handleCheckinReport, handleCheckout, handleMyHistory, handleSetTimezone, handleStatusHistory, handleStatusUpdate } from './commands';
import { BREAK_TYPES } from './constants';
import { startStatusReminderService } from './database';
import './firebase';
import { handleInterviewQuery, handleScheduleInterview } from './interview-commands';

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

// schedule an interview
app.command('/schedule-interview', handleScheduleInterview);

app.command('/ask-interviews', handleInterviewQuery);

// Error handler
app.error(async (error) => {
  console.error('Slack bot error:', error);
});

// Handle modal submission
app.view('schedule_interview_modal', async ({ ack, body, view, client }) => {
  await ack();

  const values = view.state.values;
  const metadata = JSON.parse(view.private_metadata);

  try {
    // Add null checks for all values
    const title = values.title?.value?.value;
    const candidateName = values.candidate_name?.value?.value;
    const candidateEmail = values.candidate_email?.value?.value;
    const date = values.date?.value?.selected_date;
    const time = values.time?.value?.selected_time;
    const durationValue = values.duration?.value?.selected_option?.value;
    const description = values.description?.value?.value || '';

    // Validate required fields
    if (!title || !candidateName || !candidateEmail || !date || !time || !durationValue) {
      await client.chat.postMessage({
        channel: metadata.userId,
        text: '❌ Missing required fields. Please try again.'
      });
      return;
    }

    const duration = parseInt(durationValue);
    const startTime = new Date(`${date}T${time}:00`);

    const event = await createInterviewEvent(
      metadata.userId,
      metadata.username,
      candidateName,
      candidateEmail,
      title,
      startTime,
      duration,
      description
    );

    await client.chat.postMessage({
      channel: metadata.userId,
      text: `✅ *Interview Scheduled!*\n\n*Position:* ${title}\n*Candidate:* ${candidateName} (${candidateEmail})\n*Date & Time:* ${startTime.toLocaleString()}\n*Duration:* ${duration} minutes\n\n📅 Added to your Google Calendar\n✉️ Invitation sent to candidate`
    });

  } catch (error) {
    console.error('Error scheduling interview:', error);
    await client.chat.postMessage({
      channel: metadata.userId,
      text: '❌ Failed to schedule interview. Please try again.'
    });
  }
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
    console.log('\nInterview commands:');
    console.log('  /schedule-interview - Schedule a job interview');
    console.log('  /ask-interviews <query> - Query interviews with AI');
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
