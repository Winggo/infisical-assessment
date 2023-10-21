import { Types } from "mongoose";
import Queue, { Job } from "bull";
import TelemetryService from "../../services/TelemetryService";
import { Membership } from "../../models/membership";
import { User } from "../../models/user";
import { sendMail } from "../../helpers";

export const allProjectMembersReminders = new Queue("all-project-members-secret-rotation-reminders", "redis://redis:6379");

type TSecretRotationReminderDetails = {
  intervalDays: number;
  note?: string;
  secretId: Types.ObjectId;
  workspaceId: Types.ObjectId;
}

allProjectMembersReminders.process("reminder", async (job: Job, done: Queue.DoneCallback) => {
  const { note, workspaceId, secretId }: TSecretRotationReminderDetails = job.data

  try {
    const projectMembersWithUsersIds = await Membership.find({
      workspace: workspaceId
    }).select("user");

    const userEmailObjs = await User.find({
      _id: {
        $in: projectMembersWithUsersIds
      }
    }).select("email").lean();
    
    const userEmails = userEmailObjs.map(userEmailObj => userEmailObj.email);

    await sendMail({
      template: "secretRotationReminder.handlebars",
      subjectLine: "Reminder: rotate secret",
      recipients: userEmails,
      substitutions: {
        note
      }
    });

    const postHogClient = await TelemetryService.getPostHogClient();
    if (postHogClient) {
      postHogClient.capture({
        event: "Secret rotation reminder emails sent",
        distinctId: secretId,
        properties: {
          userEmails,
          note
        }
      });
    }

    done(null, { userEmails, note })
  } catch (err) {
    done(new Error(`allProjectMembersSecretRotationReminders.process: an error occurred ${err}`), null)
  }
});

export const addAllProjectMembersReminder = async (secretRotationReminderPayload: TSecretRotationReminderDetails, repeatOpts: any) => {
  const job = await allProjectMembersReminders.add("reminder", secretRotationReminderPayload, {
    repeat: repeatOpts
  })
  return job
};

export const removeAllProjectMembersReminder = async (repeatOpts: any) => await allProjectMembersReminders.removeRepeatable("reminder", repeatOpts)
