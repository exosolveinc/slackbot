import { App } from '@slack/bolt';
import { Block, KnownBlock } from '@slack/web-api';
import dotenv from 'dotenv';

dotenv.config();

console.log('Environment check:');
console.log('SLACK_BOT_TOKEN:', process.env.SLACK_BOT_TOKEN ? 'Set ✓' : 'Missing ✗');
console.log('SLACK_SIGNING_SECRET:', process.env.SLACK_SIGNING_SECRET ? 'Set ✓' : 'Missing ✗');
console.log('SLACK_APP_TOKEN:', process.env.SLACK_APP_TOKEN ? 'Set ✓' : 'Missing ✗');

interface CheckinRecord {
  userId: string;
  username: string;
  checkinTime: Date;
  checkoutTime?: Date;
  status: 'checked-in' | 'checked-out';
  notes?: string;
}

// Environment variable validation
function validateEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

const checkinRecords: Map<string, CheckinRecord> = new Map();

const app = new App({
  token: validateEnvVar('SLACK_BOT_TOKEN'),
  signingSecret: validateEnvVar('SLACK_SIGNING_SECRET'),
  socketMode: true,
  appToken: validateEnvVar('SLACK_APP_TOKEN'),
});

const formatTime = (date: Date): string => {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
};

// Helper function to calculate duration
const calculateDuration = (checkin: Date, checkout: Date): string => {
  const diffMs = checkout.getTime() - checkin.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
};

// Check-in command handler
app.command('/checkin', async ({ command, ack, respond, client }) => {
  await ack();

  const userId = command.user_id;
  const username = command.user_name;
  const notes = command.text?.trim() || '';

  // Check if user is already checked in
  const existingRecord = checkinRecords.get(userId);
  if (existingRecord && existingRecord.status === 'checked-in') {
    await respond({
      response_type: 'ephemeral',
      text: `⚠️ You're already checked in since ${formatTime(existingRecord.checkinTime)}. Use \`/checkout\` to check out first.`
    });
    return;
  }

  // Create new check-in record
  const checkinRecord: CheckinRecord = {
    userId,
    username,
    checkinTime: new Date(),
    status: 'checked-in',
    ...(notes && { notes })
  };

  checkinRecords.set(userId, checkinRecord);

  // Send confirmation message
  const blocks: (Block | KnownBlock)[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Check-in successful!*\n*Time:* ${formatTime(checkinRecord.checkinTime)}\n*User:* <@${userId}>`
      }
    }
  ];

  if (notes) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Notes:* ${notes}`
      }
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Use `/checkout` when you\'re ready to leave'
      }
    ]
  });

  await respond({
    response_type: 'in_channel',
    blocks
  });
});

// Check-out command handler
app.command('/checkout', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const username = command.user_name;
  const notes = command.text?.trim() || '';

  // Check if user is checked in
  const existingRecord = checkinRecords.get(userId);
  if (!existingRecord || existingRecord.status === 'checked-out') {
    await respond({
      response_type: 'ephemeral',
      text: '⚠️ You haven\'t checked in yet. Use `/checkin` to check in first.'
    });
    return;
  }

  // Update record with checkout time
  const checkoutTime = new Date();
  existingRecord.checkoutTime = checkoutTime;
  existingRecord.status = 'checked-out';
  if (notes) {
    const checkoutNote = `Checkout: ${notes}`;
    existingRecord.notes = existingRecord.notes 
      ? `${existingRecord.notes} | ${checkoutNote}`
      : checkoutNote;
  }

  checkinRecords.set(userId, existingRecord);

  const duration = calculateDuration(existingRecord.checkinTime, checkoutTime);

  // Send confirmation message
  const blocks: (Block | KnownBlock)[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🏁 *Check-out successful!*\n*User:* <@${userId}>\n*Check-in:* ${formatTime(existingRecord.checkinTime)}\n*Check-out:* ${formatTime(checkoutTime)}\n*Duration:* ${duration}`
      }
    }
  ];

  if (existingRecord.notes) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Notes:* ${existingRecord.notes}`
      }
    });
  }

  await respond({
    response_type: 'in_channel',
    blocks
  });
});

// Status command to check current status
app.command('/status', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const record = checkinRecords.get(userId);

  if (!record) {
    await respond({
      response_type: 'ephemeral',
      text: '📊 You haven\'t checked in today. Use `/checkin` to get started!'
    });
    return;
  }

  let statusText = '';
  if (record.status === 'checked-in') {
    const duration = calculateDuration(record.checkinTime, new Date());
    statusText = `🟢 *Currently checked in*\n*Since:* ${formatTime(record.checkinTime)}\n*Duration:* ${duration}`;
  } else {
    const duration = calculateDuration(record.checkinTime, record.checkoutTime!);
    statusText = `🔴 *Checked out*\n*Check-in:* ${formatTime(record.checkinTime)}\n*Check-out:* ${formatTime(record.checkoutTime!)}\n*Total Duration:* ${duration}`;
  }

  if (record.notes) {
    statusText += `\n*Notes:* ${record.notes}`;
  }

  await respond({
    response_type: 'ephemeral',
    text: statusText
  });
});


app.command('/checkin-report', async ({ command, ack, respond }) => {
  await ack();

  if (checkinRecords.size === 0) {
    await respond({
      response_type: 'ephemeral',
      text: '📊 No check-in records found today.'
    });
    return;
  }

  const records = Array.from(checkinRecords.values());
  const checkedInUsers = records.filter(r => r.status === 'checked-in');
  const checkedOutUsers = records.filter(r => r.status === 'checked-out');

  let reportText = `📊 *Check-in Report*\n\n`;
  
  if (checkedInUsers.length > 0) {
    reportText += `*Currently Checked In (${checkedInUsers.length}):*\n`;
    checkedInUsers.forEach(record => {
      const duration = calculateDuration(record.checkinTime, new Date());
      reportText += `• <@${record.userId}> - ${formatTime(record.checkinTime)} (${duration})\n`;
    });
    reportText += '\n';
  }

  if (checkedOutUsers.length > 0) {
    reportText += `*Checked Out Today (${checkedOutUsers.length}):*\n`;
    checkedOutUsers.forEach(record => {
      const duration = calculateDuration(record.checkinTime, record.checkoutTime!);
      reportText += `• <@${record.userId}> - ${duration} total\n`;
    });
  }

  await respond({
    response_type: 'ephemeral',
    text: reportText
  });
});

app.error(async (error) => {
  console.error('Slack bot error:', error);
});

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack Check-in Bot is running!');
    console.log('Available commands:');
    console.log('  /checkin [optional notes] - Check in to work');
    console.log('  /checkout [optional notes] - Check out from work');
    console.log('  /status - View your current check-in status');
    console.log('  /checkin-report - View all check-ins (admin)');
  } catch (error) {
    console.error('Failed to start the app:', error);
    process.exit(1);
  }
})();

export { app };