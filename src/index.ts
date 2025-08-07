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

interface UserStatus {
  userId: string;
  username: string;
  status: 'checked-in' | 'checked-out' | 'on-break' | 'offline';
  currentSessionId?: string;
  lastCheckin?: Date;
  lastCheckout?: Date;
  lastActivity: Date;
  timezone?: string;
  
  currentSession?: {
    checkinTime: Date;
    totalBreakTime: number;
    currentBreak?: {
      id: string;
      type: BreakType;
      startTime: Date;
    };
    currentWorkStatus?: string;
    statusUpdateCount: number;
  };
}

// Session Types
interface CheckinSession {
  sessionId: string;
  userId: string;
  username: string;
  date: string; // YYYY-MM-DD
  checkinTime: Date;
  checkoutTime?: Date;
  status: 'active' | 'completed';
  totalBreakTime: number;
  totalWorkTime?: number;
  notes?: {
    checkin?: string;
    checkout?: string;
  };
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  breakCount: number;
  statusUpdateCount: number;
  lastWorkStatus?: string;
}

// Break Types
type BreakType = 'short' | 'lunch' | 'personal' | 'meeting';

interface BreakRecord {
  breakId: string;
  sessionId: string;
  userId: string;
  type: BreakType;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  expectedDuration?: number;
  notes?: string;
  status: 'active' | 'completed';
  createdAt: Date;
}

interface StatusUpdate {
  updateId: string;
  sessionId: string;
  userId: string;
  username: string;
  status: string;
  timestamp: Date;
  previousStatus?: string;
}

