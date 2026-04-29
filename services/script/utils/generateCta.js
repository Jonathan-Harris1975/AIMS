// services/script/utils/generateCta.js

export default function generateCta(book) {
  const safeTitle = book?.title?.replace(/[-]/g, " ") ?? "this topic";

  const spokenUrl = "jonathan-harris dot online";

  return `Curious to explore "${safeTitle}" and more? Head to ${spokenUrl} and open the eBooks section. You'll also find the daily artificial intelligence briefing and plenty of sharp, spam-free insights.`;
}
