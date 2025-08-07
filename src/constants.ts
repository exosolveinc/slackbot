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
