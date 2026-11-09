import { londonDate } from "./weekendSchedule.js";

export function publicationContext(profile = {}) {
  return {
    publicationDate: profile.publicationDate || profile.editorialDate || londonDate(new Date()),
    timezone: "Europe/London",
    dateRule: "Judge source dates against this publication date, never a model knowledge cutoff. " +
      "A matching date is not future-dated. Older sources retain their original dates; do not describe them as breaking today.",
  };
}