// User Preferences Types
interface UserPreferences {
  userId: string;
  timezone: string;
  defaultBreakDurations?: {
    short?: number;
    lunch?: number;
    personal?: number;
  };
  notifications?: {
    breakReminders: boolean;
    checkoutReminders: boolean;
    reminderTime?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface UserCurrentState {
  status: UserStatus;
  currentSession?: CheckinSession;
  activeBreak?: BreakRecord;
  recentStatusUpdates?: StatusUpdate[];
}

interface FirestoreUserStatus extends Omit<UserStatus, 'lastCheckin' | 'lastCheckout' | 'lastActivity' | 'currentSession'> {
  lastCheckin?: admin.firestore.Timestamp;
  lastCheckout?: admin.firestore.Timestamp;
  lastActivity: admin.firestore.Timestamp;
  currentSession?: {
    checkinTime: admin.firestore.Timestamp;
    totalBreakTime: number;
    currentBreak?: {
      id: string;
      type: BreakType;
      startTime: admin.firestore.Timestamp;
    };
    currentWorkStatus?: string;
    statusUpdateCount: number;
  };
}

interface FirestoreCheckinSession extends Omit<CheckinSession, 'checkinTime' | 'checkoutTime' | 'createdAt' | 'updatedAt'> {
  checkinTime: admin.firestore.Timestamp;
  checkoutTime?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

interface FirestoreBreakRecord extends Omit<BreakRecord, 'startTime' | 'endTime' | 'createdAt'> {
  startTime: admin.firestore.Timestamp;
  endTime?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
}

interface FirestoreStatusUpdate extends Omit<StatusUpdate, 'timestamp'> {
  timestamp: admin.firestore.Timestamp;
}

interface FirestoreUserPreferences extends Omit<UserPreferences, 'createdAt' | 'updatedAt'> {
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

const COLLECTIONS = {
  USER_STATUS: 'user_status',
  CHECKIN_SESSIONS: 'checkin_sessions',
  USER_PREFERENCES: 'user_preferences',
  BREAKS: 'breaks',
  STATUS_UPDATES: 'status_updates'
} as const;

const BREAK_TYPES = {
  short: { name: 'Short Break', duration: 15, emoji: '☕' },
  lunch: { name: 'Lunch Break', duration: 45, emoji: '🍽️' },
  personal: { name: 'Personal Break', duration: 20, emoji: '🚶' },
  meeting: { name: 'Meeting Break', duration: null, emoji: '📅' }
} as const;


function generateSessionId(userId: string): string {
  const now = new Date();
  const dateParts = now.toISOString().split('T');
  const dateStr = dateParts[0] ? dateParts[0].replace(/-/g, '') : '';
  const timestamp = now.getTime();
  return `${userId}_${dateStr}_${timestamp}`;
}

function generateBreakId(): string {
  return `break_${Date.now()}`;
}

function generateStatusUpdateId(): string {
  return `status_${Date.now()}`;
}

function getDateString(date: Date): string {
  const parts = date.toISOString().split('T');
  return parts[0] || '';
}

function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatTime(date: Date, timezone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone || 'UTC',
    timeZoneName: 'short'
  };
  return date.toLocaleString('en-US', options);
}

function calculateDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function validateEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

// ============================================
// DATABASE FUNCTIONS - USER STATUS
// ============================================

async function getUserStatus(userId: string): Promise<UserStatus | null> {
  try {
    const doc = await db.collection(COLLECTIONS.USER_STATUS).doc(userId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data() as FirestoreUserStatus;
    return {
      ...data,
      lastCheckin: data.lastCheckin?.toDate(),
      lastCheckout: data.lastCheckout?.toDate(),
      lastActivity: data.lastActivity.toDate(),
      currentSession: data.currentSession ? {
        ...data.currentSession,
        checkinTime: data.currentSession.checkinTime.toDate(),
        currentBreak: data.currentSession.currentBreak ? {
          ...data.currentSession.currentBreak,
          startTime: data.currentSession.currentBreak.startTime.toDate()
        } : undefined
      } : undefined
    };
  } catch (error) {
    console.error('Error getting user status:', error);
    throw error;
  }
}

async function updateUserStatus(userId: string, updates: Partial<UserStatus>): Promise<void> {
  try {
    const docRef = db.collection(COLLECTIONS.USER_STATUS).doc(userId);
    
    const updateData: Record<string, any> = {
      ...updates,
      lastActivity: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (updates.lastCheckin) {
      updateData.lastCheckin = admin.firestore.Timestamp.fromDate(updates.lastCheckin);
    }
    if (updates.lastCheckout) {
      updateData.lastCheckout = admin.firestore.Timestamp.fromDate(updates.lastCheckout);
    }
    if (updates.currentSession) {
      updateData.currentSession = {
        ...updates.currentSession,
        checkinTime: admin.firestore.Timestamp.fromDate(updates.currentSession.checkinTime),
        currentBreak: updates.currentSession.currentBreak ? {
          ...updates.currentSession.currentBreak,
          startTime: admin.firestore.Timestamp.fromDate(updates.currentSession.currentBreak.startTime)
        } : undefined
      };
    }
    
    await docRef.set(updateData, { merge: true });
  } catch (error) {
    console.error('Error updating user status:', error);
    throw error;
  }
}


async function createCheckinSession(
  userId: string, 
  username: string, 
  notes?: string
): Promise<CheckinSession> {
  try {
    const sessionId = generateSessionId(userId);
    const now = new Date();
    const timezone = await getUserTimezone(userId);
    
    const session: CheckinSession = {
      sessionId,
      userId,
      username,
      date: getDateString(now),
      checkinTime: now,
      status: 'active',
      totalBreakTime: 0,
      timezone,
      createdAt: now,
      updatedAt: now,
      breakCount: 0,
      statusUpdateCount: 0
    };
    
    if (notes) {
      session.notes = { checkin: notes };
    }
    
    const sessionData: Record<string, any> = {
      sessionId: session.sessionId,
      userId: session.userId,
      username: session.username,
      date: session.date,
      checkinTime: admin.firestore.Timestamp.fromDate(session.checkinTime),
      status: session.status,
      totalBreakTime: session.totalBreakTime,
      timezone: session.timezone,
      createdAt: admin.firestore.Timestamp.fromDate(session.createdAt),
      updatedAt: admin.firestore.Timestamp.fromDate(session.updatedAt),
      breakCount: session.breakCount,
      statusUpdateCount: session.statusUpdateCount,
      notes: session.notes
    };
    
    await db.collection(COLLECTIONS.CHECKIN_SESSIONS).doc(sessionId).set(sessionData);
    
    await updateUserStatus(userId, {
      userId,
      username,
      status: 'checked-in',
      currentSessionId: sessionId,
      lastCheckin: now,
      timezone,
      currentSession: {
        checkinTime: now,
        totalBreakTime: 0,
        statusUpdateCount: 0
      }
    });
    
    return session;
  } catch (error) {
    console.error('Error creating checkin session:', error);
    throw error;
  }
}

async function getCheckinSession(sessionId: string): Promise<CheckinSession | null> {
  try {
    const doc = await db.collection(COLLECTIONS.CHECKIN_SESSIONS).doc(sessionId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data() as FirestoreCheckinSession;
    return {
      ...data,
      checkinTime: data.checkinTime.toDate(),
      checkoutTime: data.checkoutTime?.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate()
    };
  } catch (error) {
    console.error('Error getting checkin session:', error);
    throw error;
  }
}

async function completeCheckinSession(
  sessionId: string, 
  checkoutNotes?: string
): Promise<void> {
  try {
    const session = await getCheckinSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    const checkoutTime = new Date();
    const totalWorkTime = Math.round(
      (checkoutTime.getTime() - session.checkinTime.getTime()) / 60000 - session.totalBreakTime
    );
    
    const updates: Partial<FirestoreCheckinSession> = {
      checkoutTime: admin.firestore.Timestamp.fromDate(checkoutTime),
      status: 'completed',
      totalWorkTime,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp
    };
    
    if (checkoutNotes) {
      updates.notes = {
        ...session.notes,
        checkout: checkoutNotes
      };
    }
    
    await db.collection(COLLECTIONS.CHECKIN_SESSIONS).doc(sessionId).update(updates);
    
    await updateUserStatus(session.userId, {
      status: 'checked-out',
      currentSessionId: undefined,
      lastCheckout: checkoutTime,
      currentSession: undefined
    });
  } catch (error) {
    console.error('Error completing checkin session:', error);
    throw error;
  }
}

// ============================================
// DATABASE FUNCTIONS - BREAKS
// ============================================

async function startBreak(
  sessionId: string,
  userId: string,
  breakType: BreakType,
  notes?: string
): Promise<BreakRecord> {
  try {
    const breakId = generateBreakId();
    const now = new Date();
    
    const breakRecord: BreakRecord = {
      breakId,
      sessionId,
      userId,
      type: breakType,
      startTime: now,
      status: 'active',
      createdAt: now,
      expectedDuration: BREAK_TYPES[breakType].duration ?? undefined
    };
    
    if (notes) {
      breakRecord.notes = notes;
    }
    
    const breakData: Record<string, any> = {
      breakId: breakRecord.breakId,
      sessionId: breakRecord.sessionId,
      userId: breakRecord.userId,
      type: breakRecord.type,
      status: breakRecord.status,
      startTime: admin.firestore.Timestamp.fromDate(breakRecord.startTime),
      createdAt: admin.firestore.Timestamp.fromDate(breakRecord.createdAt),
      expectedDuration: breakRecord.expectedDuration,
      notes: breakRecord.notes
    };
    
    await db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .doc(sessionId)
      .collection(COLLECTIONS.BREAKS)
      .doc(breakId)
      .set(breakData);
    
    await db.collection(COLLECTIONS.CHECKIN_SESSIONS).doc(sessionId).update({
      breakCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const userStatus = await getUserStatus(userId);
    if (userStatus?.currentSession) {
      await updateUserStatus(userId, {
        status: 'on-break',
        currentSession: {
          ...userStatus.currentSession,
          currentBreak: {
            id: breakId,
            type: breakType,
            startTime: now
          }
        }
      });
    }
    
    return breakRecord;
  } catch (error) {
    console.error('Error starting break:', error);
    throw error;
  }
}

async function endBreak(
  sessionId: string,
  breakId: string,
  userId: string,
  notes?: string
): Promise<BreakRecord> {
  try {
    const breakRef = db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .doc(sessionId)
      .collection(COLLECTIONS.BREAKS)
      .doc(breakId);
    
    const breakDoc = await breakRef.get();
    if (!breakDoc.exists) {
      throw new Error('Break record not found');
    }
    
    const breakData = breakDoc.data() as FirestoreBreakRecord;
    const endTime = new Date();
    const duration = Math.round(
      (endTime.getTime() - breakData.startTime.toDate().getTime()) / 60000
    );
    
    const updates: Partial<FirestoreBreakRecord> = {
      endTime: admin.firestore.Timestamp.fromDate(endTime),
      duration,
      status: 'completed'
    };
    
    if (notes) {
      updates.notes = breakData.notes 
        ? `${breakData.notes} | End: ${notes}`
        : `End: ${notes}`;
    }
    
    await breakRef.update(updates);
    
    await db.collection(COLLECTIONS.CHECKIN_SESSIONS).doc(sessionId).update({
      totalBreakTime: admin.firestore.FieldValue.increment(duration),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const userStatus = await getUserStatus(userId);
    if (userStatus?.currentSession) {
      await updateUserStatus(userId, {
        status: 'checked-in',
        currentSession: {
          ...userStatus.currentSession,
          totalBreakTime: userStatus.currentSession.totalBreakTime + duration,
          currentBreak: undefined
        }
      });
    }
    
    return {
      ...breakData,
      startTime: breakData.startTime.toDate(),
      createdAt: breakData.createdAt.toDate(),
      endTime,
      duration,
      status: 'completed',
      notes: updates.notes
    } as BreakRecord;
  } catch (error) {
    console.error('Error ending break:', error);
    throw error;
  }
}

async function getSessionBreaks(sessionId: string): Promise<BreakRecord[]> {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .doc(sessionId)
      .collection(COLLECTIONS.BREAKS)
      .orderBy('startTime', 'desc')
      .get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data() as FirestoreBreakRecord;
      return {
        ...data,
        startTime: data.startTime.toDate(),
        endTime: data.endTime?.toDate(),
        createdAt: data.createdAt.toDate()
      } as BreakRecord;
    });
  } catch (error) {
    console.error('Error getting session breaks:', error);
    throw error;
  }
}

// ============================================
// DATABASE FUNCTIONS - STATUS UPDATES
// ============================================

async function addStatusUpdate(
  sessionId: string,
  userId: string,
  username: string,
  status: string
): Promise<StatusUpdate> {
  try {
    const updateId = generateStatusUpdateId();
    const now = new Date();
    
    const previousUpdate = await getLatestStatusUpdate(sessionId);
    
    const statusUpdate: StatusUpdate = {
      updateId,
      sessionId,
      userId,
      username,
      status,
      timestamp: now,
      previousStatus: previousUpdate?.status
    };
    
    const updateData: FirestoreStatusUpdate = {
      ...statusUpdate,
      timestamp: admin.firestore.Timestamp.fromDate(statusUpdate.timestamp)
    };
    
    await db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .doc(sessionId)
      .collection(COLLECTIONS.STATUS_UPDATES)
      .doc(updateId)
      .set(updateData);
    
    await db.collection(COLLECTIONS.CHECKIN_SESSIONS).doc(sessionId).update({
      lastWorkStatus: status,
      statusUpdateCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const userStatus = await getUserStatus(userId);
    if (userStatus?.currentSession) {
      await updateUserStatus(userId, {
        currentSession: {
          ...userStatus.currentSession,
          currentWorkStatus: status,
          statusUpdateCount: userStatus.currentSession.statusUpdateCount + 1
        }
      });
    }
    
    return statusUpdate;
  } catch (error) {
    console.error('Error adding status update:', error);
    throw error;
  }
}

async function getSessionStatusUpdates(
  sessionId: string,
  limit?: number
): Promise<StatusUpdate[]> {
  try {
    let query = db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .doc(sessionId)
      .collection(COLLECTIONS.STATUS_UPDATES)
      .orderBy('timestamp', 'desc');
    
    if (limit) {
      query = query.limit(limit);
    }
    
    const snapshot = await query.get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data() as FirestoreStatusUpdate;
      return {
        ...data,
        timestamp: data.timestamp.toDate()
      } as StatusUpdate;
    });
  } catch (error) {
    console.error('Error getting session status updates:', error);
    throw error;
  }
}

async function getLatestStatusUpdate(sessionId: string): Promise<StatusUpdate | null> {
  const updates = await getSessionStatusUpdates(sessionId, 1);
  return updates.length > 0 ? updates[0] || null : null;
}

// ============================================
// DATABASE FUNCTIONS - USER PREFERENCES
// ============================================

async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    const doc = await db.collection(COLLECTIONS.USER_PREFERENCES).doc(userId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data() as FirestoreUserPreferences;
    return {
      ...data,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate()
    };
  } catch (error) {
    console.error('Error getting user preferences:', error);
    throw error;
  }
}

async function updateUserPreferences(
  userId: string,
  preferences: Partial<UserPreferences>
): Promise<void> {
  try {
    const docRef = db.collection(COLLECTIONS.USER_PREFERENCES).doc(userId);
    
    const updateData: Record<string, any> = {
      ...preferences,
      userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const doc = await docRef.get();
    if (!doc.exists) {
      updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    
    await docRef.set(updateData, { merge: true });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    throw error;
  }
}

async function getUserTimezone(userId: string): Promise<string> {
  const preferences = await getUserPreferences(userId);
  return preferences?.timezone || getSystemTimezone();
}

// ============================================
// DATABASE FUNCTIONS - QUERIES
// ============================================

async function getUserCurrentState(userId: string): Promise<UserCurrentState | null> {
  try {
    const status = await getUserStatus(userId);
    if (!status) {
      return null;
    }
    
    const result: UserCurrentState = { status };
    
    if (status.currentSessionId) {
      const session = await getCheckinSession(status.currentSessionId);
      if (session) {
        result.currentSession = session;
        
        const statusUpdates = await getSessionStatusUpdates(status.currentSessionId, 5);
        result.recentStatusUpdates = statusUpdates;
        
        if (status.currentSession?.currentBreak) {
          const breaks = await getSessionBreaks(status.currentSessionId);
          const activeBreak = breaks.find(b => b.breakId === status.currentSession?.currentBreak?.id);
          if (activeBreak) {
            result.activeBreak = activeBreak;
          }
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error getting user current state:', error);
    throw error;
  }
}

async function getActiveUsers(): Promise<UserStatus[]> {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.USER_STATUS)
      .where('status', 'in', ['checked-in', 'on-break'])
      .get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data() as FirestoreUserStatus;
      return {
        ...data,
        lastCheckin: data.lastCheckin?.toDate(),
        lastCheckout: data.lastCheckout?.toDate(),
        lastActivity: data.lastActivity.toDate(),
        currentSession: data.currentSession ? {
          ...data.currentSession,
          checkinTime: data.currentSession.checkinTime.toDate(),
          currentBreak: data.currentSession.currentBreak ? {
            ...data.currentSession.currentBreak,
            startTime: data.currentSession.currentBreak.startTime.toDate()
          } : undefined
        } : undefined
      } as UserStatus;
    });
  } catch (error) {
    console.error('Error getting active users:', error);
    throw error;
  }
}

async function getSessionsByDate(date: string): Promise<CheckinSession[]> {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .where('date', '==', date)
      .get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data() as FirestoreCheckinSession;
      return {
        ...data,
        checkinTime: data.checkinTime.toDate(),
        checkoutTime: data.checkoutTime?.toDate(),
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate()
      } as CheckinSession;
    });
  } catch (error) {
    console.error('Error getting sessions by date:', error);
    throw error;
  }
}

async function getUserSessionHistory(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<CheckinSession[]> {
  try {
    const startDateStr = getDateString(startDate);
    const endDateStr = getDateString(endDate);
    
    const snapshot = await db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .where('userId', '==', userId)
      .where('date', '>=', startDateStr)
      .where('date', '<=', endDateStr)
      .orderBy('date', 'desc')
      .orderBy('checkinTime', 'desc')
      .get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data() as FirestoreCheckinSession;
      return {
        ...data,
        checkinTime: data.checkinTime.toDate(),
        checkoutTime: data.checkoutTime?.toDate(),
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate()
      } as CheckinSession;
    });
  } catch (error) {
    console.error('Error getting user session history:', error);
    throw error;
  }
}

// ============================================
// SLACK APP INITIALIZATION
// ============================================

const app = new App({
  token: validateEnvVar('SLACK_BOT_TOKEN'),
  signingSecret: validateEnvVar('SLACK_SIGNING_SECRET'),
  socketMode: true,
  appToken: validateEnvVar('SLACK_APP_TOKEN'),
});

// ============================================
// SLACK COMMAND HANDLERS
// ============================================

// Check-in command
app.command('/checkin', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const username = command.user_name;
  const notes = command.text?.trim() || '';

  try {
    const userStatus = await getUserStatus(userId);
    
    if (userStatus && (userStatus.status === 'checked-in' || userStatus.status === 'on-break')) {
      const statusText = userStatus.status === 'on-break' ? 'on a break' : 'checked in';
      const checkinTime = userStatus.currentSession?.checkinTime;
      
      await respond({
        response_type: 'ephemeral',
        text: `⚠️ You're already ${statusText}${checkinTime ? ` since ${formatTime(checkinTime, userStatus.timezone)}` : ''}. Use \`/checkout\` to check out first.`
      });
      return;
    }

    const session = await createCheckinSession(userId, username, notes);

    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Check-in successful!*\n*Time:* ${formatTime(session.checkinTime, session.timezone)}\n*User:* <@${userId}>`
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
          text: 'Use `/checkout` when you\'re ready to leave, `/break-start <type>` for breaks, or `/status-update` to share what you\'re working on'
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

// Check-out command
app.command('/checkout', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const notes = command.text?.trim() || '';

  try {
    const userState = await getUserCurrentState(userId);
    
    if (!userState || userState.status.status === 'checked-out' || !userState.currentSession) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ You haven\'t checked in yet. Use `/checkin` to check in first.'
      });
      return;
    }

    if (userState.status.status === 'on-break' && userState.activeBreak) {
      await endBreak(
        userState.currentSession.sessionId,
        userState.activeBreak.breakId,
        userId,
        'Auto-ended due to checkout'
      );
    }

    await completeCheckinSession(userState.currentSession.sessionId, notes);
    
    const completedSession = await getCheckinSession(userState.currentSession.sessionId);
    if (!completedSession || !completedSession.checkoutTime) {
      throw new Error('Failed to complete session');
    }

    const duration = calculateDuration(completedSession.checkinTime, completedSession.checkoutTime);
    const breaks = await getSessionBreaks(completedSession.sessionId);

    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🏁 *Check-out successful!*\n*User:* <@${userId}>\n*Check-in:* ${formatTime(completedSession.checkinTime, completedSession.timezone)}\n*Check-out:* ${formatTime(completedSession.checkoutTime, completedSession.timezone)}\n*Total Duration:* ${duration}\n*Work Time:* ${completedSession.totalWorkTime} minutes\n*Break Time:* ${completedSession.totalBreakTime} minutes`
        }
      }
    ];

    if (breaks.length > 0) {
      const breakSummary = breaks.map(b => {
        const breakType = BREAK_TYPES[b.type];
        return `  ${breakType.emoji} ${breakType.name}: ${b.duration || 0} min`;
      }).join('\n');
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Breaks taken (${breaks.length}):*\n${breakSummary}`
        }
      });
    }

    if (completedSession.statusUpdateCount > 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📝 ${completedSession.statusUpdateCount} status updates during this session`
          }
        ]
      });
    }

    if (completedSession.notes) {
      const allNotes = [
        completedSession.notes.checkin ? `Check-in: ${completedSession.notes.checkin}` : null,
        completedSession.notes.checkout ? `Check-out: ${completedSession.notes.checkout}` : null
      ].filter(Boolean).join('\n');
      
      if (allNotes) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Notes:*\n${allNotes}`
          }
        });
      }
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

// Break start command
app.command('/break-start', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const args = command.text?.trim().split(' ') || [];
  const breakType = args[0] as BreakType;
  const notes = args.slice(1).join(' ');

  try {
    const userState = await getUserCurrentState(userId);
    
    if (!userState || userState.status.status === 'checked-out' || !userState.currentSession) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ You need to be checked in before taking a break. Use `/checkin` first.'
      });
      return;
    }

    if (userState.status.status === 'on-break' && userState.activeBreak) {
      const currentBreakType = BREAK_TYPES[userState.activeBreak.type];
      await respond({
        response_type: 'ephemeral',
        text: `⚠️ You're already on a ${currentBreakType.emoji} ${currentBreakType.name}. Use \`/break-end\` to end your current break first.`
      });
      return;
    }

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

    const breakRecord = await startBreak(
      userState.currentSession.sessionId,
      userId,
      breakType,
      notes
    );

    const breakConfig = BREAK_TYPES[breakType];

    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${breakConfig.emoji} *Break started!*\n*Type:* ${breakConfig.name}\n*Started:* ${formatTime(breakRecord.startTime, userState.status.timezone)}\n*User:* <@${userId}>`
        }
      }
    ];

    if (breakConfig.duration) {
      const expectedEndTime = new Date(breakRecord.startTime.getTime() + breakConfig.duration * 60000);
      const firstBlock = blocks[0] as { type: 'section'; text: { type: 'mrkdwn'; text: string } };
      firstBlock.text.text += `\n*Expected duration:* ${breakConfig.duration} minutes\n*Expected return:* ${formatTime(expectedEndTime, userState.status.timezone)}`;
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

    const allBreaks = await getSessionBreaks(userState.currentSession.sessionId);
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: allBreaks.length > 1 
            ? `This is break #${allBreaks.length} for today. Use /break-end when you return.`
            : 'Use `/break-end` when you return from your break'
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

