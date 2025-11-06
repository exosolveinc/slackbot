import { COLLECTIONS } from "./constants";
import { getActiveUsers } from "./database";
import { admin, db, model } from "./firebase";
import { FirestoreBreakRecord, FirestoreCheckinSession, FirestoreStatusUpdate } from "./schema";

async function fetchRelevantEmployeeData(userQuery: string): Promise<any[]> {
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));
  
  try {
    const results: any[] = [];
    
    // Determine query scope based on keywords
    const isToday = userQuery.toLowerCase().includes('today') || userQuery.toLowerCase().includes('current');
    const isWeek = userQuery.toLowerCase().includes('week') || userQuery.toLowerCase().includes('weekly');
    const isMonth = userQuery.toLowerCase().includes('month') || userQuery.toLowerCase().includes('monthly');
    const isHistory = userQuery.toLowerCase().includes('history') || userQuery.toLowerCase().includes('past');
    
    // Add interview data if query mentions interviews
    if (userQuery.toLowerCase().includes('interview') || 
        userQuery.toLowerCase().includes('candidate') ||
        userQuery.toLowerCase().includes('optimal')) {
      
      const today = new Date();
      const startDate = new Date(today.setDate(today.getDate() - 30)); // Last 30 days
      const endDate = new Date(today.setDate(today.getDate() + 60)); // Next 60 days
      
      const interviewsSnapshot = await db
        .collection(COLLECTIONS.INTERVIEW_REQUESTS)
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(startDate))
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(endDate))
        .orderBy('startTime', 'desc')
        .limit(50)
        .get();

      const interviews = interviewsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          eventId: data.eventId,
          title: data.title,
          candidateName: data.candidateName,
          candidateEmail: data.candidateEmail,
          recruiterUsername: data.recruiterUsername,
          startTime: data.startTime.toDate(),
          endTime: data.endTime.toDate(),
          duration: data.duration,
          description: data.description,
          status: data.status
        };
      });

      results.push({
        type: 'interviews',
        data: interviews
      });
    }
    
    // Get active users data
    if (isToday || userQuery.toLowerCase().includes('active') || userQuery.toLowerCase().includes('working')) {
      const activeUsers = await getActiveUsers();
      results.push({
        type: 'active_users',
        data: activeUsers.map(user => ({
          userId: user.userId,
          username: user.username,
          status: user.status,
          currentSession: user.currentSession ? {
            checkinTime: user.currentSession.checkinTime,
            totalBreakTime: user.currentSession.totalBreakTime,
            currentWorkStatus: user.currentSession.currentWorkStatus,
            statusUpdateCount: user.currentSession.statusUpdateCount
          } : null,
          timezone: user.timezone
        }))
      });
    }
    
    // Get sessions data based on time range
    let startDate = startOfDay;
    let endDate = endOfDay;
    
    if (isWeek) {
      startDate = new Date(today.setDate(today.getDate() - 7));
    } else if (isMonth) {
      startDate = new Date(today.setMonth(today.getMonth() - 1));
    } else if (isHistory) {
      startDate = new Date(today.setDate(today.getDate() - 30));
    }
    
    // Query sessions
    const sessionsSnapshot = await db
      .collection(COLLECTIONS.CHECKIN_SESSIONS)
      .where('checkinTime', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('checkinTime', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('checkinTime', 'desc')
      .limit(50)
      .get();
    
    const sessions = sessionsSnapshot.docs.map(doc => {
      const data = doc.data() as FirestoreCheckinSession;
      return {
        sessionId: data.sessionId,
        userId: data.userId,
        username: data.username,
        date: data.date,
        checkinTime: data.checkinTime.toDate(),
        checkoutTime: data.checkoutTime?.toDate(),
        status: data.status,
        totalBreakTime: data.totalBreakTime,
        totalWorkTime: data.totalWorkTime,
        breakCount: data.breakCount,
        statusUpdateCount: data.statusUpdateCount,
        lastWorkStatus: data.lastWorkStatus,
        timezone: data.timezone
      };
    });
    
    results.push({
      type: 'sessions',
      data: sessions
    });
    
    // Get breaks data if query mentions breaks
    if (userQuery.toLowerCase().includes('break')) {
      const breakPromises = sessions.slice(0, 10).map(async (session) => {
        const breaksSnapshot = await db
          .collection(COLLECTIONS.CHECKIN_SESSIONS)
          .doc(session.sessionId)
          .collection(COLLECTIONS.BREAKS)
          .get();
        
        return breaksSnapshot.docs.map(doc => {
          const data = doc.data() as FirestoreBreakRecord;
          return {
            breakId: data.breakId,
            sessionId: data.sessionId,
            userId: data.userId,
            type: data.type,
            startTime: data.startTime.toDate(),
            endTime: data.endTime?.toDate(),
            duration: data.duration,
            status: data.status,
            notes: data.notes
          };
        });
      });
      
      const allBreaks = (await Promise.all(breakPromises)).flat();
      results.push({
        type: 'breaks',
        data: allBreaks
      });
    }
    
    // Get status updates if query mentions status
    if (userQuery.toLowerCase().includes('status') || userQuery.toLowerCase().includes('working on')) {
      const statusPromises = sessions.slice(0, 10).map(async (session) => {
        const statusSnapshot = await db
          .collection(COLLECTIONS.CHECKIN_SESSIONS)
          .doc(session.sessionId)
          .collection(COLLECTIONS.STATUS_UPDATES)
          .orderBy('timestamp', 'desc')
          .limit(5)
          .get();
        
        return statusSnapshot.docs.map(doc => {
          const data = doc.data() as FirestoreStatusUpdate;
          return {
            updateId: data.updateId,
            sessionId: data.sessionId,
            userId: data.userId,
            username: data.username,
            status: data.status,
            timestamp: data.timestamp.toDate()
          };
        });
      });
      
      const allStatusUpdates = (await Promise.all(statusPromises)).flat();
      results.push({
        type: 'status_updates',
        data: allStatusUpdates
      });
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching employee data:', error);
    return [];
  }
}

export async function handleEmployeeQuery(userQuery: string, userId: string): Promise<string> {
  try {
    // Fetch relevant data from Firestore
    const employeeData = await fetchRelevantEmployeeData(userQuery);
    
    if (employeeData.length === 0 || employeeData.every(d => d.data.length === 0)) {
      return "I couldn't find any relevant employee data for your query. Try asking about current check-ins, today's activity, recent breaks, or scheduled interviews.";
    }
    
    // Create a structured prompt for Gemini
    const prompt = `
You are an HR assistant chatbot for a company's Slack workspace. You have access to employee check-in/check-out data and interview scheduling data.

Employee Data (JSON format):
${JSON.stringify(employeeData, null, 2)}

User Question: "${userQuery}"

Data Structure Information:
- active_users: Currently checked-in or on-break employees
- sessions: Check-in sessions with times, work duration, break counts
- breaks: Individual break records with types (short, lunch, personal, meeting) and durations
- status_updates: Work status updates showing what employees are working on
- interviews: Scheduled job interviews with candidates

Common Break Types:
- short: 15min coffee/short breaks ☕
- lunch: 45min lunch breaks 🍽️  
- personal: 20min personal breaks 🚶
- meeting: Meeting breaks 📅

Instructions:
1. Answer the user's question based ONLY on the provided data
2. Be specific with numbers, times, and employee/candidate names when available
3. Format your response professionally but in a conversational tone suitable for Slack
4. Use appropriate emojis to make the response more engaging
5. If data is incomplete or missing, mention this limitation
6. For time-based queries, consider timezones if available
7. Summarize key insights and provide actionable information when possible
8. Keep responses concise but informative - aim for 2-4 sentences unless more detail is needed

Please provide a helpful and accurate response:`;

    // Generate response using Gemini
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
    
  } catch (error) {
    console.error('Error generating AI response:', error);
    return "Sorry, I encountered an error while processing your request. Please try again or rephrase your question.";
  }
}