import { App } from '@slack/bolt';
import { Block, KnownBlock } from '@slack/web-api';
import dotenv from 'dotenv';
import * as admin from 'firebase-admin';

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

const db = admin.firestore();

// Configure Firestore to ignore undefined properties
db.settings({
  ignoreUndefinedProperties: true
});

// Debug: Check if .env file is being loaded (remove in production)
console.log('Environment check:');
console.log('SLACK_BOT_TOKEN:', process.env.SLACK_BOT_TOKEN ? 'Set ✓' : 'Missing ✗');
console.log('SLACK_SIGNING_SECRET:', process.env.SLACK_SIGNING_SECRET ? 'Set ✓' : 'Missing ✗');
console.log('SLACK_APP_TOKEN:', process.env.SLACK_APP_TOKEN ? 'Set ✓' : 'Missing ✗');
console.log('FIREBASE_SERVICE_ACCOUNT_KEY:', process.env.FIREBASE_SERVICE_ACCOUNT_KEY ? 'Set ✓' : 'Missing ✗');

// Types for our check-in/check-out data
interface CheckinRecord {
  userId: string;
  username: string;
  checkinTime: Date;
  checkoutTime?: Date;
  status: 'checked-in' | 'checked-out' | 'on-break';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  currentBreak?: BreakRecord;
  totalBreakTime?: number; // in minutes
}

interface BreakRecord {
  type: 'short' | 'lunch' | 'personal' | 'meeting';
  startTime: Date;
  endTime?: Date;
  duration?: number; // in minutes
  notes?: string;
}

// Firebase collections
const CHECKIN_COLLECTION = 'checkins';

// Break type configurations
const BREAK_TYPES = {
  short: { name: 'Short Break', duration: 15, emoji: '☕' },
  lunch: { name: 'Lunch Break', duration: 45, emoji: '🍽️' },
  personal: { name: 'Personal Break', duration: 20, emoji: '🚶' },
  meeting: { name: 'Meeting Break', duration: null, emoji: '📅' }
} as const;


async function saveCheckinRecord(record: CheckinRecord): Promise<void> {
  try {
    const docRef = db.collection(CHECKIN_COLLECTION).doc(record.userId);
    
    // Prepare data for Firestore, removing undefined values
    const firestoreData: any = {
      userId: record.userId,
      username: record.username,
      checkinTime: admin.firestore.Timestamp.fromDate(record.checkinTime),
      checkoutTime: record.checkoutTime ? admin.firestore.Timestamp.fromDate(record.checkoutTime) : null,
      status: record.status,
      createdAt: admin.firestore.Timestamp.fromDate(record.createdAt),
      updatedAt: admin.firestore.Timestamp.fromDate(record.updatedAt)
    };

    // Only add notes if it exists and is not empty
    if (record.notes && record.notes.trim() !== '') {
      firestoreData.notes = record.notes;
    }

    // Handle break data
    if (record.currentBreak) {
      firestoreData.currentBreak = {
        type: record.currentBreak.type,
        startTime: admin.firestore.Timestamp.fromDate(record.currentBreak.startTime),
        endTime: record.currentBreak.endTime ? admin.firestore.Timestamp.fromDate(record.currentBreak.endTime) : null,
        duration: record.currentBreak.duration || null,
        notes: record.currentBreak.notes || null
      };
    }

    if (record.totalBreakTime !== undefined) {
      firestoreData.totalBreakTime = record.totalBreakTime;
    }

    await docRef.set(firestoreData);
  } catch (error) {
    console.error('Error saving checkin record:', error);
    throw error;
  }
}

