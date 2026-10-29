export const EDITIONS = Object.freeze(['daily', 'saturday', 'sunday']);

export function editionDirection(edition = 'daily') {
  if (edition === 'saturday') return [
    'This is the Saturday debate edition, prepared on Friday from the week\'s verified weekday coverage.',
    'Compare competing interpretations of the week\'s actual topics. Explain the strongest evidence on each side and what would change your judgement.',
    'Use a conversational, thought-provoking first-person Gen X voice. Pose specific dilemmas within the analysis, without inventing speakers, quotations or a consensus.',
    'The opening introduces this week\'s covered topics and their tension. Do not claim anything happened after the Friday preparation cutoff.',
  ].join(' ');
  if (edition === 'sunday') return [
    'This is the Sunday reflection edition, prepared on Friday from the week\'s verified weekday coverage.',
    'Take a slower, relaxing philosophical view of what those developments mean for human judgement, work, trust and agency.',
    'Use Jonathan\'s extremely Gen X, dry, sarcastic voice: wry and observant, aimed at hype and absurdity rather than people. Keep the thinking useful and grounded.',
    'Clearly distinguish philosophical interpretation from sourced facts. Avoid a checklist-heavy weekday briefing or Saturday\'s point-counterpoint treatment.',
    'Open with the actual covered topics. Do not imply weekend events or updates have been reported; the evidence cutoff is Friday.',
  ].join(' ');
  return [
    'This is a DAILY email briefing, currently Monday to Friday, not a weekly edition.',
    'Introduce the selected Big Three topics and their specific tension. Use today/this edition where needed;',
    'never frame the issue as this week\'s theme, a weekly roundup or this week\'s briefing.',
  ].join(' ');
}
