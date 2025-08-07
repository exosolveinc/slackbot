import { App } from "@slack/bolt";
import { UserPreferences, FirestoreUserPreferences, UserCurrentState, UserStatus, FirestoreUserStatus, CheckinSession, FirestoreCheckinSession, BreakRecord, BreakType, FirestoreBreakRecord, FirestoreStatusUpdate, StatusUpdate, StatusReminder, FirestoreStatusReminder } from "./schema";

import * as admin from 'firebase-admin';
import { COLLECTIONS, BREAK_TYPES } from "./constants";
import { getSystemTimezone, getDateString, generateSessionId, generateBreakId, generateStatusUpdateId, formatTime } from "./helper";
import { app } from ".";
import { db } from "./firebase";

export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
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

export async function updateUserPreferences(
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

export async function getUserTimezone(userId: string): Promise<string> {
    const preferences = await getUserPreferences(userId);
    return preferences?.timezone || getSystemTimezone();
}

// ============================================
// DATABASE FUNCTIONS - QUERIES
// ============================================

export async function getUserCurrentState(userId: string): Promise<UserCurrentState | null> {
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

export async function getActiveUsers(): Promise<UserStatus[]> {
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

export async function getSessionsByDate(date: string): Promise<CheckinSession[]> {
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

export async function getUserSessionHistory(
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


export async function getUserStatus(userId: string): Promise<UserStatus | null> {
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

export async function updateUserStatus(userId: string, updates: Partial<UserStatus>): Promise<void> {
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


export async function createCheckinSession(
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

export async function getCheckinSession(sessionId: string): Promise<CheckinSession | null> {
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

export async function completeCheckinSession(
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

export async function startBreak(
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

export async function endBreak(
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

export async function getSessionBreaks(sessionId: string): Promise<BreakRecord[]> {
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

export async function addStatusUpdate(
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

export async function getSessionStatusUpdates(
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

export async function getLatestStatusUpdate(sessionId: string): Promise<StatusUpdate | null> {
    const updates = await getSessionStatusUpdates(sessionId, 1);
    return updates.length > 0 ? updates[0] || null : null;
}

export async function createStatusReminder(userId: string, username: string, sessionId: string): Promise<void> {
  try {
    const timezone = await getUserTimezone(userId);
    const now = new Date();
    
    const reminder: StatusReminder = {
      userId,
      username,
      sessionId,
      reminderCount: 0,
      isActive: true,
      timezone
    };
    
    const reminderData: Record<string, any> = {
      ...reminder,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection(COLLECTIONS.STATUS_REMINDERS).doc(userId).set(reminderData);
    console.log(`Status reminder created for user ${userId} (session: ${sessionId})`);
  } catch (error) {
    console.error('Error creating status reminder:', error);
  }
}

export async function updateStatusReminder(userId: string, updates: Partial<StatusReminder>): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (updates.lastReminderSent) {
      updateData.lastReminderSent = admin.firestore.Timestamp.fromDate(updates.lastReminderSent);
    }
    if (updates.lastStatusUpdate) {
      updateData.lastStatusUpdate = admin.firestore.Timestamp.fromDate(updates.lastStatusUpdate);
    }
    
    await db.collection(COLLECTIONS.STATUS_REMINDERS).doc(userId).update(updateData);
  } catch (error) {
    console.error('Error updating status reminder:', error);
  }
}

export async function getStatusReminder(userId: string): Promise<StatusReminder | null> {
  try {
    const doc = await db.collection(COLLECTIONS.STATUS_REMINDERS).doc(userId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data() as FirestoreStatusReminder;
    return {
      ...data,
      lastReminderSent: data.lastReminderSent?.toDate(),
      lastStatusUpdate: data.lastStatusUpdate?.toDate()
    };
  } catch (error) {
    console.error('Error getting status reminder:', error);
    return null;
  }
}

export async function deactivateStatusReminder(userId: string): Promise<void> {
  try {
    await updateStatusReminder(userId, { isActive: false });
    console.log(`Status reminder deactivated for user ${userId}`);
  } catch (error) {
    console.error('Error deactivating status reminder:', error);
  }
}

export async function getActiveStatusReminders(): Promise<StatusReminder[]> {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.STATUS_REMINDERS)
      .where('isActive', '==', true)
      .get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data() as FirestoreStatusReminder;
      return {
        ...data,
        lastReminderSent: data.lastReminderSent?.toDate(),
        lastStatusUpdate: data.lastStatusUpdate?.toDate()
      } as StatusReminder;
    });
  } catch (error) {
    console.error('Error getting active status reminders:', error);
    return [];
  }
}

// Status Reminder Logic - Updated to receive app instance
export async function sendStatusReminder(
  userId: string, 
  timezone: string
): Promise<void> {
  try {
    const userState = await getUserCurrentState(userId);
    
    // Don't send reminder if user is not checked in or is on break
    if (!userState || userState.status.status !== 'checked-in') {
      return;
    }
    
    const currentTime = formatTime(new Date(), timezone);
    const lastStatus = userState.status.currentSession?.currentWorkStatus || 'No status set';
    
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⏰ *Status Check-in Time!*\n\nHi <@${userId}>! It's been 45 minutes since your last update.\n\n*Current time:* ${currentTime}\n*Last status:* ${lastStatus}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*What are you working on now?*\n\nPlease update your status using: `/status-update <what you\'re working on>`'
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 Regular status updates help keep the team informed and improve productivity tracking!'
          }
        ]
      }
    ];
    
    // Send DM to user
    const result = await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: userId,
      blocks: blocks,
      text: `Status reminder: Please update what you're working on using /status-update`
    });
    
    if (result.ok) {
      console.log(`Status reminder sent to user ${userId}`);
      
      // Update reminder record
      const reminder = await getStatusReminder(userId);
      if (reminder) {
        await updateStatusReminder(userId, {
          lastReminderSent: new Date(),
          reminderCount: reminder.reminderCount + 1
        });
      }
    } else {
      console.error('Failed to send status reminder:', result.error);
    }
  } catch (error) {
    console.error('Error sending status reminder:', error);
  }
}

export async function checkAndSendStatusReminders(app: App): Promise<void> {
  try {
    const activeReminders = await getActiveStatusReminders();
    const now = new Date();
    const REMINDER_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
    
    console.log(`Checking ${activeReminders.length} active reminder(s) for status updates`);
    
    for (const reminder of activeReminders) {
      // Skip if user is not in an active session
      const userState = await getUserCurrentState(reminder.userId);
      if (!userState || userState.status.status !== 'checked-in') {
        continue;
      }
      
      // Determine when last status activity occurred
      let lastActivityTime: Date;
      
      if (reminder.lastStatusUpdate) {
        lastActivityTime = reminder.lastStatusUpdate;
      } else if (userState.recentStatusUpdates && userState.recentStatusUpdates.length > 0) {
        lastActivityTime = userState.recentStatusUpdates[0]!.timestamp;
      } else if (userState.currentSession) {
        // No status updates yet, use check-in time
        lastActivityTime = userState.currentSession.checkinTime;
      } else {
        continue;
      }
      
      // Check if 45 minutes have passed since last activity
      const timeSinceLastActivity = now.getTime() - lastActivityTime.getTime();
      
      if (timeSinceLastActivity >= REMINDER_INTERVAL_MS) {
        // Check if we already sent a reminder recently (avoid spam)
        if (reminder.lastReminderSent) {
          const timeSinceLastReminder = now.getTime() - reminder.lastReminderSent.getTime();
          // Only send another reminder if it's been at least 45 minutes since the last one
          if (timeSinceLastReminder < REMINDER_INTERVAL_MS) {
            continue;
          }
        }
        
        await sendStatusReminder(reminder.userId, reminder.timezone);
      }
    }
  } catch (error) {
    console.error('Error in checkAndSendStatusReminders:', error);
  }
}

// Modified createCheckinSession function to include reminder setup
export async function createCheckinSessionWithReminder(
  userId: string, 
  username: string, 
  notes?: string
): Promise<CheckinSession> {
  try {
    // Create the session (existing logic)
    const session = await createCheckinSession(userId, username, notes);
    
    // Create status reminder for this session
    await createStatusReminder(userId, username, session.sessionId);
    
    return session;
  } catch (error) {
    console.error('Error creating checkin session with reminder:', error);
    throw error;
  }
}

// Modified completeCheckinSession to deactivate reminder
export async function completeCheckinSessionWithReminder(
  sessionId: string, 
  checkoutNotes?: string
): Promise<void> {
  try {
    const session = await getCheckinSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Complete the session (existing logic)
    await completeCheckinSession(sessionId, checkoutNotes);
    
    // Deactivate status reminder
    await deactivateStatusReminder(session.userId);
  } catch (error) {
    console.error('Error completing checkin session with reminder cleanup:', error);
    throw error;
  }
}

// Modified addStatusUpdate to update reminder timestamp
export async function addStatusUpdateWithReminderUpdate(
  sessionId: string,
  userId: string,
  username: string,
  status: string
): Promise<StatusUpdate> {
  try {
    // Add the status update (existing logic)
    const statusUpdate = await addStatusUpdate(sessionId, userId, username, status);
    
    // Update the reminder with last status update time
    const reminder = await getStatusReminder(userId);
    if (reminder && reminder.isActive) {
      await updateStatusReminder(userId, {
        lastStatusUpdate: new Date()
      });
    }
    
    return statusUpdate;
  } catch (error) {
    console.error('Error adding status update with reminder update:', error);
    throw error;
  }
}

// Start the reminder checking interval - Updated to receive app instance
export function startStatusReminderService(app: App): void {
  console.log('🔔 Starting status reminder service...');
  
  // Check every 5 minutes for users who need reminders
  const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  
  setInterval(async () => {
    await checkAndSendStatusReminders(app);
  }, CHECK_INTERVAL_MS);
  
  console.log(`✅ Status reminder service started (checking every ${CHECK_INTERVAL_MS / 1000 / 60} minutes)`);
}