// Break end command
app.command('/break-end', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const notes = command.text?.trim() || '';

  try {
    const userState = await getUserCurrentState(userId);
    
    if (!userState || userState.status.status !== 'on-break' || !userState.activeBreak || !userState.currentSession) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ You\'re not currently on a break. Use `/break-start <type>` to start a break.'
      });
      return;
    }

    const endedBreak = await endBreak(
      userState.currentSession.sessionId,
      userState.activeBreak.breakId,
      userId,
      notes
    );

    const breakConfig = BREAK_TYPES[endedBreak.type];

    let durationText = `${endedBreak.duration} minutes`;
    if (breakConfig.duration && endedBreak.duration) {
      const difference = endedBreak.duration - breakConfig.duration;
      if (difference > 5) {
        durationText += ` (${difference} min longer than expected)`;
      } else if (difference < -5) {
        durationText += ` (${Math.abs(difference)} min shorter than expected)`;
      }
    }

    const updatedSession = await getCheckinSession(userState.currentSession.sessionId);
    
    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Break ended!*\n*Type:* ${breakConfig.emoji} ${breakConfig.name}\n*Duration:* ${durationText}\n*User:* <@${userId}>\n*Back to work:* ${formatTime(endedBreak.endTime!, userState.status.timezone)}`
        }
      }
    ];

    if (endedBreak.notes) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Notes:* ${endedBreak.notes}`
        }
      });
    }

    if (updatedSession) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Total break time today: ${updatedSession.totalBreakTime} minutes across ${updatedSession.breakCount} breaks`
          }
        ]
      });
    }

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

// Status update command
app.command('/status-update', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const username = command.user_name;
  const workStatus = command.text?.trim() || '';

  try {
    const userState = await getUserCurrentState(userId);
    
    if (!userState || userState.status.status === 'checked-out' || !userState.currentSession) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ You need to be checked in to update your work status. Use `/checkin` first.'
      });
      return;
    }

    if (!workStatus) {
      const currentStatus = userState.status.currentSession?.currentWorkStatus || 'No work status set';
      let historyText = '';
      
      if (userState.recentStatusUpdates && userState.recentStatusUpdates.length > 0) {
        const recentHistory = userState.recentStatusUpdates
          .slice(0, 5)
          .map(update => `• ${formatTime(update.timestamp, userState.status.timezone)}: ${update.status}`)
          .join('\n');
        historyText = `\n\n*Recent status history:*\n${recentHistory}`;
      }

      await respond({
        response_type: 'ephemeral',
        text: `📋 *Current work status:* ${currentStatus}${historyText}\n\nTo update: \`/status-update <what you're working on>\`\nExample: \`/status-update Working on user authentication feature\``
      });
      return;
    }

    await addStatusUpdate(
      userState.currentSession.sessionId,
      userId,
      username,
      workStatus
    );

    const statusEmoji = userState.status.status === 'on-break' ? '☕' : '💻';
    const statusText = userState.status.status === 'on-break' ? 'on break' : 'working';

    await respond({
      response_type: 'in_channel',
      text: `${statusEmoji} *<@${userId}>* is ${statusText} on: *${workStatus}*`
    });

  } catch (error) {
    console.error('Error in status-update command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to update work status. Please try again.'
    });
  }
});