async function getCheckinRecord(userId: string): Promise<CheckinRecord | null> {
  try {
    const docRef = db.collection(CHECKIN_COLLECTION).doc(userId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data()!;
    const record: CheckinRecord = {
      userId: data.userId,
      username: data.username,
      checkinTime: data.checkinTime.toDate(),
      checkoutTime: data.checkoutTime ? data.checkoutTime.toDate() : undefined,
      status: data.status,
      notes: data.notes || undefined,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
      totalBreakTime: data.totalBreakTime || 0
    };

    // Handle current break data
    if (data.currentBreak) {
      record.currentBreak = {
        type: data.currentBreak.type,
        startTime: data.currentBreak.startTime.toDate(),
        endTime: data.currentBreak.endTime ? data.currentBreak.endTime.toDate() : undefined,
        duration: data.currentBreak.duration || undefined,
        notes: data.currentBreak.notes || undefined
      };
    }

    return record;
  } catch (error) {
    console.error('Error getting checkin record:', error);
    throw error;
  }
}

async function getAllCheckinRecords(): Promise<CheckinRecord[]> {
  try {
    const snapshot = await db.collection(CHECKIN_COLLECTION).get();
    const records: CheckinRecord[] = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const record: CheckinRecord = {
        userId: data.userId,
        username: data.username,
        checkinTime: data.checkinTime.toDate(),
        checkoutTime: data.checkoutTime ? data.checkoutTime.toDate() : undefined,
        status: data.status,
        notes: data.notes || undefined,
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate(),
        totalBreakTime: data.totalBreakTime || 0
      };

      // Handle current break data
      if (data.currentBreak) {
        record.currentBreak = {
          type: data.currentBreak.type,
          startTime: data.currentBreak.startTime.toDate(),
          endTime: data.currentBreak.endTime ? data.currentBreak.endTime.toDate() : undefined,
          duration: data.currentBreak.duration || undefined,
          notes: data.currentBreak.notes || undefined
        };
      }

      records.push(record);
    });
    
    return records;
  } catch (error) {
    console.error('Error getting all checkin records:', error);
    throw error;
  }
}

async function deleteCheckinRecord(userId: string): Promise<void> {
  try {
    await db.collection(CHECKIN_COLLECTION).doc(userId).delete();
  } catch (error) {
    console.error('Error deleting checkin record:', error);
    throw error;
  }
}

// Environment variable validation
function validateEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

// Initialize Slack Bolt app with validated environment variables
const app = new App({
  token: validateEnvVar('SLACK_BOT_TOKEN'),
  signingSecret: validateEnvVar('SLACK_SIGNING_SECRET'),
  socketMode: true,
  appToken: validateEnvVar('SLACK_APP_TOKEN'),
});

// Helper function to format time
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
app.command('/checkin', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const username = command.user_name;
  const notes = command.text?.trim() || '';

  try {
    // Check if user is already checked in
    const existingRecord = await getCheckinRecord(userId);
    if (existingRecord && (existingRecord.status === 'checked-in' || existingRecord.status === 'on-break')) {
      const statusText = existingRecord.status === 'on-break' ? 'on a break' : 'checked in';
      await respond({
        response_type: 'ephemeral',
        text: `⚠️ You're already ${statusText} since ${formatTime(existingRecord.checkinTime)}. Use \`/checkout\` to check out first.`
      });
      return;
    }

    // Create new check-in record
    const now = new Date();
    const checkinRecord: CheckinRecord = {
      userId,
      username,
      checkinTime: now,
      status: 'checked-in',
      createdAt: now,
      updatedAt: now,
      totalBreakTime: 0,
      ...(notes && { notes })
    };

    await saveCheckinRecord(checkinRecord);

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
          text: 'Use `/checkout` when you\'re ready to leave or `/break-start <type>` for breaks'
        }
      ]
    });

    await respond({
      response_type: 'in_channel',
      blocks
    });
  } catch (error) {
    console.error('Error in check-in command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to process check-in. Please try again.'
    });
  }
});

