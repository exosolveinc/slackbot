import { Block, KnownBlock } from "@slack/web-api";
import { getUserCurrentState, endBreak, completeCheckinSession, getSessionBreaks, createCheckinSession, getCheckinSession, getUserStatus, startBreak, addStatusUpdate, getActiveUsers, getSessionsByDate, getSessionStatusUpdates, getUserPreferences, getUserSessionHistory, updateUserPreferences, updateUserStatus } from "./database";
import { BreakType, CheckinSession } from "./schema";
import { AllMiddlewareArgs, SlackCommandMiddlewareArgs, StringIndexed } from "@slack/bolt";
import { BREAK_TYPES } from "./constants";
import { formatTime, calculateDuration, getDateString } from "./helper";

type CommandHandler = (
    args: SlackCommandMiddlewareArgs & AllMiddlewareArgs<StringIndexed>
) => Promise<void>;
export const handleCheckin: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleCheckout: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleBreakStart: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleBreakEnd: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleStatusUpdate: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleStatusHistory: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleCheckinReport: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleMyHistory: CommandHandler = async ({ command, ack, respond }) => {
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
}

export const handleSetTimezone: CommandHandler = async ({ command, ack, respond }) => {
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
}