export const MAX_JAVASCRIPT_LINE_LENGTH = 200;

export function javascriptLineLengthFailures(source, relativePath) {
  const failures = [];
  const lines = String(source || "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const length = Array.from(lines[index]).length;
    if (length <= MAX_JAVASCRIPT_LINE_LENGTH) continue;
    failures.push(
      `${relativePath}:${index + 1}: line is ${length} characters; maximum is ${MAX_JAVASCRIPT_LINE_LENGTH}`,
    );
  }

  return failures;
}