// Status history command
app.command('/status-history', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;

  try {
    const userState = await getUserCurrentState(userId);

    if (!userState || !userState.currentSession) {
      await respond({
        response_type: 'ephemeral',
        text: '📊 You haven\'t checked in today. Use `/checkin` to get started!'
      });
      return;
    }

    const allStatusUpdates = await getSessionStatusUpdates(userState.currentSession.sessionId);

    if (allStatusUpdates.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: '📋 No status updates recorded for this check-in session.\n\nUse `/status-update <status>` to start tracking your work activities.'
      });
      return;
    }

    let historyText = `📋 *Status History for Current Session*\n`;
    historyText += `*Checked in:* ${formatTime(userState.currentSession.checkinTime, userState.status.timezone)}\n`;
    if (userState.currentSession.checkoutTime) {
      historyText += `*Checked out:* ${formatTime(userState.currentSession.checkoutTime, userState.status.timezone)}\n`;
    }
    historyText += `\n*Status Updates (${allStatusUpdates.length}):*\n`;

    allStatusUpdates.forEach((update, index) => {
      const timeStr = formatTime(update.timestamp, userState.status.timezone);
      historyText += `${allStatusUpdates.length - index}. *${timeStr}*\n   ${update.status}\n`;
      if (update.previousStatus) {
        historyText += `   _Changed from: ${update.previousStatus}_\n`;
      }
    });

    if (userState.status.status !== 'checked-out' && userState.status.currentSession?.currentWorkStatus) {
      historyText += `\n*Current Status:* ${userState.status.currentSession.currentWorkStatus}`;
    }

    await respond({
      response_type: 'ephemeral',
      text: historyText
    });
  } catch (error) {
    console.error('Error in status-history command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to retrieve status history. Please try again.'
    });
  }
});

