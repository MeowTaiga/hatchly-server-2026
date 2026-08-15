import { notifyDueGoalReminders } from '../services/GoalService.js';

export async function runGoalReminderNotification(): Promise<void> {
  await notifyDueGoalReminders();
}
