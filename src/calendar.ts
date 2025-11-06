import { COLLECTIONS } from './constants';
import { admin, calendar, db } from './firebase';

export interface CalendarEvent {
  eventId: string;
  title: string;
  candidateName: string;
  candidateEmail: string;
  recruiterUserId: string;
  recruiterUsername: string;
  startTime: Date;
  endTime: Date;
  description?: string;
  calendarEventId?: string;
}

export async function createInterviewEvent(
  recruiterUserId: string,
  recruiterUsername: string,
  candidateName: string,
  candidateEmail: string,
  title: string,
  startTime: Date,
  duration: number,
  description?: string
): Promise<CalendarEvent> {
  
  const endTime = new Date(startTime.getTime() + duration * 60000);

  // Create Google Calendar event
  const event = {
    summary: `Interview: ${title}`,
    description: `Candidate: ${candidateName}\nRecruiter: ${recruiterUsername}\n\n${description || ''}`,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: 'UTC',
    },
    attendees: [
      { email: candidateEmail }
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  let calendarEventId: string | undefined;
  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: 'all'
    });
    calendarEventId = response.data.id || undefined;
  } catch (error) {
    console.error('Error creating calendar event:', error);
  }

  // Save to Firestore
  const eventRef = db.collection(COLLECTIONS.INTERVIEW_REQUESTS).doc();
  const eventData = {
    eventId: eventRef.id,
    title,
    candidateName,
    candidateEmail,
    recruiterUserId,
    recruiterUsername,
    startTime: admin.firestore.Timestamp.fromDate(startTime),
    endTime: admin.firestore.Timestamp.fromDate(endTime),
    duration,
    description,
    calendarEventId,
    status: 'scheduled',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await eventRef.set(eventData);

  return {
    eventId: eventRef.id,
    title,
    candidateName,
    candidateEmail,
    recruiterUserId,
    recruiterUsername,
    startTime,
    endTime,
    description,
    calendarEventId
  };
}

export async function getOptimalTimeSlots(date: Date): Promise<string[]> {
  const startOfDay = new Date(date);
  startOfDay.setHours(9, 0, 0, 0); // 9 AM
  
  const endOfDay = new Date(date);
  endOfDay.setHours(17, 0, 0, 0); // 5 PM

  try {
    // Get busy times from Google Calendar
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        items: [{ id: 'primary' }]
      }
    });

    const busySlots = response.data.calendars?.primary?.busy || [];
    const optimalSlots: string[] = [];

    // Generate 30-min slots from 9 AM to 5 PM
    let currentTime = new Date(startOfDay);
    while (currentTime < endOfDay) {
      const slotEnd = new Date(currentTime.getTime() + 30 * 60000);
      
      // Check if slot is free
      const isBusy = busySlots.some(busy => {
        if (!busy.start || !busy.end) return false;
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return currentTime < busyEnd && slotEnd > busyStart;
      });

      if (!isBusy) {
        optimalSlots.push(currentTime.toISOString());
      }

      currentTime = slotEnd;
    }

    return optimalSlots;

  } catch (error) {
    console.error('Error getting optimal slots:', error);
    // Return default slots if calendar API fails
    return ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'].map(time => {
    const slot = new Date(date);
    const parts = time.split(':');
    const hours = parts[0] || '0';
    const minutes = parts[1] || '0';
    slot.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    return slot.toISOString();
    });
  }
}

export async function getInterviewsByDateRange(
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const snapshot = await db
    .collection(COLLECTIONS.INTERVIEW_REQUESTS)
    .where('startTime', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('startTime', '<=', admin.firestore.Timestamp.fromDate(endDate))
    .orderBy('startTime', 'asc')
    .get();

  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      eventId: data.eventId,
      title: data.title,
      candidateName: data.candidateName,
      candidateEmail: data.candidateEmail,
      recruiterUserId: data.recruiterUserId,
      recruiterUsername: data.recruiterUsername,
      startTime: data.startTime.toDate(),
      endTime: data.endTime.toDate(),
      description: data.description,
      calendarEventId: data.calendarEventId
    };
  });
}