// Check-out command handler
app.command('/checkout', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const username = command.user_name;
  const notes = command.text?.trim() || '';

  try {
    // Check if user is checked in
    const existingRecord = await getCheckinRecord(userId);
    if (!existingRecord || existingRecord.status === 'checked-out') {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ You haven\'t checked in yet. Use `/checkin` to check in first.'
      });
      return;
    }

    // If user is on break, end the break first
    if (existingRecord.status === 'on-break' && existingRecord.currentBreak) {
      const breakEndTime = new Date();
      const breakDuration = Math.round((breakEndTime.getTime() - existingRecord.currentBreak.startTime.getTime()) / 60000);
      
      existingRecord.currentBreak.endTime = breakEndTime;
      existingRecord.currentBreak.duration = breakDuration;
      existingRecord.totalBreakTime = (existingRecord.totalBreakTime || 0) + breakDuration;
    }

    // Update record with checkout time
    const checkoutTime = new Date();
    existingRecord.checkoutTime = checkoutTime;
    existingRecord.status = 'checked-out';
    existingRecord.updatedAt = checkoutTime;
    
    if (notes) {
      const checkoutNote = `Checkout: ${notes}`;
      existingRecord.notes = existingRecord.notes 
        ? `${existingRecord.notes} | ${checkoutNote}`
        : checkoutNote;
    }

    // Save updated record to Firebase
    await saveCheckinRecord(existingRecord);

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

    if (existingRecord.totalBreakTime && existingRecord.totalBreakTime > 0) {
      const firstBlock = blocks[0] as any;
      if (firstBlock && firstBlock.text && firstBlock.text.text) {
        firstBlock.text.text += `\n*Total break time:* ${existingRecord.totalBreakTime} minutes`;
      }
    }

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
  } catch (error) {
    console.error('Error in check-out command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to process check-out. Please try again.'
    });
  }
});