// Check-in report command
app.command('/checkin-report', async ({ command, ack, respond }) => {
  await ack();

  const args = command.text?.trim().split(' ') || [];
  const reportDate = args[0] || getDateString(new Date());

  try {
    const activeUsers = await getActiveUsers();
    const daySessions = await getSessionsByDate(reportDate);

    if (activeUsers.length === 0 && daySessions.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: `📊 No check-in records found for ${reportDate}.`
      });
      return;
    }

    let reportText = `📊 *Check-in Report for ${reportDate}*\n\n`;
    
    const checkedInUsers = activeUsers.filter(u => u.status === 'checked-in');
    const onBreakUsers = activeUsers.filter(u => u.status === 'on-break');
    
    if (checkedInUsers.length > 0) {
      reportText += `*Currently Working (${checkedInUsers.length}):*\n`;
      for (const user of checkedInUsers) {
        if (user.currentSession) {
          const duration = calculateDuration(user.currentSession.checkinTime, new Date());
          const breakInfo = user.currentSession.totalBreakTime 
            ? ` | ${user.currentSession.totalBreakTime}min breaks` 
            : '';
          const statusInfo = user.currentSession.statusUpdateCount > 0 
            ? ` | ${user.currentSession.statusUpdateCount} updates` 
            : '';
          const workStatus = user.currentSession.currentWorkStatus 
            ? `\n  📋 ${user.currentSession.currentWorkStatus}` 
            : '';
          reportText += `• <@${user.userId}> - Since ${formatTime(user.currentSession.checkinTime, user.timezone)} (${duration}${breakInfo}${statusInfo})${workStatus}\n`;
        }
      }
      reportText += '\n';
    }

    if (onBreakUsers.length > 0) {
      reportText += `*Currently on Break (${onBreakUsers.length}):*\n`;
      for (const user of onBreakUsers) {
        if (user.currentSession?.currentBreak) {
          const breakType = BREAK_TYPES[user.currentSession.currentBreak.type];
          const breakDuration = Math.round((new Date().getTime() - user.currentSession.currentBreak.startTime.getTime()) / 60000);
          const workStatus = user.currentSession.currentWorkStatus 
            ? `\n  📋 Was working on: ${user.currentSession.currentWorkStatus}` 
            : '';
          reportText += `• <@${user.userId}> - ${breakType.emoji} ${breakType.name} for ${breakDuration}min${workStatus}\n`;
        }
      }
      reportText += '\n';
    }

    const completedSessions = daySessions.filter(s => s.status === 'completed');
    if (completedSessions.length > 0) {
      reportText += `*Completed Sessions Today (${completedSessions.length}):*\n`;
      for (const session of completedSessions) {
        if (session.checkoutTime) {
          const duration = calculateDuration(session.checkinTime, session.checkoutTime);
          const workTime = session.totalWorkTime ? `${session.totalWorkTime}min work` : '';
          const breakInfo = session.totalBreakTime ? ` | ${session.totalBreakTime}min breaks` : '';
          const statusInfo = session.statusUpdateCount > 0 ? ` | ${session.statusUpdateCount} updates` : '';
          reportText += `• <@${session.userId}> - ${duration} total (${workTime}${breakInfo}${statusInfo})\n`;
        }
      }
      reportText += '\n';
    }

    const totalSessions = daySessions.length;
    const totalWorkMinutes = daySessions.reduce((sum, s) => sum + (s.totalWorkTime || 0), 0);
    const totalBreakMinutes = daySessions.reduce((sum, s) => sum + (s.totalBreakTime || 0), 0);
    const avgWorkTime = totalSessions > 0 ? Math.round(totalWorkMinutes / totalSessions) : 0;
    const avgBreakTime = totalSessions > 0 ? Math.round(totalBreakMinutes / totalSessions) : 0;

    reportText += `*📊 Summary Statistics:*\n`;
    reportText += `• Total sessions: ${totalSessions}\n`;
    reportText += `• Currently active: ${activeUsers.length}\n`;
    reportText += `• Total work time: ${Math.round(totalWorkMinutes / 60)}h ${totalWorkMinutes % 60}m\n`;
    reportText += `• Total break time: ${Math.round(totalBreakMinutes / 60)}h ${totalBreakMinutes % 60}m\n`;
    reportText += `• Average work time per session: ${avgWorkTime}min\n`;
    reportText += `• Average break time per session: ${avgBreakTime}min`;

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

// My history command
app.command('/my-history', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const args = command.text?.trim().split(' ') || [];
  const daysBackStr = args[0] || '7';
  const daysBack = parseInt(daysBackStr) || 7;

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const sessions = await getUserSessionHistory(userId, startDate, endDate);

    if (sessions.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: `📊 No check-in history found for the last ${daysBack} days.`
      });
      return;
    }

    let historyText = `📊 *Your Check-in History (Last ${daysBack} Days)*\n\n`;

    const sessionsByDate = sessions.reduce((acc, session) => {
      const dateKey = session.date;
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(session);
      return acc;
    }, {} as Record<string, CheckinSession[]>);

    Object.entries(sessionsByDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .forEach(([date, dateSessions]) => {
        historyText += `*${date}:*\n`;
        
        dateSessions.forEach(session => {
          const checkinTimeParts = formatTime(session.checkinTime, session.timezone).split(',');
          const checkinTime = checkinTimeParts[1]?.trim() || '';
          if (session.status === 'completed' && session.checkoutTime) {
            const checkoutTimeParts = formatTime(session.checkoutTime, session.timezone).split(',');
            const checkoutTime = checkoutTimeParts[1]?.trim() || '';
            const duration = calculateDuration(session.checkinTime, session.checkoutTime);
            const workInfo = session.totalWorkTime ? ` (${session.totalWorkTime}min work)` : '';
            const breakInfo = session.totalBreakTime ? ` | ${session.totalBreakTime}min breaks` : '';
            historyText += `  • ${checkinTime} - ${checkoutTime}: ${duration}${workInfo}${breakInfo}\n`;
          } else {
            historyText += `  • ${checkinTime} - *Currently active*\n`;
          }
          
          if (session.lastWorkStatus) {
            historyText += `    Last status: ${session.lastWorkStatus}\n`;
          }
        });
        
        historyText += '\n';
      });

    const completedSessions = sessions.filter(s => s.status === 'completed');
    const totalWorkMinutes = completedSessions.reduce((sum, s) => sum + (s.totalWorkTime || 0), 0);
    const totalBreakMinutes = completedSessions.reduce((sum, s) => sum + (s.totalBreakTime || 0), 0);
    const avgWorkTime = completedSessions.length > 0 ? Math.round(totalWorkMinutes / completedSessions.length) : 0;

    historyText += `*📈 Summary:*\n`;
    historyText += `• Total sessions: ${sessions.length}\n`;
    historyText += `• Completed sessions: ${completedSessions.length}\n`;
    historyText += `• Total work time: ${Math.round(totalWorkMinutes / 60)}h ${totalWorkMinutes % 60}m\n`;
    historyText += `• Total break time: ${Math.round(totalBreakMinutes / 60)}h ${totalBreakMinutes % 60}m\n`;
    historyText += `• Average session length: ${avgWorkTime}min`;

    await respond({
      response_type: 'ephemeral',
      text: historyText
    });
  } catch (error) {
    console.error('Error in my-history command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to retrieve history. Please try again.'
    });
  }
});

