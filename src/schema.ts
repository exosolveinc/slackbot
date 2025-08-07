import * as admin from 'firebase-admin';

export interface UserStatus {
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
export interface CheckinSession {
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
export type BreakType = 'short' | 'lunch' | 'personal' | 'meeting';

export interface BreakRecord {
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

export interface StatusUpdate {
    updateId: string;
    sessionId: string;
    userId: string;
    username: string;
    status: string;
    timestamp: Date;
    previousStatus?: string;
}

// User Preferences Types
export interface UserPreferences {
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

export interface UserCurrentState {
    status: UserStatus;
    currentSession?: CheckinSession;
    activeBreak?: BreakRecord;
    recentStatusUpdates?: StatusUpdate[];
}

export interface FirestoreUserStatus extends Omit<UserStatus, 'lastCheckin' | 'lastCheckout' | 'lastActivity' | 'currentSession'> {
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
export interface FirestoreCheckinSession extends Omit<CheckinSession, 'checkinTime' | 'checkoutTime' | 'createdAt' | 'updatedAt'> {
    checkinTime: admin.firestore.Timestamp;
    checkoutTime?: admin.firestore.Timestamp;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}
export interface FirestoreBreakRecord extends Omit<BreakRecord, 'startTime' | 'endTime' | 'createdAt'> {
    startTime: admin.firestore.Timestamp;
    endTime?: admin.firestore.Timestamp;
    createdAt: admin.firestore.Timestamp;
}
export interface FirestoreStatusUpdate extends Omit<StatusUpdate, 'timestamp'> {
    timestamp: admin.firestore.Timestamp;
}
export interface FirestoreUserPreferences extends Omit<UserPreferences, 'createdAt' | 'updatedAt'> {
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}