// Break start command handler
app.command('/break-start', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const username = command.user_name;
  const args = command.text?.trim().split(' ') || [];
  const breakType = args[0] as keyof typeof BREAK_TYPES;
  const notes = args.slice(1).join(' ');

  try {
    // Check if user is checked in
    const existingRecord = await getCheckinRecord(userId);
    if (!existingRecord || existingRecord.status === 'checked-out') {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ You need to be checked in before taking a break. Use `/checkin` first.'
      });
      return;
    }

    // Check if user is already on break
    if (existingRecord.status === 'on-break') {
      const currentBreakType = BREAK_TYPES[existingRecord.currentBreak!.type];
      await respond({
        response_type: 'ephemeral',
        text: `⚠️ You're already on a ${currentBreakType.emoji} ${currentBreakType.name}. Use \`/break-end\` to end your current break first.`
      });
      return;
    }

    // Validate break type or show options
    if (!breakType || !BREAK_TYPES[breakType]) {
      const breakOptions = Object.entries(BREAK_TYPES)
        .map(([key, config]) => `• \`${key}\` - ${config.emoji} ${config.name}${config.duration ? ` (${config.duration} min)` : ''}`)
        .join('\n');

      await respond({
        response_type: 'ephemeral',
        text: `Please specify a break type. Usage: \`/break-start <type> [notes]\`\n\nAvailable break types:\n${breakOptions}\n\nExample: \`/break-start lunch Going to get some food\``
      });
      return;
    }

    // Start the break
    const now = new Date();
    const breakConfig = BREAK_TYPES[breakType];
    
    existingRecord.status = 'on-break';
    existingRecord.currentBreak = {
      type: breakType,
      startTime: now,
      ...(notes && { notes })
    };
    existingRecord.updatedAt = now;

    // Save updated record
    await saveCheckinRecord(existingRecord);

    // Send confirmation message
    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${breakConfig.emoji} *Break started!*\n*Type:* ${breakConfig.name}\n*Started:* ${formatTime(now)}\n*User:* <@${userId}>`
        }
      }
    ];

    if (breakConfig.duration) {
      const expectedEndTime = new Date(now.getTime() + breakConfig.duration * 60000);
      const firstBlock = blocks[0] as any;
      if (firstBlock && firstBlock.text && firstBlock.text.text) {
        firstBlock.text.text += `\n*Expected duration:* ${breakConfig.duration} minutes\n*Expected return:* ${formatTime(expectedEndTime)}`;
      }
    }

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
          text: 'Use `/break-end` when you return from your break'
        }
      ]
    });

    await respond({
      response_type: 'in_channel',
      blocks
    });
  } catch (error) {
    console.error('Error in break-start command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to start break. Please try again.'
    });
  }
});

// Break end command handler
app.command('/break-end', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const notes = command.text?.trim() || '';

  try {
    // Check if user is on break
    const existingRecord = await getCheckinRecord(userId);
    if (!existingRecord || existingRecord.status !== 'on-break' || !existingRecord.currentBreak) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ You\'re not currently on a break. Use `/break-start <type>` to start a break.'
      });
      return;
    }

    // End the break
    const now = new Date();
    const breakDuration = Math.round((now.getTime() - existingRecord.currentBreak.startTime.getTime()) / 60000);
    const breakConfig = BREAK_TYPES[existingRecord.currentBreak.type];

    // Update break record
    existingRecord.currentBreak.endTime = now;
    existingRecord.currentBreak.duration = breakDuration;
    if (notes) {
      const endNotes = `End: ${notes}`;
      existingRecord.currentBreak.notes = existingRecord.currentBreak.notes 
        ? `${existingRecord.currentBreak.notes} | ${endNotes}`
        : endNotes;
    }

    // Update total break time
    existingRecord.totalBreakTime = (existingRecord.totalBreakTime || 0) + breakDuration;
    
    // Change status back to checked-in
    existingRecord.status = 'checked-in';
    existingRecord.updatedAt = now;

    // Save updated record (we'll keep the break in currentBreak for history)
    await saveCheckinRecord(existingRecord);

    // Determine if break was longer or shorter than expected
    let durationText = `${breakDuration} minutes`;
    if (breakConfig.duration) {
      const difference = breakDuration - breakConfig.duration;
      if (difference > 5) {
        durationText += ` (${difference} min longer than expected)`;
      } else if (difference < -5) {
        durationText += ` (${Math.abs(difference)} min shorter than expected)`;
      }
    }

    // Send confirmation message
    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Break ended!*\n*Type:* ${breakConfig.emoji} ${breakConfig.name}\n*Duration:* ${durationText}\n*User:* <@${userId}>\n*Back to work:* ${formatTime(now)}`
        }
      }
    ];

    if (existingRecord.currentBreak.notes) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Notes:* ${existingRecord.currentBreak.notes}`
        }
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Total break time today: ${existingRecord.totalBreakTime} minutes`
        }
      ]
    });

    await respond({
      response_type: 'in_channel',
      blocks
    });
  } catch (error) {
    console.error('Error in break-end command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to end break. Please try again.'
    });
  }
});

// Status command to check current status
app.command('/status-update', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;

  try {
    const record = await getCheckinRecord(userId);

    if (!record) {
      await respond({
        response_type: 'ephemeral',
        text: '📊 You haven\'t checked in today. Use `/checkin` to get started!'
      });
      return;
    }

    let statusText = '';
    
    if (record.status === 'on-break' && record.currentBreak) {
      const breakConfig = BREAK_TYPES[record.currentBreak.type];
      const breakDuration = Math.round((new Date().getTime() - record.currentBreak.startTime.getTime()) / 60000);
      
      statusText = `${breakConfig.emoji} *Currently on ${breakConfig.name.toLowerCase()}*\n*Break started:* ${formatTime(record.currentBreak.startTime)}\n*Break duration:* ${breakDuration} minutes`;
      
      if (breakConfig.duration) {
        const remaining = breakConfig.duration - breakDuration;
        if (remaining > 0) {
          statusText += `\n*Expected remaining:* ${remaining} minutes`;
        } else {
          statusText += `\n*⏰ Break exceeded expected time by ${Math.abs(remaining)} minutes*`;
        }
      }
      
      const workDuration = calculateDuration(record.checkinTime, record.currentBreak.startTime);
      statusText += `\n*Work time before break:* ${workDuration}`;
    } else if (record.status === 'checked-in') {
      const duration = calculateDuration(record.checkinTime, new Date());
      statusText = `🟢 *Currently checked in*\n*Since:* ${formatTime(record.checkinTime)}\n*Work duration:* ${duration}`;
    } else {
      const duration = calculateDuration(record.checkinTime, record.checkoutTime!);
      statusText = `🔴 *Checked out*\n*Check-in:* ${formatTime(record.checkinTime)}\n*Check-out:* ${formatTime(record.checkoutTime!)}\n*Total Duration:* ${duration}`;
    }

    // Add total break time if any
    if (record.totalBreakTime && record.totalBreakTime > 0) {
      statusText += `\n*Total break time today:* ${record.totalBreakTime} minutes`;
    }

    if (record.notes) {
      statusText += `\n*Notes:* ${record.notes}`;
    }

    if (record.currentBreak?.notes) {
      statusText += `\n*Break notes:* ${record.currentBreak.notes}`;
    }

    await respond({
      response_type: 'ephemeral',
      text: statusText
    });
  } catch (error) {
    console.error('Error in status command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to retrieve status. Please try again.'
    });
  }
});