// Set timezone command
app.command('/set-timezone', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const timezone = command.text?.trim() || '';

  try {
    if (!timezone) {
      const currentPrefs = await getUserPreferences(userId);
      await respond({
        response_type: 'ephemeral',
        text: `⚙️ *Set Your Timezone*\n\nUsage: \`/set-timezone <timezone>\`\n\nExamples:\n• \`/set-timezone America/New_York\`\n• \`/set-timezone Europe/London\`\n• \`/set-timezone Asia/Tokyo\`\n• \`/set-timezone Australia/Sydney\`\n\nYour current timezone: ${currentPrefs?.timezone || 'Not set (using system default)'}`
      });
      return;
    }

    try {
      new Date().toLocaleString('en-US', { timeZone: timezone });
    } catch {
      await respond({
        response_type: 'ephemeral',
        text: `❌ Invalid timezone: "${timezone}". Please use a valid timezone identifier like "America/New_York" or "Europe/London".`
      });
      return;
    }

    await updateUserPreferences(userId, { timezone });

    const userStatus = await getUserStatus(userId);
    if (userStatus) {
      await updateUserStatus(userId, { timezone });
    }

    await respond({
      response_type: 'ephemeral',
      text: `✅ Timezone updated to *${timezone}*\n\nCurrent time in your timezone: ${formatTime(new Date(), timezone)}`
    });
  } catch (error) {
    console.error('Error in set-timezone command:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to update timezone. Please try again.'
    });
  }
});

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