import type { MeetingItem } from "./vault-parsers";

export function buildTodayScheduleLines(scheduleLines: string[], meetings: MeetingItem[]): string[] {
  const lines = [...scheduleLines];
  for (const meeting of meetings) {
    if (meeting.timing !== "today") {
      continue;
    }
    if (lines.some((line) => lineContainsMeeting(line, meeting.text))) {
      continue;
    }
    lines.push(meeting.dateIso ? `${meeting.dateIso} - ${meeting.text}` : meeting.text);
  }
  return lines;
}

function lineContainsMeeting(line: string, meetingText: string): boolean {
  const normalizedLine = normalizeScheduleText(line);
  const normalizedLineSubject = normalizeScheduleText(line.replace(/^\s*(?:\d{1,2}:\d{2}|\d{1,2}(?:am|pm))\s*(?:[-–]\s*)?/i, ""));
  const normalizedMeeting = normalizeScheduleText(meetingText);
  return normalizedMeeting.length > 0 && (
    normalizedLine.includes(normalizedMeeting) ||
    (normalizedLineSubject.length > 0 && normalizedMeeting.includes(normalizedLineSubject))
  );
}

function normalizeScheduleText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