// Admin command to view all check-ins
app.command('/checkin-report', async ({ command, ack, respond }) => {
  await ack();

  try {
    const records = await getAllCheckinRecords();

    if (records.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: '📊 No check-in records found today.'
      });
      return;
    }

    const checkedInUsers = records.filter(r => r.status === 'checked-in');
    const onBreakUsers = records.filter(r => r.status === 'on-break');
    const checkedOutUsers = records.filter(r => r.status === 'checked-out');

    let reportText = `📊 *Check-in Report*\n\n`;
    
    if (checkedInUsers.length > 0) {
      reportText += `*Currently Working (${checkedInUsers.length}):*\n`;
      checkedInUsers.forEach(record => {
        const duration = calculateDuration(record.checkinTime, new Date());
        const breakInfo = record.totalBreakTime ? ` | ${record.totalBreakTime}min break` : '';
        reportText += `• <@${record.userId}> - ${formatTime(record.checkinTime)} (${duration}${breakInfo})\n`;
      });
      reportText += '\n';
    }

    if (onBreakUsers.length > 0) {
      reportText += `*Currently on Break (${onBreakUsers.length}):*\n`;
      onBreakUsers.forEach(record => {
        if (record.currentBreak) {
          const breakConfig = BREAK_TYPES[record.currentBreak.type];
          const breakDuration = Math.round((new Date().getTime() - record.currentBreak.startTime.getTime()) / 60000);
          reportText += `• <@${record.userId}> - ${breakConfig.emoji} ${breakConfig.name} (${breakDuration}min)\n`;
        }
      });
      reportText += '\n';
    }

    if (checkedOutUsers.length > 0) {
      reportText += `*Checked Out Today (${checkedOutUsers.length}):*\n`;
      checkedOutUsers.forEach(record => {
        const duration = calculateDuration(record.checkinTime, record.checkoutTime!);
        const breakInfo = record.totalBreakTime ? ` | ${record.totalBreakTime}min break` : '';
        reportText += `• <@${record.userId}> - ${duration} total${breakInfo}\n`;
      });
    }

    await respond({
      response_type: 'ephemeral',
      text: reportText
    });
  } catch (error) {
    console.error('Error in checkin-report command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to generate report. Please try again.'
    });
  }
});

// Error handler - v4 requires async function
app.error(async (error) => {
  console.error('Slack bot error:', error);
});

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack Check-in Bot with Break Tracking is running!');
    console.log('Available commands:');
    console.log('  /checkin [optional notes] - Check in to work');
    console.log('  /checkout [optional notes] - Check out from work');
    console.log('  /break-start <type> [notes] - Start a break (short, lunch, personal, meeting)');
    console.log('  /break-end [notes] - End current break');
    console.log('  /status - View your current check-in status');
    console.log('  /checkin-report - View all check-ins (admin)');
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