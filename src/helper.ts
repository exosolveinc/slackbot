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
