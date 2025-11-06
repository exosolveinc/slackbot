import { AllMiddlewareArgs, SlackCommandMiddlewareArgs, StringIndexed } from "@slack/bolt";
import { getOptimalTimeSlots } from "./calendar";
import { handleEmployeeQuery } from "./firebase_ai";

type CommandHandler = (
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs<StringIndexed>
) => Promise<void>;

export const handleScheduleInterview: CommandHandler = async ({ command, ack, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'schedule_interview_modal',
        title: { type: 'plain_text', text: 'Schedule Interview' },
        submit: { type: 'plain_text', text: 'Create' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'title',
            label: { type: 'plain_text', text: 'Job Title' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              placeholder: { type: 'plain_text', text: 'e.g., Frontend Developer' }
            }
          },
          {
            type: 'input',
            block_id: 'candidate_name',
            label: { type: 'plain_text', text: 'Candidate Name' },
            element: { type: 'plain_text_input', action_id: 'value' }
          },
          {
            type: 'input',
            block_id: 'candidate_email',
            label: { type: 'plain_text', text: 'Candidate Email' },
            element: { type: 'email_text_input', action_id: 'value' }
          },
          {
            type: 'input',
            block_id: 'date',
            label: { type: 'plain_text', text: 'Date' },
            element: {
              type: 'datepicker',
              action_id: 'value',
              initial_date: new Date().toISOString().split('T')[0]
            }
          },
          {
            type: 'input',
            block_id: 'time',
            label: { type: 'plain_text', text: 'Time' },
            element: { type: 'timepicker', action_id: 'value', initial_time: '14:00' }
          },
          {
            type: 'input',
            block_id: 'duration',
            label: { type: 'plain_text', text: 'Duration' },
            element: {
              type: 'static_select',
              action_id: 'value',
              initial_option: { text: { type: 'plain_text', text: '30 minutes' }, value: '30' },
              options: [
                { text: { type: 'plain_text', text: '30 minutes' }, value: '30' },
                { text: { type: 'plain_text', text: '45 minutes' }, value: '45' },
                { text: { type: 'plain_text', text: '1 hour' }, value: '60' }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'description',
            label: { type: 'plain_text', text: 'Notes (optional)' },
            element: {
              type: 'plain_text_input',
              action_id: 'value',
              multiline: true,
              placeholder: { type: 'plain_text', text: 'Interview agenda, requirements, etc.' }
            },
            optional: true
          }
        ],
        private_metadata: JSON.stringify({ userId: command.user_id, username: command.user_name })
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
};

export const handleInterviewQuery: CommandHandler = async ({ command, ack, respond }) => {
  await ack();

  const query = command.text?.trim();

  if (!query) {
    await respond({
      response_type: 'ephemeral',
      text: `🤖 *Interview Assistant*\n\nAsk me about interviews!\n\n*Examples:*\n• "What are the optimal time slots for tomorrow?"\n• "Show me interviews scheduled this week"\n• "Who interviewed John Doe?"\n• "What interviews do we have on Friday?"\n• "Show me past interviews for Software Engineer position"`
    });
    return;
  }

  try {
    // Special handling for optimal slots
    if (query.toLowerCase().includes('optimal') || query.toLowerCase().includes('time slot')) {
      const dateMatch = query.match(/tomorrow|today|(\d{4}-\d{2}-\d{2})/i);
      let targetDate = new Date();
      
      if (dateMatch) {
        if (dateMatch[0].toLowerCase() === 'tomorrow') {
          targetDate.setDate(targetDate.getDate() + 1);
        } else if (dateMatch[1]) {
          targetDate = new Date(dateMatch[1]);
        }
      }

      const slots = await getOptimalTimeSlots(targetDate);
      
      if (slots.length === 0) {
        await respond({
          response_type: 'ephemeral',
          text: `📅 No available slots found for ${targetDate.toDateString()}.`
        });
        return;
      }

      const slotsText = slots.slice(0, 10).map(slot => {
        const time = new Date(slot);
        return `• ${time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
      }).join('\n');

      await respond({
        response_type: 'ephemeral',
        text: `📅 *Optimal Time Slots for ${targetDate.toDateString()}*\n\n${slotsText}\n\n_Use \`/schedule-interview\` to book a slot_`
      });
      return;
    }

    // Use AI for other queries
    await respond({
      response_type: 'ephemeral',
      text: "🤔 Analyzing interview data..."
    });

    const aiResponse = await handleEmployeeQuery(query, command.user_id);

    await respond({
      response_type: 'ephemeral',
      text: `🤖 ${aiResponse}`
    });

  } catch (error) {
    console.error('Error handling interview query:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to process query. Please try again.'
    });
  }
};