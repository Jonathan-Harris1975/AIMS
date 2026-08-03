export function isParameterCompatibilityError(error) {
  const status = Number(error?.status);
  const detail = `${error?.message || ""} ${error?.bodySnippet || ""}`.toLowerCase();
  return [400, 404, 422].includes(status) && (
    detail.includes("no endpoints found that can handle the requested parameters")
    || detail.includes("no endpoints found that can handle requested parameters")
    || detail.includes("unsupported parameter")
    || detail.includes("response_format")
    || detail.includes("reasoning")
    || detail.includes("require_parameters")
  );
}

export default { isParameterCompatibilityError };